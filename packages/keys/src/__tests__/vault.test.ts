import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Result } from "better-result";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createVault, type Vault } from "../vault.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("Vault", () => {
  let dataDir: string;
  let vault: Vault;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "vault-test-"));
    const result = await createVault(dataDir);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error("setup failed");
    vault = result.value;
  });

  afterEach(() => {
    vault.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe("set and get", () => {
    test("stores and retrieves a secret", async () => {
      const data = encoder.encode("my-secret-value");
      const setResult = await vault.set("api-key", data);
      expect(Result.isOk(setResult)).toBe(true);

      const getResult = await vault.get("api-key");
      expect(Result.isOk(getResult)).toBe(true);
      if (Result.isError(getResult)) throw new Error("get failed");
      expect(decoder.decode(getResult.value)).toBe("my-secret-value");
    });

    test("overwrites existing secret", async () => {
      await vault.set("key", encoder.encode("v1"));
      await vault.set("key", encoder.encode("v2"));

      const result = await vault.get("key");
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("get failed");
      expect(decoder.decode(result.value)).toBe("v2");
    });

    test("returns NotFoundError for missing secret", async () => {
      const result = await vault.get("nonexistent");
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error._tag).toBe("NotFoundError");
    });
  });

  describe("delete", () => {
    test("removes an existing secret", async () => {
      await vault.set("key", encoder.encode("val"));
      const delResult = await vault.delete("key");
      expect(Result.isOk(delResult)).toBe(true);

      const getResult = await vault.get("key");
      expect(Result.isError(getResult)).toBe(true);
    });

    test("returns NotFoundError for missing secret", async () => {
      const result = await vault.delete("nonexistent");
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error._tag).toBe("NotFoundError");
    });
  });

  describe("list", () => {
    test("returns empty list initially", () => {
      expect(vault.list()).toEqual([]);
    });

    test("lists stored secret names", async () => {
      await vault.set("a", encoder.encode("1"));
      await vault.set("b", encoder.encode("2"));
      await vault.set("c", encoder.encode("3"));

      const names = vault.list();
      expect(names).toHaveLength(3);
      expect([...names].sort()).toEqual(["a", "b", "c"]);
    });

    test("does not include deleted secrets", async () => {
      await vault.set("a", encoder.encode("1"));
      await vault.set("b", encoder.encode("2"));
      await vault.delete("a");

      expect(vault.list()).toEqual(["b"]);
    });
  });

  describe("encryption at rest", () => {
    test("stored data is not plaintext in the database", async () => {
      const secret = "super-secret-password-12345";
      await vault.set("test-enc", encoder.encode(secret));

      // Read the raw database file and check the secret is not in plaintext
      const dbPath = join(dataDir, "vault.db");
      const raw = await Bun.file(dbPath).arrayBuffer();
      const rawStr = decoder.decode(raw);
      expect(rawStr).not.toContain(secret);
    });

    test("creates a vault.key file with 32 random bytes", async () => {
      const keyPath = join(dataDir, "vault.key");
      const keyFile = Bun.file(keyPath);
      expect(await keyFile.exists()).toBe(true);
      const keyBytes = new Uint8Array(await keyFile.arrayBuffer());
      expect(keyBytes.byteLength).toBe(32);
    });

    test("vault.key is not all zeros", async () => {
      const keyPath = join(dataDir, "vault.key");
      const keyBytes = new Uint8Array(await Bun.file(keyPath).arrayBuffer());
      const allZero = keyBytes.every((b) => b === 0);
      expect(allZero).toBe(false);
    });
  });

  describe("persistence", () => {
    test("survives close and reopen", async () => {
      await vault.set("persist-key", encoder.encode("persist-value"));
      vault.close();

      const result2 = await createVault(dataDir);
      expect(Result.isOk(result2)).toBe(true);
      if (Result.isError(result2)) throw new Error("reopen failed");
      const vault2 = result2.value;

      const getResult = await vault2.get("persist-key");
      expect(Result.isOk(getResult)).toBe(true);
      if (Result.isError(getResult)) throw new Error("get failed");
      expect(decoder.decode(getResult.value)).toBe("persist-value");
      vault2.close();
    });
  });
});
