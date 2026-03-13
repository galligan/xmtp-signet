import { Result } from "better-result";
import type { InternalError } from "@xmtp-broker/schemas";
import type { VerificationCheck } from "../schemas/check.js";
import type { VerificationRequest } from "../schemas/request.js";
import type { CheckHandler } from "./handler.js";

export const ATTESTATION_SIGNATURE_CHECK_ID = "attestation_signature" as const;

/**
 * Verifies the attestation's cryptographic signature.
 * v0: structural check -- verifies the attestation has all required
 * fields and that the issuer field is present. Full Ed25519 verification
 * against the agent's inbox key requires XMTP identity lookup, which
 * is deferred.
 */
export function createAttestationSignatureCheck(): CheckHandler {
  return {
    checkId: ATTESTATION_SIGNATURE_CHECK_ID,

    async execute(
      request: VerificationRequest,
    ): Promise<Result<VerificationCheck, InternalError>> {
      if (request.attestation === null) {
        return Result.ok({
          checkId: ATTESTATION_SIGNATURE_CHECK_ID,
          verdict: "skip",
          reason: "No attestation provided",
          evidence: null,
        });
      }

      const attestation = request.attestation;

      // Structural check: verify required signing-related fields exist
      if (!attestation.issuer || attestation.issuer.length === 0) {
        return Result.ok({
          checkId: ATTESTATION_SIGNATURE_CHECK_ID,
          verdict: "fail",
          reason: "Attestation missing issuer field",
          evidence: {
            signerKeyRef: null,
            signatureValid: false,
          },
        });
      }

      // Check that the attestation's agentInboxId matches the request
      if (attestation.agentInboxId !== request.agentInboxId) {
        return Result.ok({
          checkId: ATTESTATION_SIGNATURE_CHECK_ID,
          verdict: "fail",
          reason:
            "Attestation agentInboxId does not match request agentInboxId",
          evidence: {
            attestationAgentInboxId: attestation.agentInboxId,
            requestAgentInboxId: request.agentInboxId,
            signatureValid: false,
          },
        });
      }

      // v0: structural validation passes -- full signature verification
      // requires XMTP identity lookup
      return Result.ok({
        checkId: ATTESTATION_SIGNATURE_CHECK_ID,
        verdict: "skip",
        reason: "v0: no cryptographic verification performed",
        evidence: {
          signerKeyRef: attestation.issuer,
          signatureValid: null,
        },
      });
    },
  };
}
