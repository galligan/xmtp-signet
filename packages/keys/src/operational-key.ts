import { Result } from "better-result";
import { InternalError, NotFoundError } from "@xmtp/signet-schemas";
import type { Vault } from "./vault.js";
import type { OperationalKey } from "./types.js";
import {
  generateEd25519KeyPair,
  exportPublicKey,
  exportPrivateKey,
  importEd25519PrivateKey,
  signEd25519,
  fingerprint as computeFingerprint,
  toHex,
} from "./crypto-keys.js";

/** Manager for operational keys backed by the vault. */
export interface OperationalKeyManager {
  /** Create a new operational key for an identity and optional group. */
  create(
    identityId: string,
    groupId: string | null,
  ): Promise<Result<OperationalKey, InternalError>>;

  /** Look up an operational key by identity. */
  get(identityId: string): Result<OperationalKey, NotFoundError>;

  /** Look up an operational key by group membership. */
  getByGroupId(groupId: string): Result<OperationalKey, NotFoundError>;

  /** Rotate an existing operational key in place. */
  rotate(
    identityId: string,
  ): Promise<Result<OperationalKey, InternalError | NotFoundError>>;

  /** Return all currently known operational keys. */
  list(): readonly OperationalKey[];

  /** Sign bytes using the operational key for an identity. */
  sign(
    identityId: string,
    data: Uint8Array,
  ): Promise<Result<Uint8Array, InternalError | NotFoundError>>;
}

/** Vault key prefix for operational key material. */
const OP_KEY_PREFIX = "op-key:";

/**
 * Create an operational key manager backed by the provided vault.
 */
export function createOperationalKeyManager(
  vault: Vault,
): OperationalKeyManager {
  const keys = new Map<string, OperationalKey>();
  const groupIndex = new Map<string, string>();

  async function storeKeyMaterial(
    identityId: string,
    privateKey: CryptoKey,
  ): Promise<Result<void, InternalError>> {
    const exported = await exportPrivateKey(privateKey);
    if (Result.isError(exported)) return exported;
    const result = await vault.set(
      `${OP_KEY_PREFIX}${identityId}`,
      exported.value,
    );
    // Zeroize exported private key bytes after vault storage
    exported.value.fill(0);
    return result;
  }

  async function loadAndSign(
    identityId: string,
    data: Uint8Array,
  ): Promise<Result<Uint8Array, InternalError | NotFoundError>> {
    const vaultResult = await vault.get(`${OP_KEY_PREFIX}${identityId}`);
    if (Result.isError(vaultResult)) {
      if (vaultResult.error._tag === "NotFoundError") {
        return Result.err(NotFoundError.create("OperationalKey", identityId));
      }
      return vaultResult;
    }

    const imported = await importEd25519PrivateKey(vaultResult.value);
    if (Result.isError(imported)) return imported;

    return signEd25519(imported.value, data);
  }

  return {
    async create(
      identityId: string,
      groupId: string | null,
    ): Promise<Result<OperationalKey, InternalError>> {
      const keyPair = await generateEd25519KeyPair();
      if (Result.isError(keyPair)) return keyPair;

      const pubBytes = await exportPublicKey(keyPair.value.publicKey);
      if (Result.isError(pubBytes)) return pubBytes;

      const fp = await computeFingerprint(keyPair.value.publicKey);
      if (Result.isError(fp)) return fp;

      const storeResult = await storeKeyMaterial(
        identityId,
        keyPair.value.privateKey,
      );
      if (Result.isError(storeResult)) return storeResult;

      const keyId = crypto.randomUUID();
      const now = new Date().toISOString();

      const opKey: OperationalKey = {
        keyId,
        identityId,
        groupId,
        publicKey: toHex(pubBytes.value),
        fingerprint: fp.value,
        createdAt: now,
        rotatedAt: null,
      };

      keys.set(identityId, opKey);
      if (groupId !== null) {
        groupIndex.set(groupId, identityId);
      }

      return Result.ok(opKey);
    },

    get(identityId: string): Result<OperationalKey, NotFoundError> {
      const key = keys.get(identityId);
      if (!key) {
        return Result.err(NotFoundError.create("OperationalKey", identityId));
      }
      return Result.ok(key);
    },

    getByGroupId(groupId: string): Result<OperationalKey, NotFoundError> {
      const identityId = groupIndex.get(groupId);
      if (!identityId) {
        return Result.err(NotFoundError.create("OperationalKey", groupId));
      }
      const key = keys.get(identityId);
      if (!key) {
        return Result.err(NotFoundError.create("OperationalKey", groupId));
      }
      return Result.ok(key);
    },

    async rotate(
      identityId: string,
    ): Promise<Result<OperationalKey, InternalError | NotFoundError>> {
      const existing = keys.get(identityId);
      if (!existing) {
        return Result.err(NotFoundError.create("OperationalKey", identityId));
      }

      const keyPair = await generateEd25519KeyPair();
      if (Result.isError(keyPair)) return keyPair;

      const pubBytes = await exportPublicKey(keyPair.value.publicKey);
      if (Result.isError(pubBytes)) return pubBytes;

      const fp = await computeFingerprint(keyPair.value.publicKey);
      if (Result.isError(fp)) return fp;

      const storeResult = await storeKeyMaterial(
        identityId,
        keyPair.value.privateKey,
      );
      if (Result.isError(storeResult)) return storeResult;

      const rotated: OperationalKey = {
        ...existing,
        keyId: crypto.randomUUID(),
        publicKey: toHex(pubBytes.value),
        fingerprint: fp.value,
        rotatedAt: new Date().toISOString(),
      };

      keys.set(identityId, rotated);
      return Result.ok(rotated);
    },

    list(): readonly OperationalKey[] {
      return [...keys.values()];
    },

    async sign(
      identityId: string,
      data: Uint8Array,
    ): Promise<Result<Uint8Array, InternalError | NotFoundError>> {
      return loadAndSign(identityId, data);
    },
  };
}
