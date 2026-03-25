import { describe, test, expect } from "bun:test";
import { Result } from "better-result";
import { NotFoundError } from "@xmtp/signet-schemas";
import type {
  KeyBackend,
  WalletInfo,
  AccountInfo,
  SigningResult,
  ApiKeyInfo,
} from "../key-backend.js";

/**
 * Minimal mock that satisfies the KeyBackend interface.
 * Every method returns a success Result with stub data.
 */
function createMockBackend(provider: "internal" | "ows"): KeyBackend {
  const wallets: WalletInfo[] = [];
  const accounts: AccountInfo[] = [];

  return {
    provider,

    async createWallet(label, _passphrase) {
      const info: WalletInfo = {
        id: "w-1",
        label,
        provider,
        accountCount: 0,
        createdAt: new Date().toISOString(),
      };
      wallets.push(info);
      return Result.ok(info);
    },

    async deleteWallet(_walletId) {
      return Result.ok(undefined);
    },

    async listWallets() {
      return Result.ok(wallets);
    },

    async getWallet(walletId) {
      const wallet = wallets.find((w) => w.id === walletId);
      if (!wallet) {
        return Result.err(NotFoundError.create("Wallet", walletId));
      }
      return Result.ok(wallet);
    },

    async deriveAccount(_walletId, chain) {
      const info: AccountInfo = {
        index: accounts.length,
        address: chain === "evm" ? "0xabc" : "ed25519addr",
        chain,
        publicKey: "0xdeadbeef",
      };
      accounts.push(info);
      return Result.ok(info);
    },

    async listAccounts(_walletId) {
      return Result.ok(accounts);
    },

    async sign(_walletId, _accountIndex, _data) {
      const result: SigningResult = {
        signature: new Uint8Array([1, 2, 3]),
        publicKey: new Uint8Array([4, 5, 6]),
        algorithm: "secp256k1",
      };
      return Result.ok(result);
    },

    async getXmtpIdentityKey(_walletId, _accountIndex) {
      return Result.ok(`0x${"11".repeat(32)}` as `0x${string}`);
    },

    async createApiKey(_walletId, _credentialId, _passphrase, expiresAt) {
      const info: ApiKeyInfo = {
        id: "ak-1",
        walletId: "w-1",
        token: "tok_secret",
        expiresAt,
      };
      return Result.ok(info);
    },

    async revokeApiKey(_keyId) {
      return Result.ok(undefined);
    },

    async signWithApiKey(_token, _accountIndex, _data) {
      const result: SigningResult = {
        signature: new Uint8Array([7, 8, 9]),
        publicKey: new Uint8Array([10, 11, 12]),
        algorithm: "ed25519",
      };
      return Result.ok(result);
    },
  };
}

describe("KeyBackend", () => {
  describe("interface contract", () => {
    test("internal provider can be instantiated", () => {
      const backend = createMockBackend("internal");
      expect(backend.provider).toBe("internal");
    });

    test("ows provider can be instantiated", () => {
      const backend = createMockBackend("ows");
      expect(backend.provider).toBe("ows");
    });
  });

  describe("wallet operations", () => {
    test("createWallet returns WalletInfo on success", async () => {
      const backend = createMockBackend("internal");
      const result = await backend.createWallet("My Wallet", "passphrase");
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;
      expect(result.value.id).toBe("w-1");
      expect(result.value.label).toBe("My Wallet");
      expect(result.value.provider).toBe("internal");
      expect(result.value.accountCount).toBe(0);
      expect(typeof result.value.createdAt).toBe("string");
    });

    test("getWallet returns error for missing wallet", async () => {
      const backend = createMockBackend("internal");
      const result = await backend.getWallet("nonexistent");
      expect(Result.isError(result)).toBe(true);
    });

    test("listWallets returns readonly array", async () => {
      const backend = createMockBackend("internal");
      await backend.createWallet("W1", "pass");
      const result = await backend.listWallets();
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;
      expect(result.value.length).toBe(1);
    });

    test("deleteWallet returns void on success", async () => {
      const backend = createMockBackend("internal");
      const result = await backend.deleteWallet("w-1");
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;
      expect(result.value).toBeUndefined();
    });
  });

  describe("account derivation", () => {
    test("deriveAccount returns AccountInfo with correct chain", async () => {
      const backend = createMockBackend("internal");
      const result = await backend.deriveAccount("w-1", "evm");
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;
      expect(result.value.chain).toBe("evm");
      expect(result.value.index).toBe(0);
      expect(typeof result.value.address).toBe("string");
      expect(typeof result.value.publicKey).toBe("string");
    });

    test("listAccounts returns readonly array", async () => {
      const backend = createMockBackend("internal");
      await backend.deriveAccount("w-1", "ed25519");
      const result = await backend.listAccounts("w-1");
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;
      expect(result.value.length).toBe(1);
      expect(result.value[0]?.chain).toBe("ed25519");
    });
  });

  describe("signing", () => {
    test("sign returns SigningResult", async () => {
      const backend = createMockBackend("internal");
      const data = new Uint8Array([0xff, 0x00]);
      const result = await backend.sign("w-1", 0, data);
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;
      expect(result.value.signature).toBeInstanceOf(Uint8Array);
      expect(result.value.publicKey).toBeInstanceOf(Uint8Array);
      expect(result.value.algorithm).toBe("secp256k1");
    });

    test("signWithApiKey returns SigningResult", async () => {
      const backend = createMockBackend("internal");
      const data = new Uint8Array([0x01]);
      const result = await backend.signWithApiKey("tok_secret", 0, data);
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;
      expect(result.value.signature).toBeInstanceOf(Uint8Array);
      expect(result.value.algorithm).toBe("ed25519");
    });
  });

  describe("api key management", () => {
    test("createApiKey returns ApiKeyInfo", async () => {
      const backend = createMockBackend("internal");
      const expires = new Date(Date.now() + 86400000).toISOString();
      const result = await backend.createApiKey(
        "w-1",
        "cred-1",
        "pass",
        expires,
      );
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;
      expect(result.value.id).toBe("ak-1");
      expect(result.value.walletId).toBe("w-1");
      expect(typeof result.value.token).toBe("string");
      expect(result.value.expiresAt).toBe(expires);
    });

    test("revokeApiKey returns void on success", async () => {
      const backend = createMockBackend("internal");
      const result = await backend.revokeApiKey("ak-1");
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;
      expect(result.value).toBeUndefined();
    });
  });
});
