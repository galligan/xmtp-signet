import { Result } from "better-result";
import { InternalError, NotFoundError, AuthError } from "@xmtp/signet-schemas";
import type { SignetError } from "@xmtp/signet-schemas";
import { join } from "node:path";
import {
  mkdirSync,
  existsSync,
  unlinkSync,
  readdirSync,
  chmodSync,
} from "node:fs";
import { scrypt } from "@noble/hashes/scrypt";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { gcm } from "@noble/ciphers/aes.js";
import { bytesToHex, hexToBytes } from "@noble/ciphers/utils.js";
import type { KeyPolicy } from "./config.js";
import {
  resolveVaultSecretProvider,
  type VaultSecretProvider,
} from "./vault-secret-provider.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Metadata for a wallet file, returned by listWallets. */
export interface WalletFileInfo {
  readonly id: string;
  readonly label: string;
  readonly accountCount: number;
  readonly createdAt: string;
}

/** A derived account address entry stored in a wallet file. */
export interface AccountEntry {
  readonly index: number;
  readonly chain: "evm" | "ed25519";
  readonly address: string;
}

/**
 * Encrypted vault for wallet mnemonics and API key credentials.
 *
 * Wallet files use scrypt KDF + AES-256-GCM (passphrase-based).
 * API key files use HKDF-SHA256 + AES-256-GCM (token-based).
 */
export interface Vault {
  /** Encrypt and store an opaque internal secret. */
  set(name: string, value: Uint8Array): Promise<Result<void, InternalError>>;

  /** Decrypt and return an opaque internal secret. */
  get(name: string): Promise<Result<Uint8Array, NotFoundError | InternalError>>;

  /** Remove a stored internal secret. */
  delete(name: string): Promise<Result<void, NotFoundError>>;

  /** List all stored internal secret names. */
  list(): readonly string[];

  /** Encrypt and store a wallet mnemonic. */
  createWallet(
    id: string,
    label: string,
    mnemonic: string,
    passphrase: string,
  ): Promise<Result<void, SignetError>>;

  /** Decrypt and return a wallet mnemonic. */
  readWallet(
    id: string,
    passphrase: string,
  ): Promise<Result<string, NotFoundError | AuthError | InternalError>>;

  /** Remove a wallet file. */
  deleteWallet(id: string): Promise<Result<void, NotFoundError>>;

  /** List all stored wallets with metadata (no decryption). */
  listWallets(): Promise<Result<readonly WalletFileInfo[], InternalError>>;

  /** Return the stored account entries for a wallet. */
  getWalletAccounts(
    id: string,
  ): Promise<Result<readonly AccountEntry[], NotFoundError | InternalError>>;

  /** Update the accounts array on an existing wallet file. */
  updateWalletAccounts(
    id: string,
    accounts: readonly AccountEntry[],
  ): Promise<Result<void, NotFoundError | InternalError>>;

  /** Encrypt and store an API key credential. */
  createApiKey(
    id: string,
    walletId: string,
    mnemonic: string,
    token: string,
    expiresAt: string,
  ): Promise<Result<void, SignetError>>;

  /** Decrypt and return an API key credential by token. */
  readApiKey(
    token: string,
  ): Promise<
    Result<
      { mnemonic: string; walletId: string },
      NotFoundError | InternalError
    >
  >;

  /** Revoke (delete) an API key by id. */
  revokeApiKey(id: string): Promise<Result<void, NotFoundError>>;

  /** Release any held resources. */
  close(): void;
}

/** Optional overrides when constructing a file-backed vault. */
export interface CreateVaultOptions {
  /** Inject a pre-resolved secret provider, primarily for deterministic tests. */
  readonly secretProvider?: VaultSecretProvider | undefined;
  /** Access policy to use if the vault secret provider is resolved automatically. */
  readonly vaultKeyPolicy?: KeyPolicy | undefined;
}

