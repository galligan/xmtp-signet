import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Result } from "better-result";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createVault, type Vault } from "../vault.js";
import {
  createOperationalKeyManager,
  type OperationalKeyManager,
} from "../operational-key.js";

describe("OperationalKeyManager", () => {
  let dataDir: string;
  let vault: Vault;
  let opKeys: OperationalKeyManager;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "opkey-test-"));
    const vaultResult = await createVault(dataDir);
    if (Result.isError(vaultResult)) throw new Error("vault setup failed");
    vault = vaultResult.value;
    opKeys = createOperationalKeyManager(vault);
  });

  afterEach(() => {
    vault.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe("create", () => {
    test("creates an operational key for an identity", async () => {
      const result = await opKeys.create("agent-1", null);
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("create failed");

      const key = result.value;
      expect(key.keyId).toMatch(/^key_[0-9a-f]{8}$/);
      expect(key.identityId).toBe("agent-1");
      expect(key.groupId).toBeNull();
      expect(key.publicKey).toMatch(/^[0-9a-f]+$/);
      expect(key.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(key.createdAt).toBeDefined();
      expect(key.rotatedAt).toBeNull();
    });

    test("creates a per-group operational key", async () => {
      const result = await opKeys.create("agent-1", "group-a");
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("create failed");
      expect(result.value.groupId).toBe("group-a");
    });

    test("creates separate keys for different identities", async () => {
      const r1 = await opKeys.create("agent-1", null);
      const r2 = await opKeys.create("agent-2", null);
      if (Result.isError(r1) || Result.isError(r2))
        throw new Error("create failed");
      expect(r1.value.publicKey).not.toBe(r2.value.publicKey);
    });
  });

  describe("get", () => {
    test("retrieves an existing key by identity", async () => {
      const created = await opKeys.create("agent-1", null);
      if (Result.isError(created)) throw new Error("create failed");

      const result = opKeys.get("agent-1");
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("get failed");
      expect(result.value.keyId).toBe(created.value.keyId);
    });

    test("returns NotFoundError for unknown identity", () => {
      const result = opKeys.get("unknown");
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error._tag).toBe("NotFoundError");
    });
  });

  describe("getByGroupId", () => {
    test("retrieves a key by group ID", async () => {
      await opKeys.create("agent-1", "group-a");
      const result = opKeys.getByGroupId("group-a");
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("get failed");
      expect(result.value.groupId).toBe("group-a");
    });

    test("returns NotFoundError for unknown group", () => {
      const result = opKeys.getByGroupId("unknown-group");
      expect(Result.isError(result)).toBe(true);
    });
  });

  describe("rotate", () => {
    test("replaces the key material for an identity", async () => {
      const original = await opKeys.create("agent-1", null);
      if (Result.isError(original)) throw new Error("create failed");

      const rotated = await opKeys.rotate("agent-1");
      expect(Result.isOk(rotated)).toBe(true);
      if (Result.isError(rotated)) throw new Error("rotate failed");

      expect(rotated.value.keyId).not.toBe(original.value.keyId);
      expect(rotated.value.publicKey).not.toBe(original.value.publicKey);
      expect(rotated.value.rotatedAt).not.toBeNull();
    });

    test("returns NotFoundError for unknown identity", async () => {
      const result = await opKeys.rotate("unknown");
      expect(Result.isError(result)).toBe(true);
    });
  });

  describe("list", () => {
    test("returns empty list initially", () => {
      expect(opKeys.list()).toEqual([]);
    });

    test("lists all operational keys", async () => {
      await opKeys.create("agent-1", null);
      await opKeys.create("agent-2", "group-b");

      const keys = opKeys.list();
      expect(keys).toHaveLength(2);
    });
  });

  describe("sign", () => {
    test("signs data with an operational key", async () => {
      await opKeys.create("agent-1", null);
      const data = new Uint8Array([1, 2, 3]);
      const result = await opKeys.sign("agent-1", data);
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("sign failed");
      expect(result.value.byteLength).toBeGreaterThan(0);
    });

    test("returns NotFoundError for unknown identity", async () => {
      const result = await opKeys.sign("unknown", new Uint8Array([1]));
      expect(Result.isError(result)).toBe(true);
    });

    test("signs with persisted key material after manager recreation", async () => {
      await opKeys.create("agent-1", null);

      const reloadedManager = createOperationalKeyManager(vault);
      const result = await reloadedManager.sign(
        "agent-1",
        new Uint8Array([1, 2, 3]),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("sign failed");
      expect(result.value.byteLength).toBeGreaterThan(0);
    });
  });
});
