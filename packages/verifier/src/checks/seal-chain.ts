import { Result } from "better-result";
import type { InternalError } from "@xmtp/signet-schemas";
import type { VerificationCheck } from "../schemas/check.js";
import type { VerificationRequest } from "../schemas/request.js";
import type { CheckHandler } from "./handler.js";

/** Check ID for seal chain verification. */
export const SEAL_CHAIN_CHECK_ID = "seal_chain" as const;

/**
 * Verifies the seal links to the correct previous seal.
 * v0: structural check only -- verifies previousSealId is either
 * null (initial) or a well-formed string. Full chain walk is deferred.
 */
export function createSealChainCheck(): CheckHandler {
  return {
    checkId: SEAL_CHAIN_CHECK_ID,

    async execute(
      request: VerificationRequest,
    ): Promise<Result<VerificationCheck, InternalError>> {
      if (request.seal === null) {
        return Result.ok({
          checkId: SEAL_CHAIN_CHECK_ID,
          verdict: "skip",
          reason: "No seal provided",
          evidence: null,
        });
      }

      const { previousSealId, sealId } = request.seal;

      // Check sealId is present and non-empty
      if (!sealId || sealId.length === 0) {
        return Result.ok({
          checkId: SEAL_CHAIN_CHECK_ID,
          verdict: "fail",
          reason: "Seal missing sealId",
          evidence: {
            chainLength: 0,
            previousId: previousSealId,
            chainValid: false,
          },
        });
      }

      // previousSealId should be null for initial or a non-empty string
      if (
        previousSealId !== null &&
        (typeof previousSealId !== "string" || previousSealId.length === 0)
      ) {
        return Result.ok({
          checkId: SEAL_CHAIN_CHECK_ID,
          verdict: "fail",
          reason: "previousSealId must be null or a non-empty string",
          evidence: {
            chainLength: 0,
            previousId: previousSealId,
            chainValid: false,
          },
        });
      }

      // Self-referencing chain is invalid
      if (previousSealId === sealId) {
        return Result.ok({
          checkId: SEAL_CHAIN_CHECK_ID,
          verdict: "fail",
          reason: "Seal references itself as previous",
          evidence: {
            chainLength: 0,
            previousId: previousSealId,
            chainValid: false,
          },
        });
      }

      return Result.ok({
        checkId: SEAL_CHAIN_CHECK_ID,
        verdict: "pass",
        reason:
          previousSealId === null
            ? "Initial seal (no previous)"
            : "Chain link structurally valid (v0: full chain walk deferred)",
        evidence: {
          chainLength: previousSealId === null ? 1 : 2,
          previousId: previousSealId,
          chainValid: true,
        },
      });
    },
  };
}
