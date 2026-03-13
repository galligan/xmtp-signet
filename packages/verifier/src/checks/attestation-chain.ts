import { Result } from "better-result";
import type { InternalError } from "@xmtp-broker/schemas";
import type { VerificationCheck } from "../schemas/check.js";
import type { VerificationRequest } from "../schemas/request.js";
import type { CheckHandler } from "./handler.js";

export const ATTESTATION_CHAIN_CHECK_ID = "attestation_chain" as const;

/**
 * Verifies the attestation links to the correct previous attestation.
 * v0: structural check only -- verifies previousAttestationId is either
 * null (initial) or a well-formed string. Full chain walk is deferred.
 */
export function createAttestationChainCheck(): CheckHandler {
  return {
    checkId: ATTESTATION_CHAIN_CHECK_ID,

    async execute(
      request: VerificationRequest,
    ): Promise<Result<VerificationCheck, InternalError>> {
      if (request.attestation === null) {
        return Result.ok({
          checkId: ATTESTATION_CHAIN_CHECK_ID,
          verdict: "skip",
          reason: "No attestation provided",
          evidence: null,
        });
      }

      const { previousAttestationId, attestationId } = request.attestation;

      // Check attestationId is present and non-empty
      if (!attestationId || attestationId.length === 0) {
        return Result.ok({
          checkId: ATTESTATION_CHAIN_CHECK_ID,
          verdict: "fail",
          reason: "Attestation missing attestationId",
          evidence: {
            chainLength: 0,
            previousId: previousAttestationId,
            chainValid: false,
          },
        });
      }

      // previousAttestationId should be null for initial or a non-empty string
      if (
        previousAttestationId !== null &&
        (typeof previousAttestationId !== "string" ||
          previousAttestationId.length === 0)
      ) {
        return Result.ok({
          checkId: ATTESTATION_CHAIN_CHECK_ID,
          verdict: "fail",
          reason: "previousAttestationId must be null or a non-empty string",
          evidence: {
            chainLength: 0,
            previousId: previousAttestationId,
            chainValid: false,
          },
        });
      }

      // Self-referencing chain is invalid
      if (previousAttestationId === attestationId) {
        return Result.ok({
          checkId: ATTESTATION_CHAIN_CHECK_ID,
          verdict: "fail",
          reason: "Attestation references itself as previous",
          evidence: {
            chainLength: 0,
            previousId: previousAttestationId,
            chainValid: false,
          },
        });
      }

      return Result.ok({
        checkId: ATTESTATION_CHAIN_CHECK_ID,
        verdict: "pass",
        reason:
          previousAttestationId === null
            ? "Initial attestation (no previous)"
            : "Chain link structurally valid (v0: full chain walk deferred)",
        evidence: {
          chainLength: previousAttestationId === null ? 1 : 2,
          previousId: previousAttestationId,
          chainValid: true,
        },
      });
    },
  };
}
