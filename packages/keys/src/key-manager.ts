import { Result } from "better-result";
import type { TrustTier } from "@xmtp/signet-schemas";
import {
  InternalError,
  NotFoundError,
  type AuthError,
} from "@xmtp/signet-schemas";
import {
  KeyManagerConfigSchema,
  type KeyManagerConfig,
  type PlatformCapability,
} from "./config.js";
import { detectPlatform, platformToTrustTier } from "./platform.js";
import { createVault } from "./vault.js";
import {
  createOperationalKeyManager,
  type OperationalKeyManager,
} from "./operational-key.js";
import {
  createSessionKeyManager,
  type SessionKeyManager,
} from "./session-key.js";
import { createAdminKeyManager, type AdminKeyManager } from "./admin-key.js";
import { initializeRootKey } from "./root-key.js";
import type { RootKeyHandle, OperationalKey, SessionKey } from "./types.js";

export interface KeyManager {
  initialize(): Promise<Result<RootKeyHandle, InternalError | AuthError>>;

  readonly platform: PlatformCapability;
  readonly trustTier: TrustTier;

  /** Access admin key operations. */
  readonly admin: AdminKeyManager;

  createOperationalKey(
    identityId: string,
    groupId: string | null,
  ): Promise<Result<OperationalKey, InternalError>>;

  getOperationalKey(identityId: string): Result<OperationalKey, NotFoundError>;

  getOperationalKeyByGroupId(
    groupId: string,
  ): Result<OperationalKey, NotFoundError>;

  rotateOperationalKey(
    identityId: string,
  ): Promise<Result<OperationalKey, InternalError | NotFoundError>>;

  listOperationalKeys(): readonly OperationalKey[];

  issueSessionKey(
    sessionId: string,
    ttlSeconds: number,
  ): Promise<Result<SessionKey, InternalError>>;

  revokeSessionKey(keyId: string): Result<void, NotFoundError>;

  signWithOperationalKey(
    identityId: string,
    data: Uint8Array,
  ): Promise<Result<Uint8Array, InternalError | NotFoundError>>;

  signWithSessionKey(
    keyId: string,
    data: Uint8Array,
  ): Promise<Result<Uint8Array, InternalError | NotFoundError>>;

  getOrCreateDbKey(
    identityId: string,
  ): Promise<Result<Uint8Array, InternalError>>;

  /**
   * Retrieve or generate a secp256k1 private key for XMTP identity
   * registration. The key is persisted in the vault so the same key
   * is returned across restarts.
   */
  getOrCreateXmtpIdentityKey(
    identityId: string,
  ): Promise<Result<`0x${string}`, InternalError>>;

  vaultSet(
    name: string,
    value: Uint8Array,
  ): Promise<Result<void, InternalError>>;

  vaultGet(
    name: string,
  ): Promise<Result<Uint8Array, NotFoundError | InternalError>>;

  vaultDelete(name: string): Promise<Result<void, NotFoundError>>;

  vaultList(): readonly string[];

  close(): void;
}

