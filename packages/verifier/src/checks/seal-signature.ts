import { Result } from "better-result";
import type { InternalError } from "@xmtp/signet-schemas";
import { InternalError as InternalErrorClass } from "@xmtp/signet-schemas";
import { canonicalize, bytesEqual } from "../canonicalize.js";
import type { VerificationCheck } from "../schemas/check.js";
import type { VerificationRequest } from "../schemas/request.js";
import type { CheckHandler } from "./handler.js";

/** Check ID for seal signature verification. */
export const SEAL_SIGNATURE_CHECK_ID = "seal_signature" as const;

/**
 * Verifies the seal's structural integrity and consistency with the request.
 *
 * Current checks (v1):
 * - Seal has a valid issuedAt timestamp
 * - Seal's operatorId is non-empty
 * - Seal has required fields (scopeMode, permissions)
 *
 * When the full envelope and signer's public key are present on the request,
 * the check performs a local Ed25519 verification against the canonical seal
 * payload bytes. Otherwise it degrades gracefully to a skip verdict.
 */
export function createSealSignatureCheck(): CheckHandler {
  return {
    checkId: SEAL_SIGNATURE_CHECK_ID,

    async execute(
      request: VerificationRequest,
    ): Promise<Result<VerificationCheck, InternalError>> {
      if (request.seal === null) {
        return Result.ok({
          checkId: SEAL_SIGNATURE_CHECK_ID,
          verdict: "skip",
          reason: "No seal provided",
          evidence: null,
        });
      }

      const seal = request.seal;
      const failures: string[] = [];

      // Check operatorId present
      if (!seal.operatorId || seal.operatorId.length === 0) {
        failures.push("Missing operatorId field");
      }

      // Check timestamps are valid -- use round-trip check because JS Date
      // silently normalizes impossible dates (e.g. Feb 30 -> Mar 2)
      if (seal.issuedAt) {
        const issued = new Date(seal.issuedAt);
        if (isNaN(issued.getTime()) || issued.toISOString() !== seal.issuedAt) {
          failures.push("Invalid or non-canonical issuedAt timestamp");
        }
      } else {
        failures.push("Missing issuedAt timestamp");
      }

      // Check scopeMode present
      if (!seal.scopeMode) {
        failures.push("Missing scopeMode");
      }

      if (failures.length > 0) {
        return Result.ok({
          checkId: SEAL_SIGNATURE_CHECK_ID,
          verdict: "fail",
          reason: `Seal structural validation failed: ${failures.join("; ")}`,
          evidence: {
            failures,
            signatureVerified: false,
          },
        });
      }

      if (request.sealEnvelope == null || request.sealPublicKey == null) {
        return Result.ok({
          checkId: SEAL_SIGNATURE_CHECK_ID,
          verdict: "skip",
          reason:
            "Seal structural validation passed; signature verification requires a local envelope and signer public key",
          evidence: {
            operatorId: seal.operatorId,
            signatureVerified: null,
          },
        });
      }

      if (request.sealEnvelope.chain.current.sealId !== seal.sealId) {
        return Result.ok({
          checkId: SEAL_SIGNATURE_CHECK_ID,
          verdict: "fail",
          reason: "Seal envelope does not match the requested seal payload",
          evidence: {
            expectedSealId: seal.sealId,
            envelopeSealId: request.sealEnvelope.chain.current.sealId,
            signatureVerified: false,
          },
        });
      }

      // Verify claimed seal payload matches the signed envelope content
      const sealBytes = canonicalize(seal);
      const envelopeBytes = canonicalize(request.sealEnvelope.chain.current);
      if (!bytesEqual(sealBytes, envelopeBytes)) {
        return Result.ok({
          checkId: SEAL_SIGNATURE_CHECK_ID,
          verdict: "fail",
          reason: "Seal payload does not match signed envelope content",
          evidence: {
            sealId: seal.sealId,
            signatureVerified: false,
          },
        });
      }

      const importResult = await importEd25519PublicKey(request.sealPublicKey);
      if (Result.isError(importResult)) {
        return importResult;
      }

      const signatureBytes = decodeBase64(request.sealEnvelope.signature);
      if (Result.isError(signatureBytes)) {
        return signatureBytes;
      }

      const verified = await verifyEd25519Signature(
        importResult.value,
        canonicalize(request.sealEnvelope.chain.current),
        signatureBytes.value,
      );
      if (Result.isError(verified)) {
        return verified;
      }

      if (!verified.value) {
        return Result.ok({
          checkId: SEAL_SIGNATURE_CHECK_ID,
          verdict: "fail",
          reason: "Seal signature verification failed",
          evidence: {
            keyId: request.sealEnvelope.keyId,
            signatureVerified: false,
          },
        });
      }

      return Result.ok({
        checkId: SEAL_SIGNATURE_CHECK_ID,
        verdict: "pass",
        reason: "Seal signature verified against the local signer public key",
        evidence: {
          keyId: request.sealEnvelope.keyId,
          signatureVerified: true,
        },
      });
    },
  };
}

async function importEd25519PublicKey(
  publicKeyHex: string,
): Promise<Result<CryptoKey, InternalError>> {
  try {
    const publicKey = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(hexToBytes(publicKeyHex)),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return Result.ok(publicKey);
  } catch (error) {
    return Result.err(
      InternalErrorClass.create("Failed to import Ed25519 public key", {
        cause: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

async function verifyEd25519Signature(
  publicKey: CryptoKey,
  data: Uint8Array,
  signature: Uint8Array,
): Promise<Result<boolean, InternalError>> {
  try {
    const valid = await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      toArrayBuffer(signature),
      toArrayBuffer(data),
    );
    return Result.ok(valid);
  } catch (error) {
    return Result.err(
      InternalErrorClass.create("Ed25519 verification failed", {
        cause: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function decodeBase64(value: string): Result<Uint8Array, InternalError> {
  try {
    return Result.ok(Uint8Array.from(Buffer.from(value, "base64")));
  } catch (error) {
    return Result.err(
      InternalErrorClass.create("Failed to decode base64 signature", {
        cause: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.toLowerCase();
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return bytes;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
}