// ---------------------------------------------------------------------------
// Scrypt parameters
// ---------------------------------------------------------------------------

/** Default scrypt KDF parameters for wallet encryption. */
interface ScryptParams {
  readonly n: number;
  readonly r: number;
  readonly p: number;
  readonly dklen: number;
  readonly salt: string;
}

const DEFAULT_SCRYPT_N = 131072;
const DEFAULT_SCRYPT_R = 8;
const DEFAULT_SCRYPT_P = 1;
const DEFAULT_SCRYPT_DKLEN = 32;

// Use lower parameters for in-memory (test) mode for speed
const TEST_SCRYPT_N = 1024;

// ---------------------------------------------------------------------------
// Internal file types
// ---------------------------------------------------------------------------

interface WalletFileCrypto {
  cipher: "aes-256-gcm";
  ciphertext: string;
  cipherparams: { iv: string };
  kdf: "scrypt";
  kdfparams: ScryptParams;
  mac: string;
}

interface WalletFile {
  version: 3;
  id: string;
  label: string;
  crypto: WalletFileCrypto;
  accounts: AccountEntry[];
  createdAt: string;
}

interface ApiKeyCrypto {
  cipher: "aes-256-gcm";
  ciphertext: string;
  cipherparams: { iv: string };
  kdf: "hkdf-sha256";
  kdfparams: { salt: string; info: string };
}

interface ApiKeyFile {
  id: string;
  walletId: string;
  crypto: ApiKeyCrypto;
  expiresAt: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

const IV_BYTES = 12;
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

function asArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
}

async function importSecretKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    asArrayBuffer(raw),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptSecret(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    asArrayBuffer(plaintext),
  );
  const result = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), IV_BYTES);
  return result;
}

async function decryptSecret(
  key: CryptoKey,
  data: Uint8Array,
): Promise<Uint8Array> {
  const iv = data.slice(0, IV_BYTES);
  const ciphertext = data.slice(IV_BYTES);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );
  return new Uint8Array(plaintext);
}

function encodeSecretName(name: string): string {
  return encodeURIComponent(name);
}

function decodeSecretName(filename: string): string | null {
  if (!filename.endsWith(".bin")) return null;
  try {
    return decodeURIComponent(filename.slice(0, -4));
  } catch {
    return null;
  }
}

/** Type guard for API key payload shape. */
function isApiKeyPayload(
  value: unknown,
): value is { mnemonic: string; walletId: string } {
  if (typeof value !== "object" || value === null) return false;
  return (
    "mnemonic" in value &&
    typeof value.mnemonic === "string" &&
    "walletId" in value &&
    typeof value.walletId === "string"
  );
}

/** Type guard for WalletFile shape. */
function isWalletFile(value: unknown): value is WalletFile {
  if (typeof value !== "object" || value === null) return false;
  return (
    "version" in value &&
    value.version === 3 &&
    "id" in value &&
    typeof value.id === "string" &&
    "label" in value &&
    typeof value.label === "string" &&
    "crypto" in value &&
    typeof value.crypto === "object" &&
    "accounts" in value &&
    Array.isArray(value.accounts) &&
    "createdAt" in value &&
    typeof value.createdAt === "string"
  );
}

/** Type guard for ApiKeyFile shape. */
function isApiKeyFile(value: unknown): value is ApiKeyFile {
  if (typeof value !== "object" || value === null) return false;
  return (
    "id" in value &&
    typeof value.id === "string" &&
    "walletId" in value &&
    typeof value.walletId === "string" &&
    "crypto" in value &&
    typeof value.crypto === "object" &&
    "createdAt" in value &&
    typeof value.createdAt === "string"
  );
}

/** Parse and validate a decrypted API key payload. */
function parseApiKeyPayload(
  decrypted: string,
): Result<{ mnemonic: string; walletId: string }, InternalError> {
  try {
    const parsed: unknown = JSON.parse(decrypted);
    if (!isApiKeyPayload(parsed)) {
      return Result.err(InternalError.create("Corrupt API key payload"));
    }
    return Result.ok({ mnemonic: parsed.mnemonic, walletId: parsed.walletId });
  } catch {
    return Result.err(InternalError.create("Failed to parse API key data"));
  }
}

