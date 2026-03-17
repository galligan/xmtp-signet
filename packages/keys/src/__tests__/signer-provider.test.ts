import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Result } from "better-result";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createKeyManager, type KeyManager } from "../key-manager.js";
import { createSignerProvider } from "../signer-provider.js";
import type { SignerProvider } from "@xmtp/signet-contracts";

describe("SignerProvider", () => {
  let dataDir: string;
  let manager: KeyManager;
  let provider: SignerProvider;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "sp-test-"));
    const result = await createKeyManager({ dataDir });
    if (Result.isError(result)) throw new Error("setup failed");
    manager = result.value;
    await manager.createOperationalKey("agent-1", null);
    provider = createSignerProvider(manager, "agent-1");
  });

  afterEach(() => {
    manager.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe("sign", () => {
    test("signs data and returns bytes", async () => {
      const result = await provider.sign(new Uint8Array([1, 2, 3]));
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("sign failed");
      expect(result.value.byteLength).toBeGreaterThan(0);
    });
  });

  describe("getPublicKey", () => {
    test("returns public key bytes", async () => {
      const result = await provider.getPublicKey();
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("getPublicKey failed");
      // Ed25519 public key is 32 bytes
      expect(result.value.byteLength).toBe(32);
    });
  });

  describe("getFingerprint", () => {
    test("returns hex SHA-256 fingerprint", async () => {
      const result = await provider.getFingerprint();
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("getFingerprint failed");
      expect(result.value).toMatch(/^[0-9a-f]{64}$/);
    });

    test("matches the operational key fingerprint", async () => {
      const fp = await provider.getFingerprint();
      if (Result.isError(fp)) throw new Error("getFingerprint failed");

      const opKey = manager.getOperationalKey("agent-1");
      if (Result.isError(opKey)) throw new Error("getOperationalKey failed");
      expect(fp.value).toBe(opKey.value.fingerprint);
    });
  });

  describe("getDbEncryptionKey", () => {
    test("returns a 32-byte key", async () => {
      const result = await provider.getDbEncryptionKey();
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("getDbEncryptionKey failed");
      expect(result.value.byteLength).toBe(32);
    });

    test("returns the same key for the same identity", async () => {
      const r1 = await provider.getDbEncryptionKey();
      const r2 = await provider.getDbEncryptionKey();
      if (Result.isError(r1) || Result.isError(r2))
        throw new Error("getDbEncryptionKey failed");
      expect(r1.value).toEqual(r2.value);
    });

    test("returns different keys for different identities", async () => {
      await manager.createOperationalKey("agent-2", null);
      const provider2 = createSignerProvider(manager, "agent-2");

      const r1 = await provider.getDbEncryptionKey();
      const r2 = await provider2.getDbEncryptionKey();
      if (Result.isError(r1) || Result.isError(r2))
        throw new Error("getDbEncryptionKey failed");

      // Keys should be different for different identities
      const same = r1.value.every((b, i) => b === r2.value[i]);
      expect(same).toBe(false);
    });

    test("key is NOT derivable from public key and identity ID", async () => {
      // Two managers with the same identity but different vaults must
      // produce different DB encryption keys — proving the key is
      // vault-backed random material, not derived from public inputs.
      const dataDir2 = mkdtempSync(join(tmpdir(), "sp-test-2-"));
      const result2 = await createKeyManager({ dataDir: dataDir2 });
      if (Result.isError(result2)) throw new Error("setup failed");
      const manager2 = result2.value;

      try {
        await manager2.createOperationalKey("agent-1", null);
        const provider2 = createSignerProvider(manager2, "agent-1");

        const r1 = await provider.getDbEncryptionKey();
        const r2 = await provider2.getDbEncryptionKey();
        if (Result.isError(r1) || Result.isError(r2))
          throw new Error("getDbEncryptionKey failed");

        // Same identity, different vaults => different keys
        const same = r1.value.every((b, i) => b === r2.value[i]);
        expect(same).toBe(false);
      } finally {
        manager2.close();
        rmSync(dataDir2, { recursive: true, force: true });
      }
    });

    test("key survives vault close and reopen", async () => {
      const r1 = await provider.getDbEncryptionKey();
      if (Result.isError(r1)) throw new Error("getDbEncryptionKey failed");

      // Close and reopen manager with the same dataDir
      manager.close();
      const reopened = await createKeyManager({ dataDir });
      if (Result.isError(reopened)) throw new Error("reopen failed");
      manager = reopened.value;

      await manager.createOperationalKey("agent-1", null);
      const provider2 = createSignerProvider(manager, "agent-1");
      const r2 = await provider2.getDbEncryptionKey();
      if (Result.isError(r2)) throw new Error("getDbEncryptionKey failed");

      expect(r1.value).toEqual(r2.value);
    });
  });
});
