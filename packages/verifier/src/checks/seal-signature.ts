import { Result } from "better-result";
import type { InternalError } from "@xmtp/signet-schemas";
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
 * Full Ed25519 signature verification requires the SealEnvelope
 * (which includes the signature bytes and keyId) and the signer's
 * public key. Both are deferred -- the verification request currently
 * only carries the SealPayload, not the envelope.
 *
 * TODO: Extend VerificationRequest to include envelope, then verify
 * signature against the canonical seal bytes.
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

      // Structural checks pass -- signature verification requires the
      // SealEnvelope and signer public key (not yet in VerificationRequest)
      return Result.ok({
        checkId: SEAL_SIGNATURE_CHECK_ID,
        verdict: "skip",
        reason:
          "Seal structural validation passed; Ed25519 signature verification requires envelope and key lookup (not yet implemented)",
        evidence: {
          operatorId: seal.operatorId,
          signatureVerified: null,
        },
      });
    },
  };
}
