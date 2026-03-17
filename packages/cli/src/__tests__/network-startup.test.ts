import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Result } from "better-result";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { InternalError } from "@xmtp/signet-schemas";
import type { CoreState } from "@xmtp/signet-contracts";
import { createSignetRuntime, type SignetRuntimeDeps } from "../runtime.js";
import { CliConfigSchema, type CliConfig } from "../config/schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return join(
    tmpdir(),
    `net-startup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

function makeConfig(
  tempDir: string,
  overrides?: { env?: "local" | "dev" | "production" },
): CliConfig {
  return CliConfigSchema.parse({
    signet: { dataDir: join(tempDir, "data"), env: overrides?.env },
    admin: { socketPath: join(tempDir, "admin.sock") },
    logging: { auditLogPath: join(tempDir, "audit.jsonl") },
  });
}

function createCallTracker(): {
  calls: string[];
  record(name: string): void;
} {
  const calls: string[] = [];
  return {
    calls,
    record(name: string): void {
      calls.push(name);
    },
  };
}

function makeMockDeps(
  tracker: { calls: string[]; record(name: string): void },
  options?: {
    coreInitializeResult?: () => Promise<
      Result<void, import("@xmtp/signet-schemas").SignetError>
    >;
    coreStateGetter?: () => CoreState;
  },
): SignetRuntimeDeps {
  let coreState: CoreState = "uninitialized";

  return {
    createKeyManager: async () => {
      tracker.record("keyManager.create");
      return Result.ok({
        initialize: async () => {
          tracker.record("keyManager.initialize");
          return Result.ok({
            publicKeyHex: "mock-pub",
            fingerprint: "mock-fp",
            trustTier: "software" as const,
          });
        },
        platform: "software-vault" as const,
        trustTier: "software" as const,
        admin: {
          verifyJwt: async () =>
            Result.ok({ iss: "mock", sub: "admin", exp: 0, iat: 0 }),
          signJwt: async () => Result.ok("mock-jwt"),
          getPublicKey: async () => Result.ok(new Uint8Array()),
          rotate: async () => Result.ok(undefined),
          keyRecord: async () =>
            Result.ok({
              fingerprint: "mock",
              publicKeyHex: "mock",
              createdAt: new Date().toISOString(),
            }),
        },
        createOperationalKey: async () =>
          Result.ok({
            identityId: "id",
            keyId: "key",
            publicKeyHex: "pub",
            groupId: null,
            createdAt: new Date().toISOString(),
          }),
        getOperationalKey: () =>
          Result.ok({
            identityId: "id",
            keyId: "key",
            publicKeyHex: "pub",
            groupId: null,
            createdAt: new Date().toISOString(),
          }),
        getOperationalKeyByGroupId: () =>
          Result.ok({
            identityId: "id",
            keyId: "key",
            publicKeyHex: "pub",
            groupId: "g",
            createdAt: new Date().toISOString(),
          }),
        rotateOperationalKey: async () =>
          Result.ok({
            identityId: "id",
            keyId: "key",
            publicKeyHex: "pub",
            groupId: null,
            createdAt: new Date().toISOString(),
          }),
        listOperationalKeys: () => [],
        issueSessionKey: async () =>
          Result.ok({
            keyId: "sk",
            sessionId: "s",
            fingerprint: "fp",
            publicKeyHex: "pub",
            expiresAt: new Date().toISOString(),
          }),
        revokeSessionKey: () => Result.ok(undefined),
        signWithOperationalKey: async () => Result.ok(new Uint8Array()),
      });
    },
    createSignetCore: () => {
      tracker.record("signetCore.create");
      return {
        get state() {
          if (options?.coreStateGetter) return options.coreStateGetter();
          return coreState;
        },
        initializeLocal: async () => {
          tracker.record("signetCore.initializeLocal");
          coreState = "ready-local";
          return Result.ok(undefined);
        },
        initialize: async () => {
          tracker.record("signetCore.initialize");
          if (options?.coreInitializeResult) {
            return options.coreInitializeResult();
          }
          coreState = "ready";
          return Result.ok(undefined);
        },
        shutdown: async () => {
          tracker.record("signetCore.shutdown");
          return Result.ok(undefined);
        },
        sendMessage: async () =>
          Result.err(InternalError.create("not implemented")),
        getGroupInfo: async () =>
          Result.err(InternalError.create("not implemented")),
      };
    },
    createSessionManager: () => {
      tracker.record("sessionManager.create");
      return {
        issue: async () =>
          Result.ok({
            token: "token",
            session: {
              sessionId: "s1",
              agentInboxId: "a1",
              sessionKeyFingerprint: "fp",
              issuedAt: new Date().toISOString(),
              expiresAt: new Date().toISOString(),
            },
          }),
        list: async () => Result.ok([]),
        lookup: async () => Result.err(InternalError.create("not found")),
        lookupByToken: async () =>
          Result.err(InternalError.create("not found")),
        revoke: async () => Result.ok(undefined),
        heartbeat: async () => Result.ok(undefined),
        isActive: async () => Result.ok(false),
      };
    },
    createSealManager: () => {
      tracker.record("sealManager.create");
      return {
        issue: async () => Result.err(InternalError.create("not impl")),
        refresh: async () => Result.err(InternalError.create("not impl")),
        revoke: async () => Result.ok(undefined),
        current: async () => Result.ok(null),
      };
    },
    createWsServer: () => {
      tracker.record("wsServer.create");
      return {
        state: "idle" as const,
        connectionCount: 0,
        start: async () => {
          tracker.record("wsServer.start");
          return Result.ok({ port: 8393 });
        },
        stop: async () => {
          tracker.record("wsServer.stop");
          return Result.ok(undefined);
        },
        broadcast: () => {},
      };
    },
    createAdminServer: () => {
      tracker.record("adminServer.create");
      return {
        state: "idle" as const,
        start: async () => {
          tracker.record("adminServer.start");
          return Result.ok(undefined);
        },
        stop: async () => {
          tracker.record("adminServer.stop");
          return Result.ok(undefined);
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Network Startup Tests
// ---------------------------------------------------------------------------

describe("network startup", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = makeTempDir();
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("skips core.initialize() when env is local", async () => {
    const tracker = createCallTracker();
    const config = makeConfig(tempDir, { env: "local" });
    const deps = makeMockDeps(tracker);

    const result = await createSignetRuntime(config, deps);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;

    const startResult = await result.value.start();
    expect(Result.isOk(startResult)).toBe(true);
    expect(result.value.state).toBe("running");
    expect(tracker.calls).not.toContain("signetCore.initialize");
    expect(tracker.calls).toContain("signetCore.initializeLocal");
  });

  test("calls core.initialize() when env is dev", async () => {
    const tracker = createCallTracker();
    const config = makeConfig(tempDir, { env: "dev" });
    const deps = makeMockDeps(tracker);

    const result = await createSignetRuntime(config, deps);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;

    const startResult = await result.value.start();
    expect(Result.isOk(startResult)).toBe(true);
    expect(result.value.state).toBe("running");
    expect(tracker.calls).toContain("signetCore.initialize");
  });

  test("continues running when core.initialize() fails (graceful degradation)", async () => {
    const tracker = createCallTracker();
    const config = makeConfig(tempDir, { env: "dev" });
    const deps = makeMockDeps(tracker, {
      coreInitializeResult: async () =>
        Result.err(InternalError.create("network unreachable")),
      coreStateGetter: () => "ready-local",
    });

    const result = await createSignetRuntime(config, deps);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;

    const startResult = await result.value.start();
    expect(Result.isOk(startResult)).toBe(true);
    expect(result.value.state).toBe("running");
    expect(tracker.calls).toContain("signetCore.initialize");
  });
});

// ---------------------------------------------------------------------------
// Status Field Tests
// ---------------------------------------------------------------------------

describe("status networkState field", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = makeTempDir();
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("reports connected when core state is ready", async () => {
    const tracker = createCallTracker();
    const config = makeConfig(tempDir, { env: "dev" });
    const deps = makeMockDeps(tracker);

    const result = await createSignetRuntime(config, deps);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;

    await result.value.start();
    const status = await result.value.status();

    expect(status.networkState).toBe("connected");
    expect(status.identityCount).toBe(0);
    expect(status.connectedInboxIds).toEqual([]);
  });

  test("reports disconnected when core is local-only", async () => {
    const tracker = createCallTracker();
    const config = makeConfig(tempDir, { env: "local" });
    const deps = makeMockDeps(tracker);

    const result = await createSignetRuntime(config, deps);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;

    await result.value.start();
    const status = await result.value.status();

    expect(status.networkState).toBe("disconnected");
    expect(status.identityCount).toBe(0);
    expect(status.connectedInboxIds).toEqual([]);
  });
});
