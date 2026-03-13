import { Result } from "better-result";
import { InternalError, NotFoundError } from "@xmtp-broker/schemas";
import type { SessionKey } from "./types.js";
import {
  generateEd25519KeyPair,
  signEd25519,
  fingerprint as computeFingerprint,
} from "./crypto-keys.js";

/**
 * Internal record with key material (never exposed).
 * Note: CryptoKey objects cannot be zeroized via the Web Crypto API.
 * The private key material remains in memory until garbage-collected.
 * This is a known limitation of the Web Crypto specification.
 */
interface SessionKeyEntry {
  readonly meta: SessionKey;
  readonly privateKey: CryptoKey;
}

export interface SessionKeyManager {
  issue(
    sessionId: string,
    ttlSeconds: number,
  ): Promise<Result<SessionKey, InternalError>>;

  sign(
    keyId: string,
    data: Uint8Array,
  ): Promise<Result<Uint8Array, InternalError | NotFoundError>>;

  revoke(keyId: string): Result<void, NotFoundError>;
}

export function createSessionKeyManager(): SessionKeyManager {
  const entries = new Map<string, SessionKeyEntry>();

  return {
    async issue(
      sessionId: string,
      ttlSeconds: number,
    ): Promise<Result<SessionKey, InternalError>> {
      const keyPair = await generateEd25519KeyPair();
      if (Result.isError(keyPair)) return keyPair;

      const fp = await computeFingerprint(keyPair.value.publicKey);
      if (Result.isError(fp)) return fp;

      const keyId = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

      const meta: SessionKey = {
        keyId,
        sessionId,
        fingerprint: fp.value,
        expiresAt: expiresAt.toISOString(),
        createdAt: now.toISOString(),
      };

      entries.set(keyId, {
        meta,
        privateKey: keyPair.value.privateKey,
      });

      return Result.ok(meta);
    },

    async sign(
      keyId: string,
      data: Uint8Array,
    ): Promise<Result<Uint8Array, InternalError | NotFoundError>> {
      const entry = entries.get(keyId);
      if (!entry) {
        return Result.err(NotFoundError.create("SessionKey", keyId));
      }

      // Enforce expiry: delete expired keys and reject signing
      if (new Date(entry.meta.expiresAt).getTime() <= Date.now()) {
        entries.delete(keyId);
        return Result.err(NotFoundError.create("SessionKey", keyId));
      }

      return signEd25519(entry.privateKey, data);
    },

    revoke(keyId: string): Result<void, NotFoundError> {
      if (!entries.has(keyId)) {
        return Result.err(NotFoundError.create("SessionKey", keyId));
      }
      entries.delete(keyId);
      return Result.ok();
    },
  };
}
