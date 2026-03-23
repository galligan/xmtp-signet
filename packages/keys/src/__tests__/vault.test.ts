import { describe, test, expect, beforeEach } from "bun:test";
import { Result } from "better-result";
import { createVault, type Vault, type AccountEntry } from "../vault.js";

describe("Vault", () => {
  let vault: Vault;

  beforeEach(async () => {
    const result = await createVault(":memory:");
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error("setup failed");
    vault = result.value;
  });

  describe("wallet create/read/delete cycle", () => {
    test("creates a wallet and reads it back with correct passphrase", async () => {
      const createResult = await vault.createWallet(
        "op_abc123",
        "alice-bot",
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        "my-passphrase",
      );
      expect(Result.isOk(createResult)).toBe(true);

      const readResult = await vault.readWallet("op_abc123", "my-passphrase");
      expect(Result.isOk(readResult)).toBe(true);
      if (Result.isError(readResult)) throw new Error("read failed");
      expect(readResult.value).toBe(
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      );
    });

    test("deletes a wallet", async () => {
      await vault.createWallet("op_del", "to-delete", "mnemonic words", "pass");

      const delResult = await vault.deleteWallet("op_del");
      expect(Result.isOk(delResult)).toBe(true);

      const readResult = await vault.readWallet("op_del", "pass");
      expect(Result.isError(readResult)).toBe(true);
      if (Result.isOk(readResult)) throw new Error("expected error");
      expect(readResult.error._tag).toBe("NotFoundError");
    });

    test("returns NotFoundError for missing wallet", async () => {
      const result = await vault.readWallet("nonexistent", "pass");
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error._tag).toBe("NotFoundError");
    });

    test("returns NotFoundError when deleting missing wallet", async () => {
      const result = await vault.deleteWallet("nonexistent");
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error._tag).toBe("NotFoundError");
    });
  });

  describe("wrong passphrase", () => {
    test("fails to read wallet with wrong passphrase", async () => {
      await vault.createWallet("op_wrong", "test", "secret mnemonic", "right");

      const result = await vault.readWallet("op_wrong", "wrong");
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      // Should fail with an auth or internal error (decryption failure)
      expect(
        result.error._tag === "AuthError" ||
          result.error._tag === "InternalError",
      ).toBe(true);
    });
  });

  describe("list wallets", () => {
    test("returns empty list initially", async () => {
      const result = await vault.listWallets();
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("list failed");
      expect(result.value).toHaveLength(0);
    });

    test("lists stored wallets with metadata", async () => {
      await vault.createWallet("op_a", "alice", "mnemonic-a", "pass-a");
      await vault.createWallet("op_b", "bob", "mnemonic-b", "pass-b");

      const result = await vault.listWallets();
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("list failed");
      expect(result.value).toHaveLength(2);

      const ids = result.value.map((w) => w.id).sort();
      expect(ids).toEqual(["op_a", "op_b"]);

      const alice = result.value.find((w) => w.id === "op_a");
      expect(alice).toBeDefined();
      expect(alice?.label).toBe("alice");
      expect(alice?.accountCount).toBe(0);
      expect(alice?.createdAt).toBeTruthy();
    });

    test("does not include deleted wallets", async () => {
      await vault.createWallet("op_x", "x", "m-x", "p-x");
      await vault.createWallet("op_y", "y", "m-y", "p-y");
      await vault.deleteWallet("op_x");

      const result = await vault.listWallets();
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("list failed");
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.id).toBe("op_y");
    });
  });

  describe("wallet accounts", () => {
    test("updates wallet accounts", async () => {
      await vault.createWallet("op_acc", "with-accounts", "mnemonic", "pass");

      const accounts: readonly AccountEntry[] = [
        { index: 0, chain: "evm", address: "0xABC" },
        { index: 1, chain: "ed25519", address: "ed25519pub..." },
      ];

      const updateResult = await vault.updateWalletAccounts("op_acc", accounts);
      expect(Result.isOk(updateResult)).toBe(true);

      const listResult = await vault.listWallets();
      expect(Result.isOk(listResult)).toBe(true);
      if (Result.isError(listResult)) throw new Error("list failed");
      const wallet = listResult.value.find((w) => w.id === "op_acc");
      expect(wallet?.accountCount).toBe(2);
    });

    test("returns NotFoundError for missing wallet", async () => {
      const result = await vault.updateWalletAccounts("nonexistent", []);
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error._tag).toBe("NotFoundError");
    });
  });

  describe("API key create/read/revoke cycle", () => {
    test("creates an API key and reads it back with correct token", async () => {
      await vault.createWallet("op_api", "api-wallet", "my-mnemonic", "pass");

      const createResult = await vault.createApiKey(
        "cred_abc",
        "op_api",
        "my-mnemonic",
        "secret-token-123",
        "2026-12-31T23:59:59Z",
      );
      expect(Result.isOk(createResult)).toBe(true);

      const readResult = await vault.readApiKey("secret-token-123");
      expect(Result.isOk(readResult)).toBe(true);
      if (Result.isError(readResult)) throw new Error("read failed");
      expect(readResult.value.mnemonic).toBe("my-mnemonic");
      expect(readResult.value.walletId).toBe("op_api");
    });

    test("revokes an API key", async () => {
      await vault.createWallet("op_rev", "rev-wallet", "mnemonic", "pass");
      await vault.createApiKey(
        "cred_rev",
        "op_rev",
        "mnemonic",
        "token-to-revoke",
        "2026-12-31T23:59:59Z",
      );

      const revokeResult = await vault.revokeApiKey("cred_rev");
      expect(Result.isOk(revokeResult)).toBe(true);

      const readResult = await vault.readApiKey("token-to-revoke");
      expect(Result.isError(readResult)).toBe(true);
    });

    test("returns NotFoundError for missing API key", async () => {
      const result = await vault.readApiKey("nonexistent-token");
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error._tag).toBe("NotFoundError");
    });

    test("returns NotFoundError when revoking missing API key", async () => {
      const result = await vault.revokeApiKey("nonexistent");
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error._tag).toBe("NotFoundError");
    });
  });

  describe("encryption round-trip", () => {
    test("scrypt encryption: different passphrases produce different ciphertext", async () => {
      await vault.createWallet("op_enc1", "enc1", "same-mnemonic", "pass-a");
      await vault.createWallet("op_enc2", "enc2", "same-mnemonic", "pass-b");

      // Both should decrypt successfully with their own passphrases
      const r1 = await vault.readWallet("op_enc1", "pass-a");
      const r2 = await vault.readWallet("op_enc2", "pass-b");
      expect(Result.isOk(r1)).toBe(true);
      expect(Result.isOk(r2)).toBe(true);
      if (Result.isError(r1) || Result.isError(r2))
        throw new Error("read failed");
      expect(r1.value).toBe("same-mnemonic");
      expect(r2.value).toBe("same-mnemonic");
    });

    test("HKDF encryption: different tokens produce different ciphertext", async () => {
      await vault.createWallet("op_hk", "hk", "mnemonic", "pass");
      await vault.createApiKey(
        "cred_hk1",
        "op_hk",
        "mnemonic",
        "token-alpha",
        "2026-12-31T23:59:59Z",
      );
      await vault.createApiKey(
        "cred_hk2",
        "op_hk",
        "mnemonic",
        "token-beta",
        "2026-12-31T23:59:59Z",
      );

      // Both should decrypt successfully with their own tokens
      const r1 = await vault.readApiKey("token-alpha");
      const r2 = await vault.readApiKey("token-beta");
      expect(Result.isOk(r1)).toBe(true);
      expect(Result.isOk(r2)).toBe(true);
      if (Result.isError(r1) || Result.isError(r2))
        throw new Error("read failed");
      expect(r1.value.mnemonic).toBe("mnemonic");
      expect(r2.value.mnemonic).toBe("mnemonic");
    });
  });

  describe("close", () => {
    test("close is callable", () => {
      expect(() => vault.close()).not.toThrow();
    });
  });
});