/**
 * Encrypt plaintext with scrypt-derived key + AES-256-GCM.
 * Returns the crypto block for a wallet file.
 */
function encryptWithScrypt(
  plaintext: string,
  passphrase: string,
  isTest: boolean,
): WalletFileCrypto {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const n = isTest ? TEST_SCRYPT_N : DEFAULT_SCRYPT_N;
  const dk = scrypt(ENCODER.encode(passphrase), salt, {
    N: n,
    r: DEFAULT_SCRYPT_R,
    p: DEFAULT_SCRYPT_P,
    dkLen: DEFAULT_SCRYPT_DKLEN,
  });

  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = gcm(dk, iv);
  const ptBytes = ENCODER.encode(plaintext);
  const encrypted = cipher.encrypt(ptBytes);

  // GCM appends a 16-byte tag; compute MAC from dk + ciphertext
  const mac = sha256(new Uint8Array([...dk, ...encrypted]));

  return {
    cipher: "aes-256-gcm",
    ciphertext: bytesToHex(encrypted),
    cipherparams: { iv: bytesToHex(iv) },
    kdf: "scrypt",
    kdfparams: {
      n,
      r: DEFAULT_SCRYPT_R,
      p: DEFAULT_SCRYPT_P,
      dklen: DEFAULT_SCRYPT_DKLEN,
      salt: bytesToHex(salt),
    },
    mac: bytesToHex(mac),
  };
}

/**
 * Decrypt ciphertext using scrypt-derived key + AES-256-GCM.
 * Returns the plaintext mnemonic on success, or an error.
 */
function decryptWithScrypt(
  cryptoBlock: WalletFileCrypto,
  passphrase: string,
): Result<string, AuthError | InternalError> {
  try {
    const salt = hexToBytes(cryptoBlock.kdfparams.salt);
    const dk = scrypt(ENCODER.encode(passphrase), salt, {
      N: cryptoBlock.kdfparams.n,
      r: cryptoBlock.kdfparams.r,
      p: cryptoBlock.kdfparams.p,
      dkLen: cryptoBlock.kdfparams.dklen,
    });

    // Verify MAC before attempting decryption
    const ciphertextBytes = hexToBytes(cryptoBlock.ciphertext);
    const expectedMac = sha256(new Uint8Array([...dk, ...ciphertextBytes]));
    const storedMac = hexToBytes(cryptoBlock.mac);
    if (bytesToHex(expectedMac) !== bytesToHex(storedMac)) {
      return Result.err(
        AuthError.create("Wrong passphrase or corrupted wallet"),
      );
    }

    const iv = hexToBytes(cryptoBlock.cipherparams.iv);
    const cipher = gcm(dk, iv);
    const decrypted = cipher.decrypt(ciphertextBytes);
    return Result.ok(DECODER.decode(decrypted));
  } catch {
    return Result.err(
      AuthError.create("Decryption failed — wrong passphrase or corrupt data"),
    );
  }
}

/**
 * Encrypt plaintext with HKDF-SHA256-derived key + AES-256-GCM.
 * Returns the crypto block for an API key file.
 */
function encryptWithHkdf(plaintext: string, token: string): ApiKeyCrypto {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const info = "signet-api-key";
  const dk = hkdf(sha256, ENCODER.encode(token), salt, info, 32);

  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = gcm(dk, iv);
  const encrypted = cipher.encrypt(ENCODER.encode(plaintext));

  return {
    cipher: "aes-256-gcm",
    ciphertext: bytesToHex(encrypted),
    cipherparams: { iv: bytesToHex(iv) },
    kdf: "hkdf-sha256",
    kdfparams: { salt: bytesToHex(salt), info },
  };
}

