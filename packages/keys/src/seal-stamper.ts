import { Result } from "better-result";
import { sha256 } from "@noble/hashes/sha256";
import type {
  SealPayloadType,
  SealEnvelopeType,
  SignetError,
  RevocationSeal,
} from "@xmtp/signet-schemas";
import type {
  SealStamper,
  SignedRevocationEnvelope,
} from "@xmtp/signet-contracts";
import type { KeyBackend } from "./key-backend.js";

/**
 * Create a SealStamper backed by a KeyBackend.
 *
 * Signs seal and revocation payloads using the specified wallet
 * and account index (Ed25519).
 *
 * @param backend - Key backend for signing operations
 * @param walletId - Wallet containing the signing key
 * @param accountIndex - BIP-44 account index (Ed25519) within the wallet
 */
export function createSealStamper(
  backend: KeyBackend,
  walletId: string,
  accountIndex: number,
): SealStamper {
  return {
    async sign(
      payload: SealPayloadType,
    ): Promise<Result<SealEnvelopeType, SignetError>> {
      const canonical = canonicalize(payload);
      const sigResult = await backend.sign(walletId, accountIndex, canonical);
      if (Result.isError(sigResult)) return sigResult;

      const signed: SealEnvelopeType = {
        chain: {
          current: payload,
          delta: { added: [], removed: [], changed: [] },
        },
        signature: toBase64(sigResult.value.signature),
        keyId: toKeyId(sigResult.value.publicKey),
        algorithm: "Ed25519",
      };
      return Result.ok(signed);
    },

    async signRevocation(
      payload: RevocationSeal,
    ): Promise<Result<SignedRevocationEnvelope, SignetError>> {
      const canonical = canonicalize(payload);
      const sigResult = await backend.sign(walletId, accountIndex, canonical);
      if (Result.isError(sigResult)) return sigResult;

      const signed: SignedRevocationEnvelope = {
        revocation: payload,
        signature: toBase64(sigResult.value.signature),
        signatureAlgorithm: "Ed25519",
        signerKeyRef: toKeyId(sigResult.value.publicKey),
      };
      return Result.ok(signed);
    },
  };
}

/** Convert bytes to base64 string. */
function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** Convert bytes to lowercase hex string. */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Derive a stable signet key resource id from a signing public key. */
function toKeyId(publicKey: Uint8Array): string {
  return `key_${bytesToHex(sha256(publicKey).slice(0, 4))}`;
}

/** Deterministic JSON serialization with sorted keys, encoded as UTF-8. */
function canonicalize(value: unknown): Uint8Array {
  const json = JSON.stringify(sortKeys(value));
  return new TextEncoder().encode(json);
}

/** Recursively sort object keys for deterministic serialization. */
function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(value as Record<string, unknown>).sort();
  for (const key of keys) {
    sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}
