import { Result } from "better-result";
import {
  InternalError,
  NotFoundError,
  AuthError,
  ValidationError,
} from "@xmtp/signet-schemas";
import type { Vault } from "./vault.js";
import {
  generateEd25519KeyPair,
  exportPublicKey,
  exportPrivateKey,
  importEd25519PrivateKey,
  fingerprint as computeFingerprint,
  toHex,
} from "./crypto-keys.js";
import {
  signJwt as signJwtRaw,
  verifyJwt as verifyJwtRaw,
  AdminJwtConfigSchema,
  type AdminJwtPayload,
} from "./jwt.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** An Ed25519 admin key pair managed by the vault. */
export interface AdminKeyRecord {
  readonly keyId: string;
  readonly publicKey: string;
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly rotatedAt: string | null;
}

/** Authentication context for admin-authenticated requests. */
export interface AdminAuthContext {
  readonly authMethod: AdminAuthMethod;
  readonly adminFingerprint: string;
  readonly expiresAt: string;
}

/** Supported admin authentication methods. Currently only JWT. */
export type AdminAuthMethod = "jwt";

/** Options for signing an admin JWT. */
export interface AdminJwtOptions {
  readonly ttlSeconds?: number;
}

// ---------------------------------------------------------------------------
// Vault key constants
// ---------------------------------------------------------------------------

const ADMIN_PRIVATE_KEY = "admin-key:private";
const ADMIN_PUBLIC_KEY = "admin-key:public";
const ADMIN_META_KEY = "admin-key:meta";

// ---------------------------------------------------------------------------
// AdminKeyManager
// ---------------------------------------------------------------------------

/** Manages Ed25519 admin key lifecycle: generation, rotation, JWT signing/verification. */
export interface AdminKeyManager {
  /** Generate and store a new admin key pair. Fails if one already exists. */
  create(): Promise<Result<AdminKeyRecord, InternalError>>;

  /** Retrieve the current admin key metadata from the vault. */
  get(): Promise<Result<AdminKeyRecord, NotFoundError | InternalError>>;

  /** Whether an admin key exists in the vault (synchronous, cached check). */
  exists(): boolean;

  /** Replace the current admin key with a freshly generated pair. */
  rotate(): Promise<Result<AdminKeyRecord, InternalError | NotFoundError>>;

  /** Sign a short-lived admin JWT using the stored private key. */
  signJwt(
    options?: AdminJwtOptions,
  ): Promise<Result<string, InternalError | NotFoundError | ValidationError>>;

  /** Verify an admin JWT against the stored public key. */
  verifyJwt(
    token: string,
  ): Promise<Result<AdminJwtPayload, AuthError | ValidationError>>;

  /** Export the admin public key as a hex string. */
  exportPublicKey(): Promise<Result<string, NotFoundError | InternalError>>;
}

