import { describe, test, expect, afterEach, beforeAll } from "bun:test";
import { Result } from "better-result";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createDirectClient,
  DirectModeConfigSchema,
  type DirectModeDeps,
} from "../direct/client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testCounter = 0;
const TEST_DIR = join(tmpdir(), "xb-direct-test");

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const d of cleanupDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  cleanupDirs.length = 0;
});

function testDataDir(): string {
  testCounter++;
  const dir = join(TEST_DIR, `data-${Date.now()}-${testCounter}`);
  mkdirSync(dir, { recursive: true });
  cleanupDirs.push(dir);
  return dir;
}

/** Mock deps that simulate successful key manager and client factory. */
function makeMockDeps(): DirectModeDeps {
  const closeFns: Array<() => void> = [];

  return {
    createKeyManager: async (_config) => {
      return Result.ok({
        async initialize() {
          return Result.ok({ fingerprint: "test-root-fp" });
        },
        async createOperationalKey(identityId: string) {
          return Result.ok({
            identityId,
            publicKey: "deadbeef",
            fingerprint: "op-fp",
            groupId: null,
            createdAt: new Date().toISOString(),
          });
        },
        getOperationalKey(identityId: string) {
          return Result.ok({
            identityId,
            publicKey: "deadbeef",
            fingerprint: "op-fp",
            groupId: null,
            createdAt: new Date().toISOString(),
          });
        },
        async getOrCreateDbKey() {
          return Result.ok(new Uint8Array(32));
        },
        async signWithOperationalKey() {
          return Result.ok(new Uint8Array(64));
        },
        close() {
          closeFns.push(() => {});
        },
      });
    },
    createXmtpClient: async (_config, _signerProvider) => {
      return Result.ok({
        inboxId: "test-inbox-id",
        async sendMessage() {
          return Result.ok("msg-id");
        },
        async syncAll() {
          return Result.ok(undefined);
        },
        async syncGroup() {
          return Result.ok(undefined);
        },
        async getGroupInfo() {
          return Result.ok({
            groupId: "g1",
            name: "test",
            description: "",
            memberInboxIds: [],
            createdAt: new Date().toISOString(),
          });
        },
        async listGroups() {
          return Result.ok([]);
        },
        async addMembers() {
          return Result.ok(undefined);
        },
        async removeMembers() {
          return Result.ok(undefined);
        },
        async streamAllMessages() {
          return Result.ok({
            messages: (async function* () {})(),
            abort() {},
          });
        },
        async streamGroups() {
          return Result.ok({
            groups: (async function* () {})(),
            abort() {},
          });
        },
      });
    },
    closed: closeFns,
  };
}

// ---------------------------------------------------------------------------
// Schema Tests
// ---------------------------------------------------------------------------

describe("DirectModeConfigSchema", () => {
  test("accepts valid config with defaults", () => {
    const result = DirectModeConfigSchema.safeParse({
      dataDir: "/tmp/test",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.env).toBe("dev");
      expect(result.data.dataDir).toBe("/tmp/test");
    }
  });

  test("accepts explicit env", () => {
    const result = DirectModeConfigSchema.safeParse({
      env: "production",
      dataDir: "/tmp/test",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.env).toBe("production");
    }
  });

  test("rejects missing dataDir", () => {
    const result = DirectModeConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Direct Client Tests
// ---------------------------------------------------------------------------

describe("createDirectClient", () => {
  test("creates client with valid config and mock deps", async () => {
    const config: DirectModeConfig = {
      env: "dev",
      dataDir: testDataDir(),
    };

    const deps = makeMockDeps();
    const result = await createDirectClient(config, deps);

    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      const client = result.value;
      expect(client.mode).toBe("direct");
      expect(client.xmtpClient).toBeDefined();
      expect(client.xmtpClient.inboxId).toBe("test-inbox-id");
      await client.close();
    }
  });

  test("close tears down resources", async () => {
    const config: DirectModeConfig = {
      env: "dev",
      dataDir: testDataDir(),
    };

    const deps = makeMockDeps();
    const result = await createDirectClient(config, deps);

    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      const client = result.value;
      // Should not throw
      await client.close();
    }
  });

  test("returns error when key manager creation fails", async () => {
    const config: DirectModeConfig = {
      env: "dev",
      dataDir: testDataDir(),
    };

    const deps = makeMockDeps();
    deps.createKeyManager = async () => {
      const { InternalError } = await import("@xmtp/signet-schemas");
      return Result.err(InternalError.create("Vault locked"));
    };

    const result = await createDirectClient(config, deps);

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.message).toContain("Vault locked");
    }
  });

  test("returns error when XMTP client creation fails", async () => {
    const config: DirectModeConfig = {
      env: "dev",
      dataDir: testDataDir(),
    };

    const deps = makeMockDeps();
    deps.createXmtpClient = async () => {
      const { InternalError } = await import("@xmtp/signet-schemas");
      return Result.err(InternalError.create("Network unreachable"));
    };

    const result = await createDirectClient(config, deps);

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.message).toContain("Network unreachable");
    }
  });
});
