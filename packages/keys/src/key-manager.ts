import { Result } from "better-result";
import { NotFoundError, type SignetError } from "@xmtp/signet-schemas";
import type { KeyBackend, AccountInfo, SigningResult } from "./key-backend.js";
import type { Vault, AccountEntry } from "./vault.js";
import {
  generateMnemonic,
  mnemonicToSeed,
  deriveEvmKey,
  deriveEd25519Key,
} from "./derivation.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha256";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert bytes to lowercase hex string. */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Generate a random hex token for API keys. */
function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToHex(bytes);
}

/**
 * Sign data using a derived key at the given index and chain.
 * Dispatches to secp256k1 (EVM) or Ed25519 based on chain type.
 */
function signWithSeed(
  seed: Uint8Array,
  accountIndex: number,
  chain: "evm" | "ed25519",
  data: Uint8Array,
): SigningResult {
  if (chain === "evm") {
    const derived = deriveEvmKey(seed, accountIndex);
    const hash = sha256(data);
    const sig = secp256k1.sign(hash, derived.privateKey);
    const publicKey = secp256k1.getPublicKey(derived.privateKey, false);
    return {
      signature: new Uint8Array(sig),
      publicKey: new Uint8Array(publicKey),
      algorithm: "secp256k1",
    };
  }
  const derived = deriveEd25519Key(seed, accountIndex);
  const signature = ed25519.sign(data, derived.privateKey);
  const publicKey = ed25519.getPublicKey(derived.privateKey);
  return {
    signature: new Uint8Array(signature),
    publicKey: new Uint8Array(publicKey),
    algorithm: "ed25519",
  };
}

// ---------------------------------------------------------------------------
// Per-wallet state
// ---------------------------------------------------------------------------

/**
 * Per-wallet metadata tracked in memory alongside the vault.
 * Mirrors the vault's account list and tracks the next derivation index.
 */
interface WalletState {
  readonly id: string;
  readonly label: string;
  readonly createdAt: string;
  /** Next derivation index (across all chains). */
  nextIndex: number;
  /** Derived accounts in order. */
  accounts: readonly AccountEntry[];
}

