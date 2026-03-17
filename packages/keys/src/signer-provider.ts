import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import type { SignerProvider } from "@xmtp/signet-contracts";
import type { KeyManager } from "./key-manager.js";

/**
 * Create a SignerProvider backed by a KeyManager for a specific identity.
 * The provider signs with the identity's operational key and retrieves
 * a vault-backed random DB encryption key.
 */
export function createSignerProvider(
  manager: KeyManager,
  identityId: string,
): SignerProvider {
  return {
    async sign(data: Uint8Array): Promise<Result<Uint8Array, SignetError>> {
      return manager.signWithOperationalKey(identityId, data);
    },

    async getPublicKey(): Promise<Result<Uint8Array, SignetError>> {
      const opKey = manager.getOperationalKey(identityId);
      if (Result.isError(opKey)) return opKey;

      // Convert hex public key back to bytes
      const hex = opKey.value.publicKey;
      const bytes = hexToBytes(hex);
      return Result.ok(bytes);
    },

    async getFingerprint(): Promise<Result<string, SignetError>> {
      const opKey = manager.getOperationalKey(identityId);
      if (Result.isError(opKey)) return opKey;
      return Result.ok(opKey.value.fingerprint);
    },

    async getDbEncryptionKey(): Promise<Result<Uint8Array, SignetError>> {
      return manager.getOrCreateDbKey(identityId);
    },

    async getXmtpIdentityKey(): Promise<Result<`0x${string}`, SignetError>> {
      return manager.getOrCreateXmtpIdentityKey(identityId);
    },
  };
}

function hexToBytes(hex: string): Uint8Array {
  const length = hex.length / 2;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
