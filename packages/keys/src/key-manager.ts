import { Result } from "better-result";
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
import {
  detectPlatform,
  platformToTrustTier,
  type KeyTrustTier,
} from "./platform.js";
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

/** High-level key manager facade for all key tiers and vault access. */
export interface KeyManager {
  /** Initialize the root key material and any dependent key tiers. */
  initialize(): Promise<Result<RootKeyHandle, InternalError | AuthError>>;

  /** Detected platform capability for key storage and signing. */
  readonly platform: PlatformCapability;
  /** Trust tier inferred from the detected platform. */
  readonly trustTier: KeyTrustTier;

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

  /** Start periodic auto-rotation of operational keys. No-op if interval is 0. */
  startAutoRotation(): void;

  /** Stop the auto-rotation timer. */
  stopAutoRotation(): void;

  close(): void;
}

/**
 * Create a key manager backed by the configured vault and detected
 * platform capability.
 */
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

  let activePlatform = detectPlatform();
  let activeTrustTier = platformToTrustTier(activePlatform);

  const vaultResult = await createVault(config.dataDir);
  if (Result.isError(vaultResult)) return vaultResult;
  const vault = vaultResult.value;

  const opKeys: OperationalKeyManager = createOperationalKeyManager(vault);
  const sessionKeys: SessionKeyManager = createSessionKeyManager();
  const adminKeys: AdminKeyManager = createAdminKeyManager(vault);

  let rootKeyHandle: RootKeyHandle | null = null;
  let rotationTimer: ReturnType<typeof setInterval> | null = null;

  const manager: KeyManager = {
    get platform(): PlatformCapability {
      return activePlatform;
    },

    get trustTier(): KeyTrustTier {
      return activeTrustTier;
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
        activePlatform,
      );
      if (Result.isError(result)) return result;
      rootKeyHandle = result.value;
      // Use the stored handle's platform as authoritative — a persisted
      // software-vault root on a machine that now detects SE must not
      // advertise secure-enclave trust tier.
      activePlatform = rootKeyHandle.platform;
      activeTrustTier = platformToTrustTier(activePlatform);
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

    startAutoRotation(): void {
      if (config.rotationIntervalSeconds <= 0) return;
      if (rotationTimer !== null) return; // already running

      const intervalMs = config.rotationIntervalSeconds * 1000;
      rotationTimer = setInterval(() => {
        void (async () => {
          const keys = opKeys.list();
          for (const key of keys) {
            const result = await opKeys.rotate(key.identityId);
            if (Result.isError(result)) {
              // eslint-disable-next-line no-console
              console.warn(
                "[keys] auto-rotation failed for %s: %s",
                key.identityId,
                result.error.message,
              );
            }
          }
        })();
      }, intervalMs);
    },

    stopAutoRotation(): void {
      if (rotationTimer !== null) {
        clearInterval(rotationTimer);
        rotationTimer = null;
      }
    },

    close(): void {
      manager.stopAutoRotation();
      vault.close();
    },
  };

  return Result.ok(manager);
}
