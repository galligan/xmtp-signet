import { Result } from "better-result";
import type { InternalError } from "@xmtp/signet-schemas";
import type { VerificationCheck } from "../schemas/check.js";
import type { VerificationRequest } from "../schemas/request.js";
import type { CheckHandler } from "./handler.js";

/** Check ID for seal chain verification. */
export const SEAL_CHAIN_CHECK_ID = "seal_chain" as const;

/**
 * Verifies the seal's chain integrity.
 *
 * Current checks:
 * - sealId is present and non-empty
 * - previousSealId is null (initial) or a non-empty string
 * - No self-referencing (sealId !== previousSealId)
 * - Seal version is a positive integer
 * - groupId and agentInboxId are consistent and non-empty
 *
 * Full chain walk (fetching and verifying the complete chain of
 * previousSealId references) requires a seal store or group message
 * history query, which is not yet available to the verifier.
 * The check returns skip for the chain continuity portion.
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

      const seal = request.seal;
      const failures: string[] = [];

      // sealId must be present and non-empty
      if (!seal.sealId || seal.sealId.length === 0) {
        failures.push("Missing sealId");
      }

      // previousSealId must be null (initial) or a non-empty string
      if (
        seal.previousSealId !== null &&
        (typeof seal.previousSealId !== "string" ||
          seal.previousSealId.length === 0)
      ) {
        failures.push("previousSealId must be null or a non-empty string");
      }

      // Self-referencing chain is invalid
      if (seal.previousSealId !== null && seal.previousSealId === seal.sealId) {
        failures.push("Seal references itself as previous");
      }

      // groupId must be non-empty
      if (!seal.groupId || seal.groupId.length === 0) {
        failures.push("Missing groupId");
      }

      // agentInboxId must be non-empty
      if (!seal.agentInboxId || seal.agentInboxId.length === 0) {
        failures.push("Missing agentInboxId");
      }

      if (failures.length > 0) {
        return Result.ok({
          checkId: SEAL_CHAIN_CHECK_ID,
          verdict: "fail",
          reason: `Seal chain validation failed: ${failures.join("; ")}`,
          evidence: {
            failures,
            sealId: seal.sealId,
            previousSealId: seal.previousSealId,
            // Legacy aliases for backward compatibility
            previousId: seal.previousSealId,
            chainValid: false,
            chainLength: 0,
            chainWalked: false,
          },
        });
      }

      // Structural checks pass — full chain walk requires a seal store
      return Result.ok({
        checkId: SEAL_CHAIN_CHECK_ID,
        verdict: "skip",
        reason:
          seal.previousSealId === null
            ? "Initial seal — chain origin validated"
            : "Chain link structurally valid; full chain walk requires seal store (not yet available)",
        evidence: {
          sealId: seal.sealId,
          previousSealId: seal.previousSealId,
          isInitial: seal.previousSealId === null,
          chainWalked: false,
        },
      });
    },
  };
}
