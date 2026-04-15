import { describe, test, expect, afterEach, beforeAll } from "bun:test";
import { Result } from "better-result";
import { z } from "zod";
import {
  createActionRegistry,
  type ActionSpec,
  type SignerProvider,
} from "@xmtp/signet-contracts";
import {
  AuthError,
  CredentialExpiredError,
  InternalError,
  PermissionError,
  type SignetError,
} from "@xmtp/signet-schemas";
import { createAdminServer, type AdminServer } from "../admin/server.js";
import { createAdminClient, type AdminClient } from "../admin/client.js";
import { createAdminDispatcher } from "../admin/dispatcher.js";
import type { AdminJwtPayload } from "../admin/protocol.js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Unix socket paths are limited to ~104 chars on macOS.
// Keep test paths short to avoid ENAMETOOLONG.
let testCounter = 0;
const TEST_SOCKET_DIR = join(tmpdir(), "xb-test");

beforeAll(() => {
  mkdirSync(TEST_SOCKET_DIR, { recursive: true });
});

function testSocketPath(): string {
  testCounter++;
  return join(TEST_SOCKET_DIR, `s${Date.now()}-${testCounter}.sock`);
}

/** Minimal mock key manager for testing. */
function makeKeyManager(opts?: {
  rejectAuth?: boolean;
  rejectElevation?: boolean;
}) {
  let authorizeCalls = 0;
  return {
    get authorizeCalls() {
      return authorizeCalls;
    },
    admin: {
      async verifyJwt(
        token: string,
      ): Promise<Result<AdminJwtPayload, InstanceType<typeof AuthError>>> {
        if (opts?.rejectAuth || token === "invalid-jwt") {
          return Result.err(AuthError.create("Invalid token"));
        }
        return Result.ok({
          iss: "test-fingerprint",
          sub: "admin" as const,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 120,
          jti: "test-jti",
        });
      },
      async get() {
        return Result.ok({
          publicKey: "test-public-key",
          fingerprint: "approval-fingerprint",
        } as const);
      },
    },
    async authorizeSensitiveOperation() {
      authorizeCalls++;
      if (opts?.rejectElevation) {
        return Result.err(PermissionError.create("Elevation denied"));
      }
      return Result.ok(undefined);
    },
  };
}

/** Stub SignerProvider that errors if called (admin handlers don't use it). */
function makeStubSignerProvider(): SignerProvider {
  const err = () =>
    Result.err(InternalError.create("Not available in admin context"));
  return {
    sign: async () => err(),
    getPublicKey: async () => err(),
    getFingerprint: async () => err(),
    getDbEncryptionKey: async () => err(),
    getXmtpIdentityKey: async () => err(),
  };
}

function makeReadElevationApprover(
  keyManager: ReturnType<typeof makeKeyManager>,
) {
  return {
    authorize: async () =>
      keyManager.authorizeSensitiveOperation("adminReadElevation"),
    async getApprovalFingerprint() {
      const info = await keyManager.admin.get();
      return Result.isError(info) ? info : Result.ok(info.value.fingerprint);
    },
  };
}

function makeTestSpec(
  id: string,
  handler: ActionSpec<unknown, unknown, SignetError>["handler"],
): ActionSpec<unknown, unknown, SignetError> {
  return {
    id,
    handler,
    input: z.object({}).passthrough(),
    cli: {
      command: id.replace(/\./g, ":"),
    },
  };
}

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let server: AdminServer | undefined;
let client: AdminClient | undefined;

