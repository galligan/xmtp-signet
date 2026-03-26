import { Result } from "better-result";
import {
  InternalError,
  NotFoundError,
  type AuthError,
  type SignetError,
} from "@xmtp/signet-schemas";
import {
  KeyManagerConfigSchema,
  type KeyManagerConfig,
  type PlatformCapability,
} from "./config.js";
import { detectPlatform, platformToTrustTier } from "./platform.js";
import type { TrustTier } from "./platform.js";
import {
  createBiometricGate,
  type BiometricPrompter,
} from "./biometric-gate.js";
import type { RootKeyHandle, OperationalKey, CredentialKey } from "./types.js";
import { verifyJwt as verifyAdminJwt, type AdminJwtPayload } from "./jwt.js";
import {
  exportPrivateKey,
  exportPublicKey,
  fingerprint,
  generateEd25519KeyPair,
  importEd25519PrivateKey,
  signEd25519,
  toHex,
} from "./crypto-keys.js";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import { join } from "node:path";
import { createVault, type Vault } from "./vault.js";
import { resolveGatePrompter } from "./se-gate-prompter.js";
import type { VaultSecretProvider } from "./vault-secret-provider.js";

type AdminKeyInfo = string & {
  readonly publicKey: string;
  readonly fingerprint: string;
};

interface SimpleKvStore {
  get(key: string): Promise<Result<Uint8Array, NotFoundError | InternalError>>;
  set(key: string, value: Uint8Array): Promise<Result<void, InternalError>>;
  delete(key: string): Promise<Result<void, NotFoundError>>;
  list(): readonly string[];
  close(): void;
}

interface OperationalKeyEntry {
  readonly key: OperationalKey;
  readonly privateKey: CryptoKey;
}

interface CredentialKeyEntry {
  readonly key: CredentialKey;
  readonly privateKey: CryptoKey;
}

type CreateKeyManagerDeps = {
  readonly vaultSecretProvider?: VaultSecretProvider;
  readonly biometricPrompter?: BiometricPrompter;
};

/**
 * Admin key operations used by the CLI and runtime boot path.
 */
export interface AdminKeyManager {
  /** Whether an admin key pair is already initialized. */
  exists(): boolean;

  /** Create and persist the admin signing key. */
  create(): Promise<Result<AdminKeyInfo, SignetError>>;

  /** Read the existing admin key metadata without re-creating it. */
  get(): Promise<Result<AdminKeyInfo, NotFoundError | InternalError>>;

  /** Sign a JWT for admin authentication. */
  signJwt(opts: { ttlSeconds: number }): Promise<Result<string, SignetError>>;

  /** Verify an admin JWT and return the decoded payload. */
  verifyJwt(token: string): Promise<Result<AdminJwtPayload, SignetError>>;
}

/**
 * Adapter-style key manager surface used by CLI and integration tests.
 *
 * This is intentionally isolated in one module so the rest of the keys
 * package can keep moving toward the `KeyBackend` runtime.
 */
export interface KeyManager {
  /** Initialize root key state and reload persisted admin material. */
  initialize(): Promise<Result<RootKeyHandle, InternalError | AuthError>>;

  /** Detected platform capability. */
  readonly platform: PlatformCapability;

  /** Trust tier derived from the platform capability. */
  readonly trustTier: TrustTier;

  /** Admin key operations. */
  readonly admin: AdminKeyManager;

  /** Create an Ed25519 operational key for an identity. */
  createOperationalKey(
    identityId: string,
    groupId: string | null,
  ): Promise<Result<OperationalKey, SignetError>>;

  /** Lookup an operational key by identity ID. */
  getOperationalKey(identityId: string): Result<OperationalKey, NotFoundError>;

  /** Lookup an operational key by group ID. */
  getOperationalKeyByGroupId(
    groupId: string,
  ): Result<OperationalKey, NotFoundError>;

  /** Rotate an operational key in place. */
  rotateOperationalKey(
    identityId: string,
  ): Promise<Result<OperationalKey, SignetError>>;

  /** List all known operational keys. */
  listOperationalKeys(): readonly OperationalKey[];

  /** Issue an in-memory credential key. */
  issueCredentialKey(
    credentialId: string,
    ttlSeconds: number,
  ): Promise<Result<CredentialKey, InternalError>>;

