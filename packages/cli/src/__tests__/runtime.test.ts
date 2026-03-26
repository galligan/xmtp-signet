import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Result } from "better-result";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, rm, readFile } from "node:fs/promises";
import { InternalError } from "@xmtp/signet-schemas";
import type { AdminDispatcher } from "../admin/dispatcher.js";
import { createSignetRuntime, type SignetRuntimeDeps } from "../runtime.js";
import { CliConfigSchema, type CliConfig } from "../config/schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return join(
    tmpdir(),
    `runtime-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

function makeConfig(tempDir: string): CliConfig {
  return CliConfigSchema.parse({
    signet: { dataDir: join(tempDir, "data") },
    admin: { socketPath: join(tempDir, "admin.sock") },
    logging: { auditLogPath: join(tempDir, "audit.jsonl") },
  });
}

/** Track call order for startup/shutdown sequencing verification. */
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

function makeMockDeps(tracker: {
  calls: string[];
  record(name: string): void;
}): SignetRuntimeDeps & {
  _dispatcher: () => AdminDispatcher | undefined;
  _keyManagerConfig: () => unknown;
} {
  let capturedDispatcher: AdminDispatcher | undefined;
  let capturedKeyManagerConfig: unknown;

  return {
    createKeyManager: async (config) => {
      tracker.record("keyManager.create");
      capturedKeyManagerConfig = config;
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
        issueCredentialKey: async () =>
          Result.ok({
            keyId: "sk",
            credentialId: "cred_1a2b3c4dfeedbabe",
            fingerprint: "fp",
            publicKeyHex: "pub",
            expiresAt: new Date().toISOString(),
          }),
        revokeCredentialKey: () => Result.ok(undefined),
        signWithOperationalKey: async () => Result.ok(new Uint8Array()),
        signWithCredentialKey: async () => Result.ok(new Uint8Array()),
        getOrCreateDbKey: async () => Result.ok(new Uint8Array(32)),
        getOrCreateXmtpIdentityKey: async () =>
          Result.ok("0x00" as `0x${string}`),
        vaultSet: async () => Result.ok(undefined),
        vaultGet: async () => Result.ok(new Uint8Array()),
        vaultDelete: async () => Result.ok(undefined),
        vaultList: () => [],
        startAutoRotation: () => {},
        stopAutoRotation: () => {},
        close: () => {},
      });
    },
    createSignetCore: () => {
      tracker.record("signetCore.create");
      return {
        state: "uninitialized" as const,
        initializeLocal: async () => {
          tracker.record("signetCore.initializeLocal");
          return Result.ok(undefined);
        },
        initialize: async () => {
          tracker.record("signetCore.initialize");
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
    createCredentialManager: () => {
      tracker.record("credentialManager.create");
      return {
        issue: async () =>
          Result.ok({
            token: "token",
            credential: {
              id: "cred_1",
              config: {
                operatorId: "op_1",
                chatIds: [],
              },
              inboxIds: [],
              status: "active",
              issuedAt: new Date().toISOString(),
              expiresAt: new Date().toISOString(),
              issuedBy: "op_1",
            },
          }),
        list: async () => Result.ok([]),
        lookup: async () => Result.err(InternalError.create("not found")),
        lookupByToken: async () =>
          Result.err(InternalError.create("not found")),
        revoke: async () => Result.ok(undefined),
        update: async () => Result.err(InternalError.create("not found")),
        renew: async () => Result.err(InternalError.create("not found")),
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
    createAdminServer: (_config, deps) => {
      tracker.record("adminServer.create");
      capturedDispatcher = (deps as { dispatcher: AdminDispatcher }).dispatcher;
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
    _dispatcher: () => capturedDispatcher,
    _keyManagerConfig: () => capturedKeyManagerConfig,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createSignetRuntime", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = makeTempDir();
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("creates runtime with mocked deps", async () => {
    const tracker = createCallTracker();
    const config = makeConfig(tempDir);
    const deps = makeMockDeps(tracker);

    const result = await createSignetRuntime(config, deps);

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    const runtime = result.value;

    expect(runtime.state).toBe("created");
    expect(runtime.config).toBe(config);
    expect(runtime.core).toBeDefined();
    expect(runtime.credentialManager).toBeDefined();
    expect(runtime.sealManager).toBeDefined();
    expect(runtime.keyManager).toBeDefined();
    expect(runtime.wsServer).toBeDefined();
    expect(runtime.adminServer).toBeDefined();
    expect(runtime.paths).toBeDefined();
  });

  test("passes vault and biometric config through to createKeyManager", async () => {
    const tracker = createCallTracker();
    const config = CliConfigSchema.parse({
      signet: { dataDir: join(tempDir, "data") },
      admin: { socketPath: join(tempDir, "admin.sock") },
      logging: { auditLogPath: join(tempDir, "audit.jsonl") },
      keys: {
        rootKeyPolicy: "passcode",
        operationalKeyPolicy: "open",
        vaultKeyPolicy: "biometric",
      },
      biometricGating: {
        rootKeyCreation: true,
        operationalKeyRotation: true,
      },
    });
    const deps = makeMockDeps(tracker);

    const result = await createSignetRuntime(config, deps);

    expect(Result.isOk(result)).toBe(true);
    expect(deps._keyManagerConfig()).toEqual({
      platform: "software-vault",
      rootKeyPolicy: "passcode",
      operationalKeyPolicy: "open",
      vaultKeyPolicy: "biometric",
      biometricGating: {
        rootKeyCreation: true,
        operationalKeyRotation: true,
        scopeExpansion: false,
        egressExpansion: false,
        agentCreation: false,
      },
      dataDir: join(tempDir, "data"),
    });
  });

  test("start() transitions through states correctly", async () => {
    const tracker = createCallTracker();
    const config = makeConfig(tempDir);
    const deps = makeMockDeps(tracker);

    const result = await createSignetRuntime(config, deps);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    const runtime = result.value;

    expect(runtime.state).toBe("created");

    const startResult = await runtime.start();
    expect(Result.isOk(startResult)).toBe(true);
    expect(runtime.state).toBe("running");
  });

  test("start() initializes services in dependency order", async () => {
    const tracker = createCallTracker();
    const config = makeConfig(tempDir);
    const deps = makeMockDeps(tracker);

    const result = await createSignetRuntime(config, deps);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;

    await result.value.start();

    // Key manager initialized first, then local core init, then network
    // init (for non-local envs), then ws/admin servers.
    const initIdx = tracker.calls.indexOf("keyManager.initialize");
    const localIdx = tracker.calls.indexOf("signetCore.initializeLocal");
    const networkIdx = tracker.calls.indexOf("signetCore.initialize");
    const wsIdx = tracker.calls.indexOf("wsServer.start");
    const adminIdx = tracker.calls.indexOf("adminServer.start");

    expect(initIdx).toBeGreaterThanOrEqual(0);
    expect(localIdx).toBeGreaterThan(initIdx);
    expect(networkIdx).toBeGreaterThan(localIdx);
    expect(wsIdx).toBeGreaterThan(networkIdx);
    expect(adminIdx).toBeGreaterThan(wsIdx);
  });

  test("registers credential and signet actions before admin server is created", async () => {
    const tracker = createCallTracker();
    const config = makeConfig(tempDir);
    const deps = makeMockDeps(tracker);

    const result = await createSignetRuntime(config, deps);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;

    const dispatcher = deps._dispatcher();
    expect(dispatcher).toBeDefined();
    expect(dispatcher?.hasMethod("credential.issue")).toBe(true);
    expect(dispatcher?.hasMethod("credential.list")).toBe(true);
    expect(dispatcher?.hasMethod("credential.lookup")).toBe(true);
    expect(dispatcher?.hasMethod("credential.revoke")).toBe(true);
    expect(dispatcher?.hasMethod("signet.status")).toBe(true);
    expect(dispatcher?.hasMethod("signet.stop")).toBe(true);
  });

  test("skips network init in local env", async () => {
    const tracker = createCallTracker();
    const config = CliConfigSchema.parse({
      signet: { dataDir: join(tempDir, "data"), env: "local" },
      admin: { socketPath: join(tempDir, "admin.sock") },
      logging: { auditLogPath: join(tempDir, "audit.jsonl") },
    });
    const deps = makeMockDeps(tracker);

    const result = await createSignetRuntime(config, deps);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;

    const startResult = await result.value.start();
    expect(Result.isOk(startResult)).toBe(true);
    expect(result.value.state).toBe("running");
    expect(tracker.calls).not.toContain("signetCore.initialize");
  });

  test("shutdown() reverses in correct order", async () => {
    const tracker = createCallTracker();
    const config = makeConfig(tempDir);
    const deps = makeMockDeps(tracker);

    const result = await createSignetRuntime(config, deps);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    const runtime = result.value;

    await runtime.start();
    tracker.calls.length = 0; // Clear start calls

    const shutdownResult = await runtime.shutdown();
    expect(Result.isOk(shutdownResult)).toBe(true);
    expect(runtime.state).toBe("stopped");

    // Admin stopped first, then ws, then core
    const adminIdx = tracker.calls.indexOf("adminServer.stop");
    const wsIdx = tracker.calls.indexOf("wsServer.stop");
    const coreIdx = tracker.calls.indexOf("signetCore.shutdown");

    expect(adminIdx).toBeGreaterThanOrEqual(0);
    expect(wsIdx).toBeGreaterThan(adminIdx);
    expect(coreIdx).toBeGreaterThan(wsIdx);
  });

  test("key initialization failure transitions to error state", async () => {
    const tracker = createCallTracker();
    const config = makeConfig(tempDir);
    const deps = makeMockDeps(tracker);

    deps.createKeyManager = async () => {
      tracker.record("keyManager.create");
      return Result.err(InternalError.create("Vault unlock failed"));
    };

    const result = await createSignetRuntime(config, deps);

    // Creation itself should fail if key manager can't be created
    expect(Result.isError(result)).toBe(true);
    if (Result.isOk(result)) return;
    expect(result.error.message).toContain("Vault unlock failed");
  });

  test("config values passed through to correct components", async () => {
    const tracker = createCallTracker();
    const config = makeConfig(tempDir);
    const deps = makeMockDeps(tracker);

    const result = await createSignetRuntime(config, deps);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    const runtime = result.value;

    expect(runtime.config.ws.port).toBe(8393);
    expect(runtime.config.ws.host).toBe("127.0.0.1");
    expect(runtime.paths.adminSocket).toBe(join(tempDir, "admin.sock"));
    expect(runtime.paths.auditLog).toBe(join(tempDir, "audit.jsonl"));
  });

  test("status() reports actual bound port, not config port", async () => {
    const tracker = createCallTracker();
    // Config with port 0 (dynamic allocation)
    const config = CliConfigSchema.parse({
      signet: { dataDir: join(tempDir, "data") },
      admin: { socketPath: join(tempDir, "admin.sock") },
      logging: { auditLogPath: join(tempDir, "audit.jsonl") },
      ws: { port: 0 },
    });
    const deps = makeMockDeps(tracker);
    // Mock WS server returns port 9999 as the actual bound port
    deps.createWsServer = () => {
      tracker.record("wsServer.create");
      return {
        state: "idle" as const,
        connectionCount: 0,
        start: async () => {
          tracker.record("wsServer.start");
          return Result.ok({ port: 9999 });
        },
        stop: async () => {
          tracker.record("wsServer.stop");
          return Result.ok(undefined);
        },
        broadcast: () => {},
      };
    };

    const result = await createSignetRuntime(config, deps);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    const runtime = result.value;

    // Before start, status should report config port (0)
    const preStatus = await runtime.status();
    expect(preStatus.wsPort).toBe(0);

    await runtime.start();

    // After start, status should report the actual bound port
    const postStatus = await runtime.status();
    expect(postStatus.wsPort).toBe(9999);
  });

  test("PID file written on start and cleaned on shutdown", async () => {
    const tracker = createCallTracker();
    const config = makeConfig(tempDir);
    const deps = makeMockDeps(tracker);

    const result = await createSignetRuntime(config, deps);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    const runtime = result.value;

    await runtime.start();

    // PID file should exist
    const pidContent = await readFile(runtime.paths.pidFile, "utf-8");
    const pid = parseInt(pidContent.trim(), 10);
    expect(pid).toBe(process.pid);

    await runtime.shutdown();

    // PID file should be cleaned up
    const exists = await Bun.file(runtime.paths.pidFile).exists();
    expect(exists).toBe(false);
  });
});
