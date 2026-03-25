import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Result } from "better-result";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { createVault, type Vault } from "../vault.js";
import type { KeyBackend } from "../key-backend.js";

// Will be implemented in key-manager.ts
import { createInternalKeyBackend } from "../key-manager.js";

const PASSPHRASE = "test-passphrase-secure";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("createInternalKeyBackend", () => {
  let vault: Vault;
  let backend: KeyBackend;

  beforeEach(async () => {
    const vaultResult = await createVault(":memory:");
    if (Result.isError(vaultResult)) throw new Error("vault setup failed");
    vault = vaultResult.value;
    backend = createInternalKeyBackend(vault, PASSPHRASE);
  });

  afterEach(() => {
    vault.close();
  });

  test("has provider set to internal", () => {
    expect(backend.provider).toBe("internal");
  });

  // ---------------------------------------------------------------------------
  // Wallet operations
  // ---------------------------------------------------------------------------

  describe("wallet operations", () => {
    test("creates a wallet and returns WalletInfo", async () => {
      const result = await backend.createWallet("My Wallet", PASSPHRASE);
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("create failed");
      expect(result.value.label).toBe("My Wallet");
      expect(result.value.provider).toBe("internal");
      expect(result.value.accountCount).toBe(0);
      expect(result.value.id).toBeDefined();
      expect(result.value.createdAt).toBeDefined();
    });

    test("lists created wallets", async () => {
      await backend.createWallet("W1", PASSPHRASE);
      await backend.createWallet("W2", PASSPHRASE);
      const result = await backend.listWallets();
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("list failed");
      expect(result.value).toHaveLength(2);
    });

    test("gets a wallet by ID", async () => {
      const created = await backend.createWallet("W1", PASSPHRASE);
      if (Result.isError(created)) throw new Error("create failed");
      const result = await backend.getWallet(created.value.id);
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("get failed");
      expect(result.value.label).toBe("W1");
    });

    test("returns error for nonexistent wallet", async () => {
      const result = await backend.getWallet("nonexistent");
      expect(Result.isError(result)).toBe(true);
    });

    test("deletes a wallet", async () => {
      const created = await backend.createWallet("W1", PASSPHRASE);
      if (Result.isError(created)) throw new Error("create failed");
      const deleteResult = await backend.deleteWallet(created.value.id);
      expect(Result.isOk(deleteResult)).toBe(true);
      const getResult = await backend.getWallet(created.value.id);
      expect(Result.isError(getResult)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Account derivation
  // ---------------------------------------------------------------------------

  describe("account derivation", () => {
    test("derives an EVM account from a wallet", async () => {
      const created = await backend.createWallet("W1", PASSPHRASE);
      if (Result.isError(created)) throw new Error("create failed");
      const result = await backend.deriveAccount(created.value.id, "evm");
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("derive failed");
      expect(result.value.chain).toBe("evm");
      expect(result.value.index).toBe(0);
      expect(result.value.address).toMatch(/^0x[0-9a-f]{40}$/);
      expect(result.value.publicKey).toBeDefined();
    });

    test("derives an Ed25519 account from a wallet", async () => {
      const created = await backend.createWallet("W1", PASSPHRASE);
      if (Result.isError(created)) throw new Error("create failed");
      const result = await backend.deriveAccount(created.value.id, "ed25519");
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("derive failed");
      expect(result.value.chain).toBe("ed25519");
      expect(result.value.index).toBe(0);
      expect(result.value.publicKey).toBeDefined();
    });

    test("increments index for each derived account", async () => {
      const created = await backend.createWallet("W1", PASSPHRASE);
      if (Result.isError(created)) throw new Error("create failed");
      const a0 = await backend.deriveAccount(created.value.id, "evm");
      const a1 = await backend.deriveAccount(created.value.id, "evm");
      if (Result.isError(a0) || Result.isError(a1))
        throw new Error("derive failed");
      expect(a0.value.index).toBe(0);
      expect(a1.value.index).toBe(1);
      expect(a0.value.address).not.toBe(a1.value.address);
    });

    test("lists accounts for a wallet", async () => {
      const created = await backend.createWallet("W1", PASSPHRASE);
      if (Result.isError(created)) throw new Error("create failed");
      await backend.deriveAccount(created.value.id, "evm");
      await backend.deriveAccount(created.value.id, "ed25519");
      const result = await backend.listAccounts(created.value.id);
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("list failed");
      expect(result.value).toHaveLength(2);
    });

    test("returns error when deriving from nonexistent wallet", async () => {
      const result = await backend.deriveAccount("nonexistent", "evm");
      expect(Result.isError(result)).toBe(true);
    });

    test("reloads persisted wallet state in a fresh backend instance", async () => {
      const created = await backend.createWallet("W1", PASSPHRASE);
      if (Result.isError(created)) throw new Error("create failed");
      await backend.deriveAccount(created.value.id, "evm");
      await backend.deriveAccount(created.value.id, "ed25519");

      const reloaded = createInternalKeyBackend(vault, PASSPHRASE);
      const listed = await reloaded.listAccounts(created.value.id);
      expect(Result.isOk(listed)).toBe(true);
      if (Result.isError(listed)) throw new Error("reload list failed");
      expect(listed.value).toHaveLength(2);

      const next = await reloaded.deriveAccount(created.value.id, "evm");
      expect(Result.isOk(next)).toBe(true);
      if (Result.isError(next)) throw new Error("reload derive failed");
      expect(next.value.index).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Signing
  // ---------------------------------------------------------------------------

  describe("signing", () => {
    test("signs data with an EVM account and returns valid signature", async () => {
      const created = await backend.createWallet("W1", PASSPHRASE);
      if (Result.isError(created)) throw new Error("create failed");
      const derived = await backend.deriveAccount(created.value.id, "evm");
      if (Result.isError(derived)) throw new Error("derive failed");

      const data = new Uint8Array([1, 2, 3, 4]);
      const result = await backend.sign(
        created.value.id,
        derived.value.index,
        data,
      );
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("sign failed");
      expect(result.value.signature).toBeInstanceOf(Uint8Array);
      expect(result.value.publicKey).toBeInstanceOf(Uint8Array);
      expect(result.value.algorithm).toBe("secp256k1");
    });

    test("signs data with an Ed25519 account and returns valid signature", async () => {
      const created = await backend.createWallet("W1", PASSPHRASE);
      if (Result.isError(created)) throw new Error("create failed");
      const derived = await backend.deriveAccount(created.value.id, "ed25519");
      if (Result.isError(derived)) throw new Error("derive failed");

      const data = new Uint8Array([5, 6, 7, 8]);
      const result = await backend.sign(
        created.value.id,
        derived.value.index,
        data,
      );
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("sign failed");
      expect(result.value.signature).toBeInstanceOf(Uint8Array);
      expect(result.value.publicKey).toBeInstanceOf(Uint8Array);
      expect(result.value.algorithm).toBe("ed25519");
    });

    test("returns error when signing with nonexistent wallet", async () => {
      const result = await backend.sign("nonexistent", 0, new Uint8Array([1]));
      expect(Result.isError(result)).toBe(true);
    });

    test("returns error when signing with out-of-range index", async () => {
      const created = await backend.createWallet("W1", PASSPHRASE);
      if (Result.isError(created)) throw new Error("create failed");
      const result = await backend.sign(
        created.value.id,
        99,
        new Uint8Array([1]),
      );
      expect(Result.isError(result)).toBe(true);
    });

    test("returns the EVM private key for XMTP identity registration", async () => {
      const created = await backend.createWallet("W1", PASSPHRASE);
      if (Result.isError(created)) throw new Error("create failed");
      const derived = await backend.deriveAccount(created.value.id, "evm");
      if (Result.isError(derived)) throw new Error("derive failed");

      const key = await backend.getXmtpIdentityKey(
        created.value.id,
        derived.value.index,
      );
      expect(Result.isOk(key)).toBe(true);
      if (Result.isError(key)) throw new Error("identity key failed");
      expect(key.value).toMatch(/^0x[0-9a-f]{64}$/);
      const privateKeyBytes = Buffer.from(key.value.slice(2), "hex");
      const publicKey = secp256k1.getPublicKey(privateKeyBytes, false);
      expect(bytesToHex(publicKey)).toBe(derived.value.publicKey);
    });
  });

  // ---------------------------------------------------------------------------
  // API key lifecycle
  // ---------------------------------------------------------------------------

  describe("API key lifecycle", () => {
    test("creates an API key and returns token", async () => {
      const created = await backend.createWallet("W1", PASSPHRASE);
      if (Result.isError(created)) throw new Error("create failed");
      const expires = new Date(Date.now() + 86400000).toISOString();
      const result = await backend.createApiKey(
        created.value.id,
        "cred-1",
        PASSPHRASE,
        expires,
      );
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("create key failed");
      expect(result.value.token).toBeDefined();
      expect(result.value.token.length).toBeGreaterThan(0);
      expect(result.value.walletId).toBe(created.value.id);
      expect(result.value.expiresAt).toBe(expires);
    });

    test("signs with an API key token", async () => {
      const created = await backend.createWallet("W1", PASSPHRASE);
      if (Result.isError(created)) throw new Error("create failed");
      await backend.deriveAccount(created.value.id, "evm");
      const expires = new Date(Date.now() + 86400000).toISOString();
      const apiKey = await backend.createApiKey(
        created.value.id,
        "cred-1",
        PASSPHRASE,
        expires,
      );
      if (Result.isError(apiKey)) throw new Error("create key failed");

      const result = await backend.signWithApiKey(
        apiKey.value.token,
        0,
        new Uint8Array([1, 2, 3]),
      );
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("sign failed");
      expect(result.value.signature).toBeInstanceOf(Uint8Array);
      expect(result.value.algorithm).toBe("secp256k1");
    });

    test("revokes an API key", async () => {
      const created = await backend.createWallet("W1", PASSPHRASE);
      if (Result.isError(created)) throw new Error("create failed");
      await backend.deriveAccount(created.value.id, "evm");
      const expires = new Date(Date.now() + 86400000).toISOString();
      const apiKey = await backend.createApiKey(
        created.value.id,
        "cred-1",
        PASSPHRASE,
        expires,
      );
      if (Result.isError(apiKey)) throw new Error("create key failed");

      const revokeResult = await backend.revokeApiKey(apiKey.value.id);
      expect(Result.isOk(revokeResult)).toBe(true);
    });

    test("sign fails after API key is revoked", async () => {
      const created = await backend.createWallet("W1", PASSPHRASE);
      if (Result.isError(created)) throw new Error("create failed");
      await backend.deriveAccount(created.value.id, "evm");
      const expires = new Date(Date.now() + 86400000).toISOString();
      const apiKey = await backend.createApiKey(
        created.value.id,
        "cred-1",
        PASSPHRASE,
        expires,
      );
      if (Result.isError(apiKey)) throw new Error("create key failed");

      await backend.revokeApiKey(apiKey.value.id);

      const result = await backend.signWithApiKey(
        apiKey.value.token,
        0,
        new Uint8Array([1, 2, 3]),
      );
      expect(Result.isError(result)).toBe(true);
    });

    test("returns error for invalid API key token", async () => {
      const result = await backend.signWithApiKey(
        "invalid-token",
        0,
        new Uint8Array([1]),
      );
      expect(Result.isError(result)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // End-to-end: create wallet -> derive -> sign -> verify
  // ---------------------------------------------------------------------------

  describe("end-to-end workflow", () => {
    test("full lifecycle: wallet -> accounts -> sign with both chains", async () => {
      // Create wallet
      const wallet = await backend.createWallet("E2E Wallet", PASSPHRASE);
      if (Result.isError(wallet)) throw new Error("create wallet failed");

      // Derive EVM and Ed25519 accounts
      const evmAccount = await backend.deriveAccount(wallet.value.id, "evm");
      const edAccount = await backend.deriveAccount(wallet.value.id, "ed25519");
      if (Result.isError(evmAccount) || Result.isError(edAccount))
        throw new Error("derive failed");

      // Sign with EVM
      const evmSig = await backend.sign(
        wallet.value.id,
        evmAccount.value.index,
        new Uint8Array([0xde, 0xad]),
      );
      expect(Result.isOk(evmSig)).toBe(true);
      if (Result.isError(evmSig)) throw new Error("evm sign failed");
      expect(evmSig.value.algorithm).toBe("secp256k1");

      // Sign with Ed25519
      const edSig = await backend.sign(
        wallet.value.id,
        edAccount.value.index,
        new Uint8Array([0xbe, 0xef]),
      );
      expect(Result.isOk(edSig)).toBe(true);
      if (Result.isError(edSig)) throw new Error("ed sign failed");
      expect(edSig.value.algorithm).toBe("ed25519");

      // Verify wallet now shows 2 accounts
      const walletInfo = await backend.getWallet(wallet.value.id);
      if (Result.isError(walletInfo)) throw new Error("get wallet failed");
      expect(walletInfo.value.accountCount).toBe(2);
    });
  });
});