  /** Revoke an in-memory credential key. */
  revokeCredentialKey(keyId: string): Result<void, NotFoundError>;

  /** Sign data with an operational key. */
  signWithOperationalKey(
    identityId: string,
    data: Uint8Array,
  ): Promise<Result<Uint8Array, InternalError | NotFoundError>>;

  /** Sign data with a credential key. */
  signWithCredentialKey(
    keyId: string,
    data: Uint8Array,
  ): Promise<Result<Uint8Array, InternalError | NotFoundError>>;

  /** Get or create a deterministic DB encryption key for an identity. */
  getOrCreateDbKey(
    identityId: string,
  ): Promise<Result<Uint8Array, InternalError>>;

  /** Get or create the XMTP identity private key for an identity. */
  getOrCreateXmtpIdentityKey(
    identityId: string,
  ): Promise<Result<`0x${string}`, InternalError>>;

  /** Store arbitrary bytes in the compat vault. */
  vaultSet(
    name: string,
    value: Uint8Array,
  ): Promise<Result<void, InternalError>>;

  /** Read arbitrary bytes from the compat vault. */
  vaultGet(
    name: string,
  ): Promise<Result<Uint8Array, NotFoundError | InternalError>>;

  /** Delete an entry from the compat vault. */
  vaultDelete(name: string): Promise<Result<void, NotFoundError>>;

  /** List compat vault entry names. */
  vaultList(): readonly string[];

  /** Start operational key auto-rotation if configured. */
  startAutoRotation(): void;

  /** Stop operational key auto-rotation. */
  stopAutoRotation(): void;

  /** Release resources held by the compat manager. */
  close(): void;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createAdminKeyInfo(
  publicKey: string,
  fingerprint: string,
): AdminKeyInfo {
  return Object.assign(new String(fingerprint), {
    publicKey,
    fingerprint,
  }) as AdminKeyInfo;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
  }
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function fingerprintBytes(bytes: Uint8Array): Promise<string> {
  const view = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength),
  );
  return bytesToHex(new Uint8Array(digest));
}

function legacyKvDirPath(dataDir: string): string {
  return join(dataDir, "kv");
}

function legacyKvKeyPath(dataDir: string, key: string): string {
  return join(legacyKvDirPath(dataDir), encodeURIComponent(key));
}

