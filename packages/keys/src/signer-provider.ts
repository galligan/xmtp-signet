import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import type { SignerProvider } from "@xmtp/signet-contracts";
import type { KeyBackend } from "./key-backend.js";

/**
 * Create a SignerProvider backed by a KeyBackend for a specific wallet
 * and account.
 *
 * The provider signs with the account's derived key and returns the
 * account's public key material.
 *
 * @param backend - Key backend for signing and key derivation
 * @param walletId - Wallet containing the signing key
 * @param accountIndex - BIP-44 account index within the wallet
 */
export function createSignerProvider(
  backend: KeyBackend,
  walletId: string,
  accountIndex: number,
): SignerProvider {
  return {
    async sign(data: Uint8Array): Promise<Result<Uint8Array, SignetError>> {
      const result = await backend.sign(walletId, accountIndex, data);
      if (Result.isError(result)) return result;
      return Result.ok(result.value.signature);
    },

    async getPublicKey(): Promise<Result<Uint8Array, SignetError>> {
      const result = await backend.sign(
        walletId,
        accountIndex,
        new Uint8Array(0),
      );
      if (Result.isError(result)) return result;
      return Result.ok(result.value.publicKey);
    },

    async getFingerprint(): Promise<Result<string, SignetError>> {
      const result = await backend.sign(
        walletId,
        accountIndex,
        new Uint8Array(0),
      );
      if (Result.isError(result)) return result;
      const hex = Buffer.from(result.value.publicKey).toString("hex");
      return Result.ok(hex);
    },

    async getDbEncryptionKey(): Promise<Result<Uint8Array, SignetError>> {
      // Derive a deterministic 32-byte key from account public key
      const result = await backend.sign(
        walletId,
        accountIndex,
        new Uint8Array(0),
      );
      if (Result.isError(result)) return result;
      // Use a hash of the public key as a stable DB encryption key
      const { sha256 } = await import("@noble/hashes/sha256");
      const hash = sha256(result.value.publicKey);
      return Result.ok(hash);
    },

    async getXmtpIdentityKey(): Promise<Result<`0x${string}`, SignetError>> {
      const identityKey = await backend.getXmtpIdentityKey(
        walletId,
        accountIndex,
      );
      if (Result.isError(identityKey)) {
        return identityKey;
      }
      return Result.ok(identityKey.value);
    },
  };
}
