import type { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import type { WalletProviderType } from "@xmtp/signet-schemas";

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/** Identifies the wallet provider backing this key backend. */
export type WalletProvider = WalletProviderType;

/** Summary information about a managed wallet. */
export interface WalletInfo {
  /** Wallet identifier. */
  readonly id: string;
  /** Human-readable name. */
  readonly label: string;
  /** Which provider manages this wallet. */
  readonly provider: WalletProvider;
  /** Number of derived accounts. */
  readonly accountCount: number;
  /** ISO 8601 creation timestamp. */
  readonly createdAt: string;
}

/** A derived account within a wallet. */
export interface AccountInfo {
  /** BIP-44 derivation index. */
  readonly index: number;
  /** Derived address (0x-prefixed for EVM, base58 for Ed25519). */
  readonly address: string;
  /** Signing curve used by this account. */
  readonly chain: "evm" | "ed25519";
  /** Hex-encoded public key. */
  readonly publicKey: string;
}

/** Result of a signing operation. */
export interface SigningResult {
  /** Raw signature bytes. */
  readonly signature: Uint8Array;
  /** Public key of the signer. */
  readonly publicKey: Uint8Array;
  /** Algorithm used to produce the signature. */
  readonly algorithm: "secp256k1" | "ed25519";
}

/** Metadata for an API key that grants signing access to a wallet. */
export interface ApiKeyInfo {
  /** Key identifier (maps to credential ID). */
  readonly id: string;
  /** Wallet this key grants access to. */
  readonly walletId: string;
  /** Bearer token (shown once at creation, then redacted). */
  readonly token: string;
  /** ISO 8601 expiration timestamp. */
  readonly expiresAt: string;
}

// ---------------------------------------------------------------------------
// Backend interface
// ---------------------------------------------------------------------------

/**
 * Provider-agnostic interface for wallet and key operations.
 *
 * Implementations back either the `internal` (signet-managed BIP-39 vault)
 * or `ows` (external OWS vault) provider. Consumers program against this
 * interface and never touch raw key material directly.
 */
export interface KeyBackend {
  /** The provider type backing this instance. */
  readonly provider: WalletProvider;

  // -- Wallet operations ---------------------------------------------------

  /** Create a new wallet with a fresh BIP-39 mnemonic. */
  createWallet(
    label: string,
    passphrase: string,
  ): Promise<Result<WalletInfo, SignetError>>;

  /** Delete a wallet and all derived key material. */
  deleteWallet(walletId: string): Promise<Result<void, SignetError>>;

  /** List all wallets managed by this backend. */
  listWallets(): Promise<Result<readonly WalletInfo[], SignetError>>;

  /** Get wallet info by ID. */
  getWallet(walletId: string): Promise<Result<WalletInfo, SignetError>>;

  // -- Account derivation --------------------------------------------------

  /** Derive a new account at the next available BIP-44 index. */
  deriveAccount(
    walletId: string,
    chain: "evm" | "ed25519",
  ): Promise<Result<AccountInfo, SignetError>>;

  /** List derived accounts for a wallet. */
  listAccounts(
    walletId: string,
  ): Promise<Result<readonly AccountInfo[], SignetError>>;

  // -- Signing -------------------------------------------------------------

  /** Sign arbitrary data with a specific account's private key. */
  sign(
    walletId: string,
    accountIndex: number,
    data: Uint8Array,
  ): Promise<Result<SigningResult, SignetError>>;

  /**
   * Return the EVM private key for an existing derived account.
   *
   * Used only for XMTP identity registration paths that require a
   * secp256k1 private key.
   */
  getXmtpIdentityKey(
    walletId: string,
    accountIndex: number,
  ): Promise<Result<`0x${string}`, SignetError>>;

  // -- API key (credential token) management -------------------------------

  /** Create an API key that grants signing access to a wallet via HKDF token. */
  createApiKey(
    walletId: string,
    credentialId: string,
    passphrase: string,
    expiresAt: string,
  ): Promise<Result<ApiKeyInfo, SignetError>>;

  /** Revoke an API key, destroying its encrypted mnemonic copy. */
  revokeApiKey(keyId: string): Promise<Result<void, SignetError>>;

  /** Sign data using an API key token (without exposing the passphrase). */
  signWithApiKey(
    token: string,
    accountIndex: number,
    data: Uint8Array,
  ): Promise<Result<SigningResult, SignetError>>;
}
