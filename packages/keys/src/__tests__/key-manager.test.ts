import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Result } from "better-result";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createKeyManager, type KeyManager } from "../key-manager.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("KeyManager", () => {
  let dataDir: string;
  let manager: KeyManager;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "km-test-"));
    const result = await createKeyManager({ dataDir });
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error("setup failed");
    manager = result.value;
  });

  afterEach(() => {
    manager.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe("initialize", () => {
    test("detects platform as software-vault for v0", () => {
      expect(manager.platform).toBe("software-vault");
    });

    test("maps software-vault to unverified trust tier", () => {
      expect(manager.trustTier).toBe("unverified");
    });

    test("creates a root key handle on initialization", async () => {
      const result = await manager.initialize();
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("init failed");
      expect(result.value.keyRef).toBeDefined();
      expect(result.value.publicKey).toBeDefined();
      expect(result.value.platform).toBe("software-vault");
    });

    test("returns existing root key on re-initialization", async () => {
      const r1 = await manager.initialize();
      const r2 = await manager.initialize();
      if (Result.isError(r1) || Result.isError(r2))
        throw new Error("init failed");
      expect(r1.value.keyRef).toBe(r2.value.keyRef);
    });
  });

  describe("operational keys", () => {
    test("creates an operational key", async () => {
      const result = await manager.createOperationalKey("agent-1", null);
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("create failed");
      expect(result.value.identityId).toBe("agent-1");
    });

    test("retrieves an operational key by identity", async () => {
      await manager.createOperationalKey("agent-1", null);
      const result = manager.getOperationalKey("agent-1");
      expect(Result.isOk(result)).toBe(true);
    });

    test("retrieves an operational key by group ID", async () => {
      await manager.createOperationalKey("agent-1", "group-a");
      const result = manager.getOperationalKeyByGroupId("group-a");
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("get failed");
      expect(result.value.groupId).toBe("group-a");
    });

    test("rotates an operational key", async () => {
      const original = await manager.createOperationalKey("agent-1", null);
      if (Result.isError(original)) throw new Error("create failed");

      const rotated = await manager.rotateOperationalKey("agent-1");
      expect(Result.isOk(rotated)).toBe(true);
      if (Result.isError(rotated)) throw new Error("rotate failed");
      expect(rotated.value.publicKey).not.toBe(original.value.publicKey);
    });

    test("lists all operational keys", async () => {
      await manager.createOperationalKey("agent-1", null);
      await manager.createOperationalKey("agent-2", "group-b");
      expect(manager.listOperationalKeys()).toHaveLength(2);
    });
  });

  describe("session keys", () => {
    test("issues a session key", async () => {
      const result = await manager.issueSessionKey("ses_1", 3600);
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("issue failed");
      expect(result.value.sessionId).toBe("ses_1");
    });

    test("revokes a session key", async () => {
      const issued = await manager.issueSessionKey("ses_2", 3600);
      if (Result.isError(issued)) throw new Error("issue failed");
      const result = manager.revokeSessionKey(issued.value.keyId);
      expect(Result.isOk(result)).toBe(true);
    });
  });

  describe("signing", () => {
    test("signs with operational key", async () => {
      await manager.createOperationalKey("agent-1", null);
      const result = await manager.signWithOperationalKey(
        "agent-1",
        new Uint8Array([1, 2, 3]),
      );
      expect(Result.isOk(result)).toBe(true);
    });

    test("signs with session key", async () => {
      const issued = await manager.issueSessionKey("ses_3", 3600);
      if (Result.isError(issued)) throw new Error("issue failed");
      const result = await manager.signWithSessionKey(
        issued.value.keyId,
        new Uint8Array([4, 5, 6]),
      );
      expect(Result.isOk(result)).toBe(true);
    });
  });

  describe("vault operations", () => {
    test("stores and retrieves a secret", async () => {
      const setResult = await manager.vaultSet(
        "api-key",
        encoder.encode("secret"),
      );
      expect(Result.isOk(setResult)).toBe(true);

      const getResult = await manager.vaultGet("api-key");
      expect(Result.isOk(getResult)).toBe(true);
      if (Result.isError(getResult)) throw new Error("get failed");
      expect(decoder.decode(getResult.value)).toBe("secret");
    });

    test("deletes a secret", async () => {
      await manager.vaultSet("key", encoder.encode("val"));
      const result = await manager.vaultDelete("key");
      expect(Result.isOk(result)).toBe(true);
    });

    test("lists vault secrets", async () => {
      await manager.vaultSet("a", encoder.encode("1"));
      await manager.vaultSet("b", encoder.encode("2"));
      const names = manager.vaultList();
      expect(names).toHaveLength(2);
    });
  });

  describe("getOrCreateDbKey", () => {
    test("returns a 32-byte key", async () => {
      const result = await manager.getOrCreateDbKey("agent-1");
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("getOrCreateDbKey failed");
      expect(result.value.byteLength).toBe(32);
    });

    test("returns the same key on repeated calls", async () => {
      const r1 = await manager.getOrCreateDbKey("agent-1");
      const r2 = await manager.getOrCreateDbKey("agent-1");
      if (Result.isError(r1) || Result.isError(r2))
        throw new Error("getOrCreateDbKey failed");
      expect(r1.value).toEqual(r2.value);
    });

    test("returns different keys for different identities", async () => {
      const r1 = await manager.getOrCreateDbKey("agent-1");
      const r2 = await manager.getOrCreateDbKey("agent-2");
      if (Result.isError(r1) || Result.isError(r2))
        throw new Error("getOrCreateDbKey failed");
      const same = r1.value.every((b, i) => b === r2.value[i]);
      expect(same).toBe(false);
    });

    test("persists key across close and reopen", async () => {
      const r1 = await manager.getOrCreateDbKey("agent-1");
      if (Result.isError(r1)) throw new Error("getOrCreateDbKey failed");

      manager.close();
      const reopened = await createKeyManager({ dataDir });
      if (Result.isError(reopened)) throw new Error("reopen failed");
      manager = reopened.value;

      const r2 = await manager.getOrCreateDbKey("agent-1");
      if (Result.isError(r2)) throw new Error("getOrCreateDbKey failed");
      expect(r1.value).toEqual(r2.value);
    });
  });
});
