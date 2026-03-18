import { Result } from "better-result";
import type { InternalError } from "@xmtp/signet-schemas";
import type { VerificationCheck } from "../schemas/check.js";
import type { VerificationRequest } from "../schemas/request.js";
import type { CheckHandler } from "./handler.js";

/** Check ID for seal signature verification. */
export const SEAL_SIGNATURE_CHECK_ID = "seal_signature" as const;

/**
 * Verifies the seal's cryptographic signature.
 * v0: structural check -- verifies the seal has all required
 * fields and that the issuer field is present. Full Ed25519 verification
 * against the agent's inbox key requires XMTP identity lookup, which
 * is deferred.
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

      // Structural check: verify required signing-related fields exist
      if (!seal.issuer || seal.issuer.length === 0) {
        return Result.ok({
          checkId: SEAL_SIGNATURE_CHECK_ID,
          verdict: "fail",
          reason: "Seal missing issuer field",
          evidence: {
            signerKeyRef: null,
            signatureValid: false,
          },
        });
      }

      // Check that the seal's agentInboxId matches the request.
      if (seal.agentInboxId !== request.agentInboxId) {
        return Result.ok({
          checkId: SEAL_SIGNATURE_CHECK_ID,
          verdict: "fail",
          reason: "Seal agentInboxId does not match request agentInboxId",
          evidence: {
            sealAgentInboxId: seal.agentInboxId,
            requestAgentInboxId: request.agentInboxId,
            signatureValid: false,
          },
        });
      }

      // v0: structural validation passes -- full signature verification
      // requires XMTP identity lookup
      return Result.ok({
        checkId: SEAL_SIGNATURE_CHECK_ID,
        verdict: "skip",
        reason: "v0: no cryptographic verification performed",
        evidence: {
          signerKeyRef: seal.issuer,
          signatureValid: null,
        },
      });
    },
  };
}