/** Create an AdminKeyManager backed by the given vault. */
export function createAdminKeyManager(vault: Vault): AdminKeyManager {
  const config = AdminJwtConfigSchema.parse({});

  // Track existence in memory to avoid vault reads for exists()
  let adminKeyExists = vault.list().some((k) => k === ADMIN_META_KEY);

  async function loadMeta(): Promise<
    Result<AdminKeyRecord, NotFoundError | InternalError>
  > {
    const metaResult = await vault.get(ADMIN_META_KEY);
    if (Result.isError(metaResult)) {
      if (metaResult.error._tag === "NotFoundError") {
        return Result.err(NotFoundError.create("AdminKey", "admin"));
      }
      return metaResult as Result<never, InternalError>;
    }
    try {
      const json = new TextDecoder().decode(metaResult.value);
      return Result.ok(JSON.parse(json) as AdminKeyRecord);
    } catch (e) {
      return Result.err(
        InternalError.create("Failed to parse admin key metadata", {
          cause: String(e),
        }),
      );
    }
  }

  async function storeMeta(
    record: AdminKeyRecord,
  ): Promise<Result<void, InternalError>> {
    const bytes = new TextEncoder().encode(JSON.stringify(record));
    return vault.set(ADMIN_META_KEY, bytes);
  }

  async function generateAndStore(): Promise<
    Result<AdminKeyRecord, InternalError>
  > {
    const keyPair = await generateEd25519KeyPair();
    if (Result.isError(keyPair)) return keyPair;

    const pubBytes = await exportPublicKey(keyPair.value.publicKey);
    if (Result.isError(pubBytes)) return pubBytes;

    const fp = await computeFingerprint(keyPair.value.publicKey);
    if (Result.isError(fp)) return fp;

    const privBytes = await exportPrivateKey(keyPair.value.privateKey);
    if (Result.isError(privBytes)) return privBytes;

    // Store private key (PKCS8)
    const privResult = await vault.set(ADMIN_PRIVATE_KEY, privBytes.value);
    privBytes.value.fill(0); // zeroize
    if (Result.isError(privResult)) return privResult;

    // Store public key (raw 32 bytes)
    const pubResult = await vault.set(ADMIN_PUBLIC_KEY, pubBytes.value);
    if (Result.isError(pubResult)) return pubResult;

    return Result.ok({
      keyId: crypto.randomUUID(),
      publicKey: toHex(pubBytes.value),
      fingerprint: fp.value,
      createdAt: new Date().toISOString(),
      rotatedAt: null,
    });
  }

  return {
    async create(): Promise<Result<AdminKeyRecord, InternalError>> {
      if (adminKeyExists) {
        return Result.err(
          InternalError.create("Admin key already exists; use rotate instead"),
        );
      }

      const recordResult = await generateAndStore();
      if (Result.isError(recordResult)) return recordResult;

      const metaResult = await storeMeta(recordResult.value);
      if (Result.isError(metaResult)) return metaResult;

      adminKeyExists = true;
      return recordResult;
    },

    async get(): Promise<
      Result<AdminKeyRecord, NotFoundError | InternalError>
    > {
      return loadMeta();
    },

    exists(): boolean {
      return adminKeyExists;
    },

    async rotate(): Promise<
      Result<AdminKeyRecord, InternalError | NotFoundError>
    > {
      if (!adminKeyExists) {
        return Result.err(NotFoundError.create("AdminKey", "admin"));
      }

      const recordResult = await generateAndStore();
      if (Result.isError(recordResult)) return recordResult;

      const record: AdminKeyRecord = {
        ...recordResult.value,
        rotatedAt: new Date().toISOString(),
      };

      const metaResult = await storeMeta(record);
      if (Result.isError(metaResult)) return metaResult;

      return Result.ok(record);
    },

    async signJwt(
      options?: AdminJwtOptions,
    ): Promise<
      Result<string, InternalError | NotFoundError | ValidationError>
    > {
      const ttl = options?.ttlSeconds ?? config.defaultTtlSeconds;
      if (!Number.isFinite(ttl) || !Number.isInteger(ttl) || ttl <= 0) {
        return Result.err(
          ValidationError.create(
            "ttlSeconds",
            `TTL must be a positive integer, got ${String(ttl)}`,
          ),
        );
      }
      if (ttl > config.maxTtlSeconds) {
        return Result.err(
          ValidationError.create(
            "ttlSeconds",
            `TTL ${ttl}s exceeds maximum ${config.maxTtlSeconds}s`,
          ),
        );
      }

      // Load private key
      const privResult = await vault.get(ADMIN_PRIVATE_KEY);
      if (Result.isError(privResult)) {
        if (privResult.error._tag === "NotFoundError") {
          return Result.err(NotFoundError.create("AdminKey", "admin"));
        }
        return privResult as Result<never, InternalError>;
      }

      const imported = await importEd25519PrivateKey(privResult.value);
      if (Result.isError(imported)) return imported;

      // Load fingerprint
      const meta = await loadMeta();
      if (Result.isError(meta)) return meta;

      const now = Math.floor(Date.now() / 1000);
      const nonce = crypto.getRandomValues(new Uint8Array(16));
      const jti = toHex(nonce);

      const payload: AdminJwtPayload = {
        iss: meta.value.fingerprint,
        sub: "admin",
        iat: now,
        exp: now + ttl,
        jti,
      };

      return signJwtRaw(imported.value, payload);
    },

    async verifyJwt(
      token: string,
    ): Promise<Result<AdminJwtPayload, AuthError | ValidationError>> {
      // Load public key
      const pubResult = await vault.get(ADMIN_PUBLIC_KEY);
      if (Result.isError(pubResult)) {
        return Result.err(
          AuthError.create("Admin key not found for verification"),
        );
      }

      const result = await verifyJwtRaw(token, pubResult.value, {
        clockSkewSeconds: config.clockSkewSeconds,
      });
      if (Result.isError(result)) return result;

      // Check fingerprint matches stored key
      const meta = await loadMeta();
      if (Result.isError(meta)) {
        return Result.err(AuthError.create("Admin key metadata not found"));
      }

      if (result.value.iss !== meta.value.fingerprint) {
        return Result.err(AuthError.create("Admin key fingerprint mismatch"));
      }

      return result;
    },

    async exportPublicKey(): Promise<
      Result<string, NotFoundError | InternalError>
    > {
      const meta = await loadMeta();
      if (Result.isError(meta)) return meta;
      return Result.ok(meta.value.publicKey);
    },
  };
}