/**
 * Decrypt ciphertext using HKDF-SHA256-derived key + AES-256-GCM.
 */
function decryptWithHkdf(
  cryptoBlock: ApiKeyCrypto,
  token: string,
): Result<string, InternalError> {
  try {
    const salt = hexToBytes(cryptoBlock.kdfparams.salt);
    const dk = hkdf(
      sha256,
      ENCODER.encode(token),
      salt,
      cryptoBlock.kdfparams.info,
      32,
    );
    const iv = hexToBytes(cryptoBlock.cipherparams.iv);
    const cipher = gcm(dk, iv);
    const decrypted = cipher.decrypt(hexToBytes(cryptoBlock.ciphertext));
    return Result.ok(DECODER.decode(decrypted));
  } catch {
    return Result.err(
      InternalError.create("API key decryption failed — invalid token"),
    );
  }
}

// ---------------------------------------------------------------------------
// In-memory vault (for tests)
// ---------------------------------------------------------------------------

function createMemoryVault(): Vault {
  const secrets = new Map<string, Uint8Array>();
  const wallets = new Map<string, WalletFile>();
  const apiKeys = new Map<string, ApiKeyFile>();
  // token -> key id index for readApiKey lookups
  const tokenIndex = new Map<string, string>();

  return {
    async set(
      name: string,
      value: Uint8Array,
    ): Promise<Result<void, InternalError>> {
      secrets.set(name, value.slice());
      return Result.ok();
    },

    async get(
      name: string,
    ): Promise<Result<Uint8Array, NotFoundError | InternalError>> {
      const value = secrets.get(name);
      if (value === undefined) {
        return Result.err(NotFoundError.create("VaultSecret", name));
      }
      return Result.ok(value.slice());
    },

    async delete(name: string): Promise<Result<void, NotFoundError>> {
      if (!secrets.has(name)) {
        return Result.err(NotFoundError.create("VaultSecret", name));
      }
      secrets.delete(name);
      return Result.ok();
    },

    list(): readonly string[] {
      return [...secrets.keys()].sort();
    },

    async createWallet(
      id: string,
      label: string,
      mnemonic: string,
      passphrase: string,
    ): Promise<Result<void, SignetError>> {
      const cryptoBlock = encryptWithScrypt(mnemonic, passphrase, true);
      const file: WalletFile = {
        version: 3,
        id,
        label,
        crypto: cryptoBlock,
        accounts: [],
        createdAt: new Date().toISOString(),
      };
      wallets.set(id, file);
      return Result.ok();
    },

    async readWallet(
      id: string,
      passphrase: string,
    ): Promise<Result<string, NotFoundError | AuthError | InternalError>> {
      const file = wallets.get(id);
      if (!file) {
        return Result.err(NotFoundError.create("Wallet", id));
      }
      return decryptWithScrypt(file.crypto, passphrase);
    },

    async deleteWallet(id: string): Promise<Result<void, NotFoundError>> {
      if (!wallets.has(id)) {
        return Result.err(NotFoundError.create("Wallet", id));
      }
      wallets.delete(id);
      return Result.ok();
    },

    async listWallets(): Promise<
      Result<readonly WalletFileInfo[], InternalError>
    > {
      const infos: WalletFileInfo[] = [];
      for (const file of wallets.values()) {
        infos.push({
          id: file.id,
          label: file.label,
          accountCount: file.accounts.length,
          createdAt: file.createdAt,
        });
      }
      return Result.ok(infos);
    },

    async getWalletAccounts(
      id: string,
    ): Promise<Result<readonly AccountEntry[], NotFoundError | InternalError>> {
      const file = wallets.get(id);
      if (!file) {
        return Result.err(NotFoundError.create("Wallet", id));
      }
      return Result.ok([...file.accounts]);
    },

    async updateWalletAccounts(
      id: string,
      accounts: readonly AccountEntry[],
    ): Promise<Result<void, NotFoundError | InternalError>> {
      const file = wallets.get(id);
      if (!file) {
        return Result.err(NotFoundError.create("Wallet", id));
      }
      file.accounts = [...accounts];
      return Result.ok();
    },

    async createApiKey(
      id: string,
      walletId: string,
      mnemonic: string,
      token: string,
      expiresAt: string,
    ): Promise<Result<void, SignetError>> {
      const payload = JSON.stringify({ mnemonic, walletId });
      const cryptoBlock = encryptWithHkdf(payload, token);
      const file: ApiKeyFile = {
        id,
        walletId,
        crypto: cryptoBlock,
        expiresAt,
        createdAt: new Date().toISOString(),
      };
      apiKeys.set(id, file);
      tokenIndex.set(token, id);
      return Result.ok();
    },

    async readApiKey(
      token: string,
    ): Promise<
      Result<
        { mnemonic: string; walletId: string },
        NotFoundError | InternalError
      >
    > {
      const keyId = tokenIndex.get(token);
      if (!keyId) {
        return Result.err(NotFoundError.create("ApiKey", "by-token"));
      }
      const file = apiKeys.get(keyId);
      if (!file) {
        return Result.err(NotFoundError.create("ApiKey", keyId));
      }
      const decrypted = decryptWithHkdf(file.crypto, token);
      if (Result.isError(decrypted)) return decrypted;
      return parseApiKeyPayload(decrypted.value);
    },

    async revokeApiKey(id: string): Promise<Result<void, NotFoundError>> {
      if (!apiKeys.has(id)) {
        return Result.err(NotFoundError.create("ApiKey", id));
      }
      // Remove from token index
      for (const [tok, keyId] of tokenIndex) {
        if (keyId === id) {
          tokenIndex.delete(tok);
          break;
        }
      }
      apiKeys.delete(id);
      return Result.ok();
    },

    close(): void {
      secrets.clear();
      wallets.clear();
      apiKeys.clear();
      tokenIndex.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// File-based vault
// ---------------------------------------------------------------------------

function createFileVault(dataDir: string, secretKey: CryptoKey): Vault {
  const secretsDir = join(dataDir, "secrets");
  const walletsDir = join(dataDir, "wallets");
  const keysDir = join(dataDir, "keys");

  // Ensure directory structure
  if (!existsSync(secretsDir)) {
    mkdirSync(secretsDir, { recursive: true });
    chmodSync(secretsDir, 0o700);
  }
  if (!existsSync(walletsDir)) {
    mkdirSync(walletsDir, { recursive: true });
    chmodSync(walletsDir, 0o700);
  }
  if (!existsSync(keysDir)) {
    mkdirSync(keysDir, { recursive: true });
    chmodSync(keysDir, 0o700);
  }

  /** Write a JSON file with 600 permissions. */
  async function writeSecureFile(
    filePath: string,
    data: unknown,
  ): Promise<void> {
    await Bun.write(filePath, JSON.stringify(data, null, 2));
    chmodSync(filePath, 0o600);
  }

  /** Read and parse a JSON file, returning null if not found. */
  async function readJsonFile(filePath: string): Promise<unknown | null> {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return null;
    const text = await file.text();
    return JSON.parse(text) as unknown;
  }

  function secretPath(name: string): string {
    return join(secretsDir, `${encodeSecretName(name)}.bin`);
  }

  return {
    async set(
      name: string,
      value: Uint8Array,
    ): Promise<Result<void, InternalError>> {
      try {
        const encrypted = await encryptSecret(secretKey, value);
        await Bun.write(secretPath(name), encrypted);
        chmodSync(secretPath(name), 0o600);
        return Result.ok();
      } catch (e) {
        return Result.err(
          InternalError.create("Failed to store vault secret", {
            name,
            cause: String(e),
          }),
        );
      }
    },

    async get(
      name: string,
    ): Promise<Result<Uint8Array, NotFoundError | InternalError>> {
      const filePath = secretPath(name);
      if (!existsSync(filePath)) {
        return Result.err(NotFoundError.create("VaultSecret", name));
      }
      try {
        const encrypted = new Uint8Array(
          await Bun.file(filePath).arrayBuffer(),
        );
        const plaintext = await decryptSecret(secretKey, encrypted);
        return Result.ok(plaintext);
      } catch (e) {
        return Result.err(
          InternalError.create("Failed to read vault secret", {
            name,
            cause: String(e),
          }),
        );
      }
    },

    async delete(name: string): Promise<Result<void, NotFoundError>> {
      const filePath = secretPath(name);
      if (!existsSync(filePath)) {
        return Result.err(NotFoundError.create("VaultSecret", name));
      }
      unlinkSync(filePath);
      return Result.ok();
    },

    list(): readonly string[] {
      return readdirSync(secretsDir)
        .map(decodeSecretName)
        .filter((name): name is string => name !== null)
        .sort();
    },

    async createWallet(
      id: string,
      label: string,
      mnemonic: string,
      passphrase: string,
    ): Promise<Result<void, SignetError>> {
      try {
        const cryptoBlock = encryptWithScrypt(mnemonic, passphrase, false);
        const file: WalletFile = {
          version: 3,
          id,
          label,
          crypto: cryptoBlock,
          accounts: [],
          createdAt: new Date().toISOString(),
        };
        await writeSecureFile(join(walletsDir, `${id}.json`), file);
        return Result.ok();
      } catch (e) {
        return Result.err(
          InternalError.create("Failed to create wallet file", {
            id,
            cause: String(e),
          }),
        );
      }
    },

    async readWallet(
      id: string,
      passphrase: string,
    ): Promise<Result<string, NotFoundError | AuthError | InternalError>> {
      try {
        const raw = await readJsonFile(join(walletsDir, `${id}.json`));
        if (!raw || !isWalletFile(raw)) {
          return Result.err(NotFoundError.create("Wallet", id));
        }
        return decryptWithScrypt(raw.crypto, passphrase);
      } catch (e) {
        return Result.err(
          InternalError.create("Failed to read wallet", {
            id,
            cause: String(e),
          }),
        );
      }
    },

    async deleteWallet(id: string): Promise<Result<void, NotFoundError>> {
      const filePath = join(walletsDir, `${id}.json`);
      if (!existsSync(filePath)) {
        return Result.err(NotFoundError.create("Wallet", id));
      }
      unlinkSync(filePath);
      return Result.ok();
    },

    async listWallets(): Promise<
      Result<readonly WalletFileInfo[], InternalError>
    > {
      try {
        const files = readdirSync(walletsDir).filter((f) =>
          f.endsWith(".json"),
        );
        const infos: WalletFileInfo[] = [];
        for (const filename of files) {
          const raw = await readJsonFile(join(walletsDir, filename));
          if (isWalletFile(raw)) {
            infos.push({
              id: raw.id,
              label: raw.label,
              accountCount: raw.accounts.length,
              createdAt: raw.createdAt,
            });
          }
        }
        return Result.ok(infos);
      } catch (e) {
        return Result.err(
          InternalError.create("Failed to list wallets", {
            cause: String(e),
          }),
        );
      }
    },

    async getWalletAccounts(
      id: string,
    ): Promise<Result<readonly AccountEntry[], NotFoundError | InternalError>> {
      try {
        const raw = await readJsonFile(join(walletsDir, `${id}.json`));
        if (!raw || !isWalletFile(raw)) {
          return Result.err(NotFoundError.create("Wallet", id));
        }
        return Result.ok([...raw.accounts]);
      } catch (e) {
        return Result.err(
          InternalError.create("Failed to read wallet accounts", {
            id,
            cause: String(e),
          }),
        );
      }
    },

    async updateWalletAccounts(
      id: string,
      accounts: readonly AccountEntry[],
    ): Promise<Result<void, NotFoundError | InternalError>> {
      try {
        const filePath = join(walletsDir, `${id}.json`);
        const raw = await readJsonFile(filePath);
        if (!raw || !isWalletFile(raw)) {
          return Result.err(NotFoundError.create("Wallet", id));
        }
        const file = { ...raw, accounts: [...accounts] };
        await writeSecureFile(filePath, file);
        return Result.ok();
      } catch (e) {
        return Result.err(
          InternalError.create("Failed to update wallet accounts", {
            id,
            cause: String(e),
          }),
        );
      }
    },

    async createApiKey(
      id: string,
      walletId: string,
      mnemonic: string,
      token: string,
      expiresAt: string,
    ): Promise<Result<void, SignetError>> {
      try {
        const payload = JSON.stringify({ mnemonic, walletId });
        const cryptoBlock = encryptWithHkdf(payload, token);
        const file: ApiKeyFile = {
          id,
          walletId,
          crypto: cryptoBlock,
          expiresAt,
          createdAt: new Date().toISOString(),
        };
        await writeSecureFile(join(keysDir, `${id}.json`), file);
        return Result.ok();
      } catch (e) {
        return Result.err(
          InternalError.create("Failed to create API key file", {
            id,
            cause: String(e),
          }),
        );
      }
    },

    async readApiKey(
      token: string,
    ): Promise<
      Result<
        { mnemonic: string; walletId: string },
        NotFoundError | InternalError
      >
    > {
      try {
        // Scan all key files and try to decrypt with the token
        const files = readdirSync(keysDir).filter((f) => f.endsWith(".json"));
        for (const filename of files) {
          const raw = await readJsonFile(join(keysDir, filename));
          if (!isApiKeyFile(raw)) continue;
          const decrypted = decryptWithHkdf(raw.crypto, token);
          if (Result.isOk(decrypted)) {
            const payload = parseApiKeyPayload(decrypted.value);
            if (Result.isOk(payload)) return payload;
          }
        }
        return Result.err(NotFoundError.create("ApiKey", "by-token"));
      } catch (e) {
        return Result.err(
          InternalError.create("Failed to read API key", {
            cause: String(e),
          }),
        );
      }
    },

    async revokeApiKey(id: string): Promise<Result<void, NotFoundError>> {
      const filePath = join(keysDir, `${id}.json`);
      if (!existsSync(filePath)) {
        return Result.err(NotFoundError.create("ApiKey", id));
      }
      unlinkSync(filePath);
      return Result.ok();
    },

    close(): void {
      // No resources to release for file-based vault
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an encrypted vault.
 *
 * For `:memory:` mode (tests), uses an in-memory Map-based store.
 * For file-based mode, creates a directory structure under `dataDir` and
 * resolves the vault secret through the configured secret provider.
 */
export async function createVault(
  dataDir: string,
  options: CreateVaultOptions = {},
): Promise<Result<Vault, InternalError>> {
  try {
    if (dataDir === ":memory:") {
      return Result.ok(createMemoryVault());
    }

    // Ensure base directory exists
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
      chmodSync(dataDir, 0o700);
    }

    const secretProvider =
      options.secretProvider ??
      resolveVaultSecretProvider(dataDir, options.vaultKeyPolicy ?? "open");
    const secretResult = await secretProvider.getSecret();
    if (Result.isError(secretResult)) {
      return Result.err(
        InternalError.create("Failed to resolve vault secret", {
          dataDir,
          providerKind: secretProvider.kind,
          cause: secretResult.error.message,
        }),
      );
    }

    const secretKey = await importSecretKey(hexToBytes(secretResult.value));
    return Result.ok(createFileVault(dataDir, secretKey));
  } catch (e) {
    return Result.err(
      InternalError.create("Failed to create vault", {
        dataDir,
        cause: String(e),
      }),
    );
  }
}