export async function createKeyManager(
  rawConfig: Partial<KeyManagerConfig> & { dataDir: string },
): Promise<Result<KeyManager, InternalError>> {
  const parsed = KeyManagerConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    return Result.err(
      InternalError.create("Invalid key manager config", {
        issues: parsed.error.issues,
      }),
    );
  }
  const config = parsed.data;

  const detectedPlatform = detectPlatform();
  const trustTier = platformToTrustTier(detectedPlatform);

  const vaultResult = await createVault(config.dataDir);
  if (Result.isError(vaultResult)) return vaultResult;
  const vault = vaultResult.value;

  const opKeys: OperationalKeyManager = createOperationalKeyManager(vault);
  const sessionKeys: SessionKeyManager = createSessionKeyManager();
  const adminKeys: AdminKeyManager = createAdminKeyManager(vault);

  let rootKeyHandle: RootKeyHandle | null = null;

  const manager: KeyManager = {
    get platform(): PlatformCapability {
      return detectedPlatform;
    },

    get trustTier(): TrustTier {
      return trustTier;
    },

    get admin(): AdminKeyManager {
      return adminKeys;
    },

    async initialize(): Promise<
      Result<RootKeyHandle, InternalError | AuthError>
    > {
      if (rootKeyHandle) {
        return Result.ok(rootKeyHandle);
      }
      const result = await initializeRootKey(
        vault,
        config.rootKeyPolicy,
        detectedPlatform,
      );
      if (Result.isError(result)) return result;
      rootKeyHandle = result.value;
      return Result.ok(rootKeyHandle);
    },

    async createOperationalKey(
      identityId: string,
      groupId: string | null,
    ): Promise<Result<OperationalKey, InternalError>> {
      return opKeys.create(identityId, groupId);
    },

    getOperationalKey(
      identityId: string,
    ): Result<OperationalKey, NotFoundError> {
      return opKeys.get(identityId);
    },

    getOperationalKeyByGroupId(
      groupId: string,
    ): Result<OperationalKey, NotFoundError> {
      return opKeys.getByGroupId(groupId);
    },

    async rotateOperationalKey(
      identityId: string,
    ): Promise<Result<OperationalKey, InternalError | NotFoundError>> {
      return opKeys.rotate(identityId);
    },

    listOperationalKeys(): readonly OperationalKey[] {
      return opKeys.list();
    },

    async issueSessionKey(
      sessionId: string,
      ttlSeconds: number,
    ): Promise<Result<SessionKey, InternalError>> {
      return sessionKeys.issue(sessionId, ttlSeconds);
    },

    revokeSessionKey(keyId: string): Result<void, NotFoundError> {
      return sessionKeys.revoke(keyId);
    },

    async signWithOperationalKey(
      identityId: string,
      data: Uint8Array,
    ): Promise<Result<Uint8Array, InternalError | NotFoundError>> {
      return opKeys.sign(identityId, data);
    },

    async signWithSessionKey(
      keyId: string,
      data: Uint8Array,
    ): Promise<Result<Uint8Array, InternalError | NotFoundError>> {
      return sessionKeys.sign(keyId, data);
    },

    async getOrCreateDbKey(
      identityId: string,
    ): Promise<Result<Uint8Array, InternalError>> {
      const vaultKey = `db-key:${identityId}`;
      const existing = await vault.get(vaultKey);
      if (Result.isOk(existing)) {
        return Result.ok(existing.value);
      }
      // Propagate internal errors; NotFoundError means key doesn't exist yet
      if (existing.error._tag !== "NotFoundError") {
        return existing as Result<Uint8Array, InternalError>;
      }
      // Generate and persist a new random 32-byte key
      const newKey = crypto.getRandomValues(new Uint8Array(32));
      const setResult = await vault.set(vaultKey, newKey);
      if (Result.isError(setResult)) return setResult;
      return Result.ok(newKey);
    },

    async getOrCreateXmtpIdentityKey(
      identityId: string,
    ): Promise<Result<`0x${string}`, InternalError>> {
      const vaultKey = `xmtp-identity-key:${identityId}`;
      const existing = await vault.get(vaultKey);
      if (Result.isOk(existing)) {
        // Decode stored bytes back to hex
        const hex = Array.from(existing.value)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        return Result.ok(`0x${hex}` as `0x${string}`);
      }
      // Propagate internal errors; NotFoundError means key doesn't exist yet
      if (existing.error._tag !== "NotFoundError") {
        return existing as Result<`0x${string}`, InternalError>;
      }
      // Generate a new random 32-byte secp256k1 private key
      const newKey = crypto.getRandomValues(new Uint8Array(32));
      const setResult = await vault.set(vaultKey, newKey);
      if (Result.isError(setResult)) return setResult;
      const hex = Array.from(newKey)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return Result.ok(`0x${hex}` as `0x${string}`);
    },

    async vaultSet(
      name: string,
      value: Uint8Array,
    ): Promise<Result<void, InternalError>> {
      return vault.set(name, value);
    },

    async vaultGet(
      name: string,
    ): Promise<Result<Uint8Array, NotFoundError | InternalError>> {
      return vault.get(name);
    },

    async vaultDelete(name: string): Promise<Result<void, NotFoundError>> {
      return vault.delete(name);
    },

    vaultList(): readonly string[] {
      return vault.list();
    },

    close(): void {
      vault.close();
    },
  };

  return Result.ok(manager);
}