afterEach(async () => {
  if (client) {
    await client.close();
    client = undefined;
  }
  if (server) {
    await server.stop();
    server = undefined;
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AdminSocket round-trip", () => {
  test("server starts and listens on Unix socket", async () => {
    const socketPath = testSocketPath();
    const registry = createActionRegistry();
    const dispatcher = createAdminDispatcher(registry);

    server = createAdminServer(
      { socketPath, authMode: "admin-key" },
      {
        keyManager: makeKeyManager(),
        dispatcher,
        signetId: "test-signet",
        signerProvider: makeStubSignerProvider(),
      },
    );

    const result = await server.start();
    expect(result.isOk()).toBe(true);
    expect(server.state).toBe("listening");

    // Server being in "listening" state confirms the socket is bound
    expect(server.state).toBe("listening");
  });

  test("client connects, authenticates, sends request, gets response", async () => {
    const socketPath = testSocketPath();
    const registry = createActionRegistry();
    const spec = makeTestSpec("signet.status", async () =>
      Result.ok({
        state: "running",
        uptime: 123,
      }),
    );
    registry.register(spec);
    const dispatcher = createAdminDispatcher(registry);

    server = createAdminServer(
      { socketPath, authMode: "admin-key" },
      {
        keyManager: makeKeyManager(),
        dispatcher,
        signetId: "test-signet",
        signerProvider: makeStubSignerProvider(),
      },
    );
    await server.start();

    client = createAdminClient(socketPath);
    const connectResult = await client.connect("valid-jwt-token");
    expect(connectResult.isOk()).toBe(true);

    const response = await client.request<{
      state: string;
      uptime: number;
    }>("signet.status");
    expect(response.isOk()).toBe(true);
    if (response.isOk()) {
      expect(response.value.state).toBe("running");
      expect(response.value.uptime).toBe(123);
    }
  });

  test("invalid JWT is rejected", async () => {
    const socketPath = testSocketPath();
    const registry = createActionRegistry();
    const dispatcher = createAdminDispatcher(registry);

    server = createAdminServer(
      { socketPath, authMode: "admin-key" },
      {
        keyManager: makeKeyManager(),
        dispatcher,
        signetId: "test-signet",
        signerProvider: makeStubSignerProvider(),
      },
    );
    await server.start();

    client = createAdminClient(socketPath);
    const connectResult = await client.connect("invalid-jwt");
    expect(connectResult.isOk()).toBe(false);
  });

  test("multiple sequential requests work", async () => {
    const socketPath = testSocketPath();
    const registry = createActionRegistry();

    let callCount = 0;
    const spec = makeTestSpec(
      "credential.list",
      async () => {
        callCount++;
        return Result.ok({ count: callCount });
      },
      "credential.list",
    );
    registry.register(spec);
    const dispatcher = createAdminDispatcher(registry);

    server = createAdminServer(
      { socketPath, authMode: "admin-key" },
      {
        keyManager: makeKeyManager(),
        dispatcher,
        signetId: "test-signet",
        signerProvider: makeStubSignerProvider(),
      },
    );
    await server.start();

    client = createAdminClient(socketPath);
    await client.connect("valid-jwt-token");

    const r1 = await client.request<{ count: number }>("credential.list");
    expect(r1.isOk()).toBe(true);
    if (r1.isOk()) {
      expect(r1.value.count).toBe(1);
    }

    const r2 = await client.request<{ count: number }>("credential.list");
    expect(r2.isOk()).toBe(true);
    if (r2.isOk()) {
      expect(r2.value.count).toBe(2);
    }
  });

  test("dangerous message read requests attach admin read elevation to context", async () => {
    const socketPath = testSocketPath();
    const registry = createActionRegistry();
    const keyManager = makeKeyManager();
    registry.register({
      id: "message.list",
      description: "List messages in a conversation",
      intent: "read",
      input: z.object({
        chatId: z.string(),
      }),
      handler: async (_input, ctx) =>
        Result.ok({
          approvalId: ctx.adminReadElevation?.approvalId ?? null,
          chatIds: ctx.adminReadElevation?.scope.chatIds ?? [],
          approvalKeyFingerprint:
            ctx.adminReadElevation?.approvalKeyFingerprint ?? null,
        }),
      cli: {
        command: "message:list",
      },
    });
    const dispatcher = createAdminDispatcher(registry);

    server = createAdminServer(
      { socketPath, authMode: "admin-key" },
      {
        keyManager,
        dispatcher,
        signetId: "test-signet",
        signerProvider: makeStubSignerProvider(),
        readElevationApprover: makeReadElevationApprover(keyManager),
      },
    );
    await server.start();

    client = createAdminClient(socketPath);
    const connectResult = await client.connect("valid-jwt-token");
    expect(connectResult.isOk()).toBe(true);

    const response = await client.request<{
      approvalId: string | null;
      chatIds: string[];
      approvalKeyFingerprint: string | null;
    }>("message.list", {
      chatId: "conv_0123456789abcdef",
      dangerouslyAllowMessageRead: true,
    });

    expect(response.isOk()).toBe(true);
    if (response.isOk()) {
      expect(response.value.approvalId).toContain("approval_");
      expect(response.value.chatIds).toEqual(["conv_0123456789abcdef"]);
      expect(response.value.approvalKeyFingerprint).toBe(
        "approval-fingerprint",
      );
    }
  });

  test("dangerous message read request fails when local approval is denied", async () => {
    const socketPath = testSocketPath();
    const registry = createActionRegistry();
    const keyManager = makeKeyManager({ rejectElevation: true });
    registry.register({
      id: "message.list",
      description: "List messages in a conversation",
      intent: "read",
      input: z.object({
        chatId: z.string(),
      }),
      handler: async () => Result.ok({}),
      cli: {
        command: "message:list",
      },
    });
    const dispatcher = createAdminDispatcher(registry);

    server = createAdminServer(
      { socketPath, authMode: "admin-key" },
      {
        keyManager,
        dispatcher,
        signetId: "test-signet",
        signerProvider: makeStubSignerProvider(),
        readElevationApprover: makeReadElevationApprover(keyManager),
      },
    );
    await server.start();

    client = createAdminClient(socketPath);
    const connectResult = await client.connect("valid-jwt-token");
    expect(connectResult.isOk()).toBe(true);

    const response = await client.request("message.list", {
      chatId: "conv_0123456789abcdef",
      dangerouslyAllowMessageRead: true,
    });

    expect(response.isOk()).toBe(false);
    if (response.isErr()) {
      expect(response.error.category).toBe("permission");
      expect(response.error.message).toContain("Elevation denied");
    }
  });

  test("message read without dangerous flag does not attach elevation", async () => {
    const socketPath = testSocketPath();
    const registry = createActionRegistry();
    const spec = makeTestSpec("message.list", async (_input, ctx) =>
      Result.ok({
        approvalId: ctx.adminReadElevation?.approvalId ?? null,
      }),
    );
    registry.register(spec);
    const dispatcher = createAdminDispatcher(registry);

    server = createAdminServer(
      { socketPath, authMode: "admin-key" },
      {
        keyManager: makeKeyManager(),
        dispatcher,
        signetId: "test-signet",
        signerProvider: makeStubSignerProvider(),
      },
    );
    await server.start();

    client = createAdminClient(socketPath);
    const connectResult = await client.connect("valid-jwt-token");
    expect(connectResult.isOk()).toBe(true);

    const response = await client.request<{ approvalId: string | null }>(
      "message.list",
      {
        chatId: "conv_0123456789abcdef",
      },
    );

    expect(response.isOk()).toBe(true);
    if (response.isOk()) {
      expect(response.value.approvalId).toBeNull();
    }
  });

  test("dangerous message reads reuse a live elevation within the same admin session", async () => {
    const socketPath = testSocketPath();
    const registry = createActionRegistry();
    const keyManager = makeKeyManager();
    const spec = makeTestSpec("message.info", async (_input, ctx) =>
      Result.ok({
        approvalId: ctx.adminReadElevation?.approvalId ?? null,
      }),
    );
    registry.register(spec);
    const dispatcher = createAdminDispatcher(registry);

    server = createAdminServer(
      { socketPath, authMode: "admin-key" },
      {
        keyManager,
        dispatcher,
        signetId: "test-signet",
        signerProvider: makeStubSignerProvider(),
        readElevationApprover: makeReadElevationApprover(keyManager),
      },
    );
    await server.start();

    client = createAdminClient(socketPath);
    const connectResult = await client.connect("valid-jwt-token");
    expect(connectResult.isOk()).toBe(true);

    const first = await client.request<{ approvalId: string | null }>(
      "message.info",
      {
        chatId: "conv_same_session",
        messageId: "msg_1",
        dangerouslyAllowMessageRead: true,
      },
    );
    const second = await client.request<{ approvalId: string | null }>(
      "message.info",
      {
        chatId: "conv_same_session",
        messageId: "msg_2",
        dangerouslyAllowMessageRead: true,
      },
    );

    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    if (first.isOk() && second.isOk()) {
      expect(first.value.approvalId).toContain("approval_");
      expect(second.value.approvalId).toBe(first.value.approvalId);
    }
    expect(keyManager.authorizeCalls).toBe(1);
  });

  test("invalid dangerous message reads fail validation before prompting for elevation", async () => {
    const socketPath = testSocketPath();
    const registry = createActionRegistry();
    const keyManager = makeKeyManager();
    registry.register({
      id: "message.info",
      description: "Read a message",
      intent: "read",
      input: z.object({
        chatId: z.string(),
        messageId: z.string(),
      }),
      handler: async () => Result.ok({ ok: true }),
      cli: {
        command: "message:info",
      },
    });
    const dispatcher = createAdminDispatcher(registry);

    server = createAdminServer(
      { socketPath, authMode: "admin-key" },
      {
        keyManager,
        dispatcher,
        signetId: "test-signet",
        signerProvider: makeStubSignerProvider(),
        readElevationApprover: makeReadElevationApprover(keyManager),
      },
    );
    await server.start();

    client = createAdminClient(socketPath);
    const connectResult = await client.connect("valid-jwt-token");
    expect(connectResult.isOk()).toBe(true);

    const response = await client.request("message.info", {
      chatId: "conv_invalid_before_prompt",
      dangerouslyAllowMessageRead: true,
    });

    expect(response.isErr()).toBe(true);
    if (response.isErr()) {
      expect(response.error.category).toBe("validation");
    }
    expect(keyManager.authorizeCalls).toBe(0);
  });

  test("client preserves structured signet errors from JSON-RPC failures", async () => {
    const socketPath = testSocketPath();
    const registry = createActionRegistry();
    const spec = makeTestSpec(
      "message.send",
      async () =>
        Result.err(
          PermissionError.create("Operation denied", {
            grant: "messaging.send",
          }),
        ),
      "message.send",
    );
    registry.register(spec);
    const dispatcher = createAdminDispatcher(registry);

    server = createAdminServer(
      { socketPath, authMode: "admin-key" },
      {
        keyManager: makeKeyManager(),
        dispatcher,
        signetId: "test-signet",
        signerProvider: makeStubSignerProvider(),
      },
    );
    await server.start();

    client = createAdminClient(socketPath);
    await client.connect("valid-jwt-token");

    const response = await client.request("message.send", {
      groupId: "g1",
    });

    expect(response.isErr()).toBe(true);
    if (response.isOk()) {
      return;
    }
    expect(response.error._tag).toBe("PermissionError");
    expect(response.error.category).toBe("permission");
    expect(response.error.message).toBe("Operation denied");
    expect(response.error.context).toEqual({ grant: "messaging.send" });
  });

  test("client preserves credential expiry context from JSON-RPC failures", async () => {
    const socketPath = testSocketPath();
    const registry = createActionRegistry();
    const spec = makeTestSpec(
      "credential.lookup",
      async () =>
        Result.err(CredentialExpiredError.create("cred_deadbeeffeedbabe")),
      "credential.lookup",
    );
    registry.register(spec);
    const dispatcher = createAdminDispatcher(registry);

    server = createAdminServer(
      { socketPath, authMode: "admin-key" },
      {
        keyManager: makeKeyManager(),
        dispatcher,
        signetId: "test-signet",
        signerProvider: makeStubSignerProvider(),
      },
    );
    await server.start();

    client = createAdminClient(socketPath);
    await client.connect("valid-jwt-token");

    const response = await client.request("credential.lookup", {
      credentialId: "cred_deadbeeffeedbabe",
    });

    expect(response.isErr()).toBe(true);
    if (response.isOk()) {
      return;
    }
    expect(response.error._tag).toBe("CredentialExpiredError");
    expect(response.error.category).toBe("auth");
    expect(response.error.message).toBe(
      "Credential 'cred_deadbeeffeedbabe' has expired",
    );
    expect(response.error.context).toEqual({
      credentialId: "cred_deadbeeffeedbabe",
    });
  });

  test("server stop cleans up socket file", async () => {
    const socketPath = testSocketPath();
    const registry = createActionRegistry();
    const dispatcher = createAdminDispatcher(registry);

    server = createAdminServer(
      { socketPath, authMode: "admin-key" },
      {
        keyManager: makeKeyManager(),
        dispatcher,
        signetId: "test-signet",
        signerProvider: makeStubSignerProvider(),
      },
    );
    await server.start();
    expect(server.state).toBe("listening");

    const stopResult = await server.stop();
    expect(stopResult.isOk()).toBe(true);
    expect(server.state).toBe("stopped");

    // Socket file should be cleaned up
    const exists = await Bun.file(socketPath).exists();
    expect(exists).toBe(false);
  });
});