type LoadedWalletState = {
  readonly state: WalletState;
  readonly seed: Uint8Array;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a `KeyBackend` backed by the internal signet vault.
 *
 * The backend generates BIP-39 mnemonics, encrypts them in the vault
 * with the owner passphrase, and derives BIP-44 accounts for
 * secp256k1 (EVM) and SLIP-0010 Ed25519 signing.
 *
 * @param vault - Encrypted vault for mnemonic storage
 * @param passphrase - Owner passphrase for vault encryption
 */
export function createInternalKeyBackend(
  vault: Vault,
  passphrase: string,
): KeyBackend {
  const walletStates = new Map<string, WalletState>();

  /** Decrypt the mnemonic for a wallet and derive the BIP-39 seed. */
  async function getSeed(
    walletId: string,
  ): Promise<Result<{ mnemonic: string; seed: Uint8Array }, SignetError>> {
    const result = await vault.readWallet(walletId, passphrase);
    if (Result.isError(result)) return result;
    return Result.ok({
      mnemonic: result.value,
      seed: mnemonicToSeed(result.value),
    });
  }

  async function ensureWalletState(
    walletId: string,
  ): Promise<Result<LoadedWalletState, SignetError>> {
    const existing = walletStates.get(walletId);
    const seedResult = await getSeed(walletId);
    if (Result.isError(seedResult)) return seedResult;

    if (existing !== undefined) {
      return Result.ok({ state: existing, seed: seedResult.value.seed });
    }

    const walletResult = await vault.listWallets();
    if (Result.isError(walletResult)) return walletResult;

    const wallet = walletResult.value.find((entry) => entry.id === walletId);
    if (wallet === undefined) {
      return Result.err(NotFoundError.create("Wallet", walletId));
    }

    const accountsResult = await vault.getWalletAccounts(walletId);
    if (Result.isError(accountsResult)) return accountsResult;

    const nextIndex =
      accountsResult.value.reduce(
        (maxIndex, entry) => Math.max(maxIndex, entry.index),
        -1,
      ) + 1;

    const state: WalletState = {
      id: wallet.id,
      label: wallet.label,
      createdAt: wallet.createdAt,
      nextIndex,
      accounts: [...accountsResult.value],
    };
    walletStates.set(walletId, state);
    return Result.ok({ state, seed: seedResult.value.seed });
  }

  /** Look up the chain for an account at a given index. */
  function chainAt(
    walletId: string,
    index: number,
  ): "evm" | "ed25519" | undefined {
    return walletStates.get(walletId)?.accounts.find((a) => a.index === index)
      ?.chain;
  }

  /** Resolve chain + seed, then sign. Shared by sign() and signWithApiKey(). */
  async function resolveAndSign(
    walletId: string,
    seed: Uint8Array,
    accountIndex: number,
    data: Uint8Array,
  ): Promise<Result<SigningResult, SignetError>> {
    const chain = chainAt(walletId, accountIndex);
    if (chain === undefined) {
      return Result.err(
        NotFoundError.create("Account", `${walletId}/${String(accountIndex)}`),
      );
    }
    return Result.ok(signWithSeed(seed, accountIndex, chain, data));
  }

  return {
    provider: "internal",

    // -- Wallet operations -------------------------------------------------

    async createWallet(label, _passphrase) {
      const id = crypto.randomUUID();
      const mnemonic = generateMnemonic();
      const r = await vault.createWallet(id, label, mnemonic, passphrase);
      if (Result.isError(r)) return r;

      const now = new Date().toISOString();
      walletStates.set(id, {
        id,
        label,
        createdAt: now,
        nextIndex: 0,
        accounts: [],
      });
      return Result.ok({
        id,
        label,
        provider: "internal",
        accountCount: 0,
        createdAt: now,
      });
    },

    async deleteWallet(walletId) {
      const r = await vault.deleteWallet(walletId);
      if (Result.isOk(r)) walletStates.delete(walletId);
      return r;
    },

    async listWallets() {
      const r = await vault.listWallets();
      if (Result.isError(r)) return r;
      return Result.ok(
        r.value.map((w) => ({
          id: w.id,
          label: w.label,
          provider: "internal" as const,
          accountCount: w.accountCount,
          createdAt: w.createdAt,
        })),
      );
    },

    async getWallet(walletId) {
      const r = await vault.listWallets();
      if (Result.isError(r)) return r;
      const found = r.value.find((w) => w.id === walletId);
      if (!found) return Result.err(NotFoundError.create("Wallet", walletId));
      return Result.ok({
        id: found.id,
        label: found.label,
        provider: "internal" as const,
        accountCount: found.accountCount,
        createdAt: found.createdAt,
      });
    },

    // -- Account derivation ------------------------------------------------

    async deriveAccount(walletId, chain) {
      const walletState = await ensureWalletState(walletId);
      if (Result.isError(walletState)) return walletState;

      const { state, seed } = walletState.value;

      const index = state.nextIndex;
      let address: string;
      let publicKeyHex: string;

      if (chain === "evm") {
        const d = deriveEvmKey(seed, index);
        address = d.address;
        publicKeyHex = bytesToHex(d.publicKey);
      } else {
        const d = deriveEd25519Key(seed, index);
        publicKeyHex = bytesToHex(d.publicKey);
        address = publicKeyHex;
      }

      const entry: AccountEntry = { index, chain, address };
      const newAccounts = [...state.accounts, entry];
      const ur = await vault.updateWalletAccounts(walletId, newAccounts);
      if (Result.isError(ur)) return ur;

      state.nextIndex = index + 1;
      (state as { accounts: readonly AccountEntry[] }).accounts = newAccounts;
      return Result.ok({ index, address, chain, publicKey: publicKeyHex });
    },

    async listAccounts(walletId) {
      const walletState = await ensureWalletState(walletId);
      if (Result.isError(walletState)) return walletState;

      const { state, seed } = walletState.value;

      const infos: AccountInfo[] = state.accounts.map((e) => {
        const publicKeyHex =
          e.chain === "evm"
            ? bytesToHex(deriveEvmKey(seed, e.index).publicKey)
            : bytesToHex(deriveEd25519Key(seed, e.index).publicKey);
        return {
          index: e.index,
          address: e.address,
          chain: e.chain,
          publicKey: publicKeyHex,
        };
      });
      return Result.ok(infos);
    },

    async getXmtpIdentityKey(walletId, accountIndex) {
      const walletState = await ensureWalletState(walletId);
      if (Result.isError(walletState)) return walletState;

      const { state, seed } = walletState.value;
      const account = state.accounts.find(
        (entry) => entry.index === accountIndex && entry.chain === "evm",
      );
      if (account === undefined) {
        return Result.err(
          NotFoundError.create(
            "EvmAccount",
            `${walletId}/${String(accountIndex)}`,
          ),
        );
      }

      const derived = deriveEvmKey(seed, accountIndex);
      return Result.ok(`0x${bytesToHex(derived.privateKey)}` as `0x${string}`);
    },

    // -- Signing -----------------------------------------------------------

    async sign(walletId, accountIndex, data) {
      const seedResult = await getSeed(walletId);
      if (Result.isError(seedResult)) return seedResult;
      return resolveAndSign(
        walletId,
        seedResult.value.seed,
        accountIndex,
        data,
      );
    },

    // -- API key management ------------------------------------------------

    async createApiKey(walletId, credentialId, _passphrase, expiresAt) {
      const r = await vault.readWallet(walletId, passphrase);
      if (Result.isError(r)) return r;

      const token = generateToken();
      const cr = await vault.createApiKey(
        credentialId,
        walletId,
        r.value,
        token,
        expiresAt,
      );
      if (Result.isError(cr)) return cr;
      return Result.ok({ id: credentialId, walletId, token, expiresAt });
    },

    async revokeApiKey(keyId) {
      return vault.revokeApiKey(keyId);
    },

    async signWithApiKey(token, accountIndex, data) {
      const r = await vault.readApiKey(token);
      if (Result.isError(r)) return r;
      const seed = mnemonicToSeed(r.value.mnemonic);
      return resolveAndSign(r.value.walletId, seed, accountIndex, data);
    },
  };
}
