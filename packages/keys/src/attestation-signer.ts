import { Result } from "better-result";
import type {
  Attestation,
  BrokerError,
  RevocationAttestation,
} from "@xmtp-broker/schemas";
import type {
  AttestationSigner,
  SignedAttestation,
  SignedRevocationEnvelope,
} from "@xmtp-broker/contracts";
import type { KeyManager } from "./key-manager.js";

/**
 * Create an AttestationSigner backed by a KeyManager's operational key.
 * Signs attestation and revocation payloads with Ed25519.
 */
export function createAttestationSigner(
  manager: KeyManager,
  identityId: string,
): AttestationSigner {
  return {
    async sign(
      payload: Attestation,
    ): Promise<Result<SignedAttestation, BrokerError>> {
      const canonical = canonicalize(payload);
      const sig = await manager.signWithOperationalKey(identityId, canonical);
      if (Result.isError(sig)) return sig;

      const opKey = manager.getOperationalKey(identityId);
      if (Result.isError(opKey)) return opKey;

      const signed: SignedAttestation = {
        attestation: payload,
        signature: toBase64(sig.value),
        signatureAlgorithm: "Ed25519",
        signerKeyRef: opKey.value.fingerprint,
      };
      return Result.ok(signed);
    },

    async signRevocation(
      payload: RevocationAttestation,
    ): Promise<Result<SignedRevocationEnvelope, BrokerError>> {
      const canonical = canonicalize(payload);
      const sig = await manager.signWithOperationalKey(identityId, canonical);
      if (Result.isError(sig)) return sig;

      const opKey = manager.getOperationalKey(identityId);
      if (Result.isError(opKey)) return opKey;

      const signed: SignedRevocationEnvelope = {
        revocation: payload,
        signature: toBase64(sig.value),
        signatureAlgorithm: "Ed25519",
        signerKeyRef: opKey.value.fingerprint,
      };
      return Result.ok(signed);
    },
  };
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** Deterministic JSON serialization with sorted keys, encoded as UTF-8. */
function canonicalize(value: unknown): Uint8Array {
  const json = JSON.stringify(sortKeys(value));
  return new TextEncoder().encode(json);
}

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