function readLegacyKvEntry(
  dataDir: string,
  key: string,
): Result<Uint8Array, NotFoundError | InternalError> {
  const path = legacyKvKeyPath(dataDir, key);
  if (!existsSync(path)) {
    return Result.err(NotFoundError.create("kv-entry", key));
  }

  try {
    const hex = readFileSync(path, "utf8");
    return Result.ok(hexToBytes(hex));
  } catch (error: unknown) {
    return Result.err(
      InternalError.create("Failed to read legacy compat vault entry", {
        key,
        cause: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function removeLegacyKvEntry(dataDir: string, key: string): void {
  const path = legacyKvKeyPath(dataDir, key);
  if (!existsSync(path)) {
    return;
  }

  try {
    unlinkSync(path);
  } catch {
    return;
  }

  const kvDir = legacyKvDirPath(dataDir);
  if (!existsSync(kvDir)) {
    return;
  }

  try {
    if (readdirSync(kvDir).length === 0) {
      rmdirSync(kvDir);
    }
  } catch {
    // Best-effort cleanup only.
  }
}

function listLegacyKvEntries(dataDir: string): readonly string[] {
  const kvDir = legacyKvDirPath(dataDir);
  if (!existsSync(kvDir)) {
    return [];
  }

  return readdirSync(kvDir).map(decodeURIComponent);
}

function createCompatSecretStore(dataDir: string, vault: Vault): SimpleKvStore {
  return {
    async get(key) {
      const current = await vault.get(key);
      if (Result.isOk(current)) {
        return current;
      }
      if (current.error._tag !== "NotFoundError") {
        return current;
      }

      const legacy = readLegacyKvEntry(dataDir, key);
      if (Result.isError(legacy)) {
        return legacy;
      }

      const migrated = await vault.set(key, legacy.value);
      if (Result.isError(migrated)) {
        return migrated;
      }

      removeLegacyKvEntry(dataDir, key);
      return Result.ok(legacy.value);
    },

    async set(key, value) {
      const result = await vault.set(key, value);
      if (Result.isOk(result)) {
        removeLegacyKvEntry(dataDir, key);
      }
      return result;
    },

    async delete(key) {
      const current = await vault.delete(key);
      const hadLegacy = existsSync(legacyKvKeyPath(dataDir, key));

      if (Result.isOk(current)) {
        if (hadLegacy) {
          removeLegacyKvEntry(dataDir, key);
        }
        return current;
      }

      if (current.error._tag !== "NotFoundError") {
        return current;
      }

      if (hadLegacy) {
        removeLegacyKvEntry(dataDir, key);
        return Result.ok(undefined);
      }

      return current;
    },

    list() {
      return Array.from(
        new Set([...vault.list(), ...listLegacyKvEntries(dataDir)]),
      );
    },

    close() {
      vault.close();
    },
  };
}

/**
 * Create the compatibility key manager used by the early runtime layers.
 */
export async function createKeyManager(
  rawConfig: Partial<KeyManagerConfig> & {
    dataDir: string;
  } & CreateKeyManagerDeps,
): Promise<Result<KeyManager, InternalError>> {
  const { vaultSecretProvider, biometricPrompter, ...configInput } = rawConfig;

  const parsed = KeyManagerConfigSchema.safeParse(configInput);
  if (!parsed.success) {
    return Result.err(
      InternalError.create("Invalid key manager config", {
        issues: parsed.error.issues,
      }),
    );
  }

  const config = parsed.data;
  mkdirSync(config.dataDir, { recursive: true });

  const vaultResult = await createVault(config.dataDir, {
    secretProvider: vaultSecretProvider,
    vaultKeyPolicy: config.vaultKeyPolicy,
  });
  if (Result.isError(vaultResult)) {
    return vaultResult;
  }

  const kv = createCompatSecretStore(config.dataDir, vaultResult.value);
  const opKeys = new Map<string, OperationalKeyEntry>();
  const groupIdIndex = new Map<string, string>();
  const credentialKeys = new Map<string, CredentialKeyEntry>();
  const gate = createBiometricGate(
    config.biometricGating,
    biometricPrompter ?? resolveGatePrompter(config.dataDir),
  );

  let activePlatform = detectPlatform();
  let activeTrustTier = platformToTrustTier(activePlatform);
  let rootKeyHandle: RootKeyHandle | null = null;
  let rotationTimer: ReturnType<typeof setInterval> | null = null;
  let adminPublicKeyHex: string | null = null;
  let adminPrivateKey: CryptoKey | null = null;

  async function readAdminInfo(): Promise<
    Result<AdminKeyInfo, NotFoundError | InternalError>
  > {
    if (adminPublicKeyHex === null) {
      return Result.err(NotFoundError.create("admin-key", "admin"));
    }
    return Result.ok(
      createAdminKeyInfo(
        adminPublicKeyHex,
        await fingerprintBytes(hexToBytes(adminPublicKeyHex)),
      ),
    );
  }

  async function createOperationalKeyRecord(
    identityId: string,
    groupId: string | null,
  ): Promise<Result<OperationalKey, InternalError>> {
    const pairResult = await generateEd25519KeyPair();
    if (Result.isError(pairResult)) {
      return pairResult;
    }

    const publicKeyResult = await exportPublicKey(pairResult.value.publicKey);
    if (Result.isError(publicKeyResult)) {
      return publicKeyResult;
    }

    const fingerprintResult = await fingerprint(pairResult.value.publicKey);
    if (Result.isError(fingerprintResult)) {
      return fingerprintResult;
    }

    const now = new Date().toISOString();
    const operationalKey: OperationalKey = {
      keyId: `op-${fingerprintResult.value.slice(0, 16)}`,
      identityId,
      groupId,
      publicKey: toHex(publicKeyResult.value),
      fingerprint: fingerprintResult.value,
      createdAt: now,
      rotatedAt: null,
    };

    opKeys.set(identityId, {
      key: operationalKey,
      privateKey: pairResult.value.privateKey,
    });
    if (groupId !== null) {
      groupIdIndex.set(groupId, identityId);
    }
    return Result.ok(operationalKey);
  }

  const admin: AdminKeyManager = {
    exists(): boolean {
      return adminPublicKeyHex !== null;
    },

    async create(): Promise<Result<AdminKeyInfo, SignetError>> {
      if (adminPublicKeyHex !== null) {
        return Result.err(InternalError.create("Admin key already exists"));
      }

      const gateResult = await gate("rootKeyCreation");
      if (Result.isError(gateResult)) {
        return gateResult;
      }

      const pairResult = await generateEd25519KeyPair();
      if (Result.isError(pairResult)) {
        return pairResult;
      }

      const publicKeyResult = await exportPublicKey(pairResult.value.publicKey);
      if (Result.isError(publicKeyResult)) {
        return publicKeyResult;
      }

      const privateKeyResult = await exportPrivateKey(
        pairResult.value.privateKey,
      );
      if (Result.isError(privateKeyResult)) {
        return privateKeyResult;
      }

      adminPublicKeyHex = toHex(publicKeyResult.value);
      adminPrivateKey = pairResult.value.privateKey;

      const setPrivateResult = await kv.set(
        "admin-key",
        privateKeyResult.value,
      );
      if (Result.isError(setPrivateResult)) {
        return setPrivateResult;
      }
      const setPublicResult = await kv.set(
        "admin-key-pub",
        new TextEncoder().encode(adminPublicKeyHex),
      );
      if (Result.isError(setPublicResult)) {
        return setPublicResult;
      }

      const info = await readAdminInfo();
      return Result.isError(info)
        ? Result.err(
            InternalError.create("Failed to read created admin key metadata"),
          )
        : Result.ok(info.value);
    },

    async get(): Promise<Result<AdminKeyInfo, NotFoundError | InternalError>> {
      return readAdminInfo();
    },

    async signJwt(opts): Promise<Result<string, SignetError>> {
      if (adminPrivateKey === null) {
        return Result.err(InternalError.create("Admin key not initialized"));
      }

      const header = toBase64Url(
        new TextEncoder().encode(JSON.stringify({ alg: "EdDSA", typ: "JWT" })),
      );
      const now = Math.floor(Date.now() / 1000);
      const payload = toBase64Url(
        new TextEncoder().encode(
          JSON.stringify({
            iat: now,
            exp: now + opts.ttlSeconds,
            sub: "admin",
            iss: adminPublicKeyHex ?? "compat-admin",
            jti: toHex(crypto.getRandomValues(new Uint8Array(16))),
          }),
        ),
      );
      const message = new TextEncoder().encode(`${header}.${payload}`);
      const signature = await signEd25519(adminPrivateKey, message);
      if (Result.isError(signature)) {
        return signature;
      }
      return Result.ok(`${header}.${payload}.${toBase64Url(signature.value)}`);
    },

    async verifyJwt(token): Promise<Result<AdminJwtPayload, SignetError>> {
      if (adminPublicKeyHex === null) {
        return Result.err(InternalError.create("Admin key not initialized"));
      }
      return verifyAdminJwt(token, hexToBytes(adminPublicKeyHex));
    },
  };

  const manager: KeyManager = {
    get platform() {
      return activePlatform;
    },

    get trustTier() {
      return activeTrustTier;
    },

    get admin() {
      return admin;
    },

    async initialize(): Promise<
      Result<RootKeyHandle, InternalError | AuthError>
    > {
      if (rootKeyHandle !== null) {
        return Result.ok(rootKeyHandle);
      }

      const existingPublic = await kv.get("admin-key-pub");
      if (Result.isOk(existingPublic)) {
        adminPublicKeyHex = new TextDecoder().decode(existingPublic.value);
      }

      const existingPrivate = await kv.get("admin-key");
      if (Result.isOk(existingPrivate)) {
        const imported = await importEd25519PrivateKey(existingPrivate.value);
        if (Result.isError(imported)) {
          return imported;
        }
        adminPrivateKey = imported.value;
      }

      rootKeyHandle = {
        keyRef: "root-compat",
        publicKey: adminPublicKeyHex ?? "compat-root",
        policy: config.rootKeyPolicy,
        platform: activePlatform,
        createdAt: new Date().toISOString(),
      };
      activeTrustTier = platformToTrustTier(activePlatform);
      return Result.ok(rootKeyHandle);
    },

    async createOperationalKey(identityId, groupId) {
      const gateResult = await gate("agentCreation");
      if (Result.isError(gateResult)) {
        return gateResult;
      }
      return createOperationalKeyRecord(identityId, groupId);
    },

    getOperationalKey(identityId) {
      const entry = opKeys.get(identityId);
      return entry === undefined
        ? Result.err(NotFoundError.create("operational-key", identityId))
        : Result.ok(entry.key);
    },

    getOperationalKeyByGroupId(groupId) {
      const identityId = groupIdIndex.get(groupId);
      return identityId === undefined
        ? Result.err(NotFoundError.create("operational-key", groupId))
        : manager.getOperationalKey(identityId);
    },

    async rotateOperationalKey(identityId) {
      const existing = opKeys.get(identityId);
      if (existing === undefined) {
        return Result.err(NotFoundError.create("operational-key", identityId));
      }

      const gateResult = await gate("operationalKeyRotation");
      if (Result.isError(gateResult)) {
        return gateResult;
      }

      return createOperationalKeyRecord(identityId, existing.key.groupId);
    },

    listOperationalKeys() {
      return Array.from(opKeys.values(), (entry) => entry.key);
    },

    async issueCredentialKey(credentialId, ttlSeconds) {
      const pairResult = await generateEd25519KeyPair();
      if (Result.isError(pairResult)) {
        return pairResult;
      }

      const fingerprintResult = await fingerprint(pairResult.value.publicKey);
      if (Result.isError(fingerprintResult)) {
        return fingerprintResult;
      }

      const now = new Date();
      const credentialKey: CredentialKey = {
        keyId: `credkey-${fingerprintResult.value.slice(0, 16)}`,
        credentialId,
        fingerprint: fingerprintResult.value,
        expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
        createdAt: now.toISOString(),
      };
      credentialKeys.set(credentialKey.keyId, {
        key: credentialKey,
        privateKey: pairResult.value.privateKey,
      });
      return Result.ok(credentialKey);
    },

    revokeCredentialKey(keyId) {
      if (!credentialKeys.has(keyId)) {
        return Result.err(NotFoundError.create("credential-key", keyId));
      }
      credentialKeys.delete(keyId);
      return Result.ok(undefined);
    },

    async signWithOperationalKey(identityId, data) {
      const entry = opKeys.get(identityId);
      return entry === undefined
        ? Result.err(NotFoundError.create("operational-key", identityId))
        : signEd25519(entry.privateKey, data);
    },

    async signWithCredentialKey(keyId, data) {
      const entry = credentialKeys.get(keyId);
      if (entry === undefined) {
        return Result.err(NotFoundError.create("credential-key", keyId));
      }
      if (Date.now() >= new Date(entry.key.expiresAt).getTime()) {
        credentialKeys.delete(keyId);
        return Result.err(NotFoundError.create("credential-key", keyId));
      }
      return signEd25519(entry.privateKey, data);
    },

    async getOrCreateDbKey(identityId) {
      const key = `db-key:${identityId}`;
      const existing = await kv.get(key);
      if (Result.isOk(existing)) {
        return Result.ok(existing.value);
      }
      if (existing.error._tag !== "NotFoundError") {
        return existing as Result<Uint8Array, InternalError>;
      }
      const generated = crypto.getRandomValues(new Uint8Array(32));
      const setResult = await kv.set(key, generated);
      return Result.isError(setResult) ? setResult : Result.ok(generated);
    },

    async getOrCreateXmtpIdentityKey(identityId) {
      const key = `xmtp-identity-key:${identityId}`;
      const existing = await kv.get(key);
      if (Result.isOk(existing)) {
        return Result.ok(`0x${bytesToHex(existing.value)}` as `0x${string}`);
      }
      if (existing.error._tag !== "NotFoundError") {
        return existing as Result<`0x${string}`, InternalError>;
      }
      const generated = crypto.getRandomValues(new Uint8Array(32));
      const setResult = await kv.set(key, generated);
      if (Result.isError(setResult)) {
        return setResult;
      }
      return Result.ok(`0x${bytesToHex(generated)}` as `0x${string}`);
    },

    async vaultSet(name, value) {
      return kv.set(name, value);
    },

    async vaultGet(name) {
      return kv.get(name);
    },

    async vaultDelete(name) {
      return kv.delete(name);
    },

    vaultList() {
      return kv.list();
    },

    startAutoRotation() {
      if (config.rotationIntervalSeconds <= 0 || rotationTimer !== null) {
        return;
      }
      rotationTimer = setInterval(() => {
        void (async () => {
          for (const identityId of opKeys.keys()) {
            await manager.rotateOperationalKey(identityId);
          }
        })();
      }, config.rotationIntervalSeconds * 1000);
    },

    stopAutoRotation() {
      if (rotationTimer !== null) {
        clearInterval(rotationTimer);
        rotationTimer = null;
      }
    },

    close() {
      manager.stopAutoRotation();
      kv.close();
    },
  };

  return Result.ok(manager);
}

/**
 * Create a compat signer provider backed by the v0-style key manager.
 */
export function createSignerProviderCompat(
  keyManager: KeyManager,
  identityId: string,
): import("@xmtp/signet-contracts").SignerProvider {
  return {
    async sign(data): Promise<Result<Uint8Array, SignetError>> {
      return keyManager.signWithOperationalKey(identityId, data);
    },
    async getPublicKey(): Promise<Result<Uint8Array, SignetError>> {
      const key = keyManager.getOperationalKey(identityId);
      return Result.isError(key)
        ? key
        : Result.ok(hexToBytes(key.value.publicKey));
    },
    async getFingerprint(): Promise<Result<string, SignetError>> {
      const key = keyManager.getOperationalKey(identityId);
      return Result.isError(key) ? key : Result.ok(key.value.fingerprint);
    },
    async getDbEncryptionKey(): Promise<Result<Uint8Array, SignetError>> {
      return keyManager.getOrCreateDbKey(identityId);
    },
    async getXmtpIdentityKey(): Promise<Result<`0x${string}`, SignetError>> {
      return keyManager.getOrCreateXmtpIdentityKey(identityId);
    },
  };
}

/**
 * Create a compat seal stamper backed by the v0-style key manager.
 */
export function createSealStamperCompat(
  keyManager: KeyManager,
  identityId: string,
): import("@xmtp/signet-contracts").SealStamper {
  return {
    async sign(
      payload: import("@xmtp/signet-schemas").SealPayloadType,
    ): Promise<
      Result<import("@xmtp/signet-schemas").SealEnvelopeType, SignetError>
    > {
      const canonical = new TextEncoder().encode(
        JSON.stringify(sortKeysCompat(payload)),
      );
      const signature = await keyManager.signWithOperationalKey(
        identityId,
        canonical,
      );
      if (Result.isError(signature)) {
        return signature;
      }

      const key = keyManager.getOperationalKey(identityId);
      if (Result.isError(key)) {
        return key;
      }

      return Result.ok({
        chain: {
          current: payload,
          delta: { added: [], removed: [], changed: [] },
        },
        signature: Buffer.from(signature.value).toString("base64"),
        keyId: key.value.publicKey,
        algorithm: "Ed25519",
      });
    },

    async signRevocation(
      payload: import("@xmtp/signet-schemas").RevocationSeal,
    ): Promise<
      Result<
        import("@xmtp/signet-contracts").SignedRevocationEnvelope,
        SignetError
      >
    > {
      const canonical = new TextEncoder().encode(
        JSON.stringify(sortKeysCompat(payload)),
      );
      const signature = await keyManager.signWithOperationalKey(
        identityId,
        canonical,
      );
      if (Result.isError(signature)) {
        return signature;
      }

      const key = keyManager.getOperationalKey(identityId);
      if (Result.isError(key)) {
        return key;
      }

      return Result.ok({
        revocation: payload,
        signature: Buffer.from(signature.value).toString("base64"),
        signatureAlgorithm: "Ed25519",
        signerKeyRef: key.value.publicKey,
      });
    },
  };
}

function sortKeysCompat(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysCompat);
  }
  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(value as Record<string, unknown>).sort();
  for (const key of keys) {
    sorted[key] = sortKeysCompat((value as Record<string, unknown>)[key]);
  }
  return sorted;
}
