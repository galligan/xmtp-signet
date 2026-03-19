import { Result } from "better-result";
import type { InternalError } from "@xmtp/signet-schemas";
import type { VerificationCheck } from "../schemas/check.js";
import type { VerificationRequest } from "../schemas/request.js";
import type { CheckHandler } from "./handler.js";

/** Check ID for seal signature verification. */
export const SEAL_SIGNATURE_CHECK_ID = "seal_signature" as const;

/**
 * Verifies the seal's structural integrity and signing metadata.
 *
 * Current checks:
 * - Seal has an issuer field
 * - Seal's agentInboxId matches the request
 * - Seal has valid timestamps (issuedAt, expiresAt ordering)
 * - Seal has required hosting and view/grant metadata
 *
 * Full Ed25519 signature verification requires the SealEnvelope
 * (which includes the signature bytes) and the signer's public key
 * via XMTP identity lookup. Both are deferred — the verification
 * request currently only carries the Seal payload, not the envelope.
 *
 * TODO: Extend VerificationRequest to include envelope + signerKeyRef,
 * then verify signature against the canonical seal bytes.
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

      // Check issuer present
      if (!seal.issuer || seal.issuer.length === 0) {
        failures.push("Missing issuer field");
      }

      // Check agentInboxId matches
      if (seal.agentInboxId !== request.agentInboxId) {
        failures.push(
          `agentInboxId mismatch: seal=${seal.agentInboxId}, request=${request.agentInboxId}`,
        );
      }

      // Check timestamps are valid — use round-trip check because JS Date
      // silently normalizes impossible dates (e.g. Feb 30 → Mar 2)
      if (seal.issuedAt) {
        const issued = new Date(seal.issuedAt);
        if (isNaN(issued.getTime()) || issued.toISOString() !== seal.issuedAt) {
          failures.push("Invalid or non-canonical issuedAt timestamp");
        }
        if (seal.expiresAt) {
          const expires = new Date(seal.expiresAt);
          if (
            isNaN(expires.getTime()) ||
            expires.toISOString() !== seal.expiresAt
          ) {
            failures.push("Invalid or non-canonical expiresAt timestamp");
          } else if (expires.getTime() <= issued.getTime()) {
            failures.push("expiresAt must be after issuedAt");
          }
        }
      }

      // Check hosting mode present
      if (!seal.hostingMode) {
        failures.push("Missing hostingMode");
      }

      if (failures.length > 0) {
        return Result.ok({
          checkId: SEAL_SIGNATURE_CHECK_ID,
          verdict: "fail",
          reason: `Seal structural validation failed: ${failures.join("; ")}`,
          evidence: {
            failures,
            signerKeyRef: seal.issuer ?? null,
            signatureVerified: false,
          },
        });
      }

      // Structural checks pass — signature verification requires the
      // SealEnvelope and signer public key (not yet in VerificationRequest)
      return Result.ok({
        checkId: SEAL_SIGNATURE_CHECK_ID,
        verdict: "skip",
        reason:
          "Seal structural validation passed; Ed25519 signature verification requires envelope and key lookup (not yet implemented)",
        evidence: {
          signerKeyRef: seal.issuer,
          issuer: seal.issuer,
          agentInboxId: seal.agentInboxId,
          signatureVerified: null,
        },
      });
    },
  };
}
