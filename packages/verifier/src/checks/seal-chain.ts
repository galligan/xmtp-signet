import { Result } from "better-result";
import type { InternalError } from "@xmtp/signet-schemas";
import type { VerificationCheck } from "../schemas/check.js";
import type { VerificationRequest } from "../schemas/request.js";
import type { CheckHandler } from "./handler.js";

/** Check ID for seal chain verification. */
export const SEAL_CHAIN_CHECK_ID = "seal_chain" as const;

/**
 * Verifies the seal payload's structural integrity for chain validation.
 *
 * Current checks (v1):
 * - sealId is present and non-empty
 * - chatId is present and non-empty
 * - operatorId is present and non-empty
 * - credentialId is present and non-empty
 *
 * Full chain walk (verifying the SealChain with previous seal references)
 * requires the SealEnvelope and a seal store, which is not yet available
 * to the verifier. The check returns skip for the chain continuity portion.
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

      // chatId must be non-empty (replaces v0 groupId)
      if (!seal.chatId || seal.chatId.length === 0) {
        failures.push("Missing chatId");
      }

      // operatorId must be non-empty (replaces v0 agentInboxId)
      if (!seal.operatorId || seal.operatorId.length === 0) {
        failures.push("Missing operatorId");
      }

      // credentialId must be non-empty
      if (!seal.credentialId || seal.credentialId.length === 0) {
        failures.push("Missing credentialId");
      }

      if (failures.length > 0) {
        return Result.ok({
          checkId: SEAL_CHAIN_CHECK_ID,
          verdict: "fail",
          reason: `Seal chain validation failed: ${failures.join("; ")}`,
          evidence: {
            failures,
            sealId: seal.sealId,
            chainValid: false,
            chainWalked: false,
          },
        });
      }

      // Structural checks pass -- full chain walk requires the SealEnvelope
      // and a seal store (not yet available to the verifier)
      return Result.ok({
        checkId: SEAL_CHAIN_CHECK_ID,
        verdict: "skip",
        reason:
          "Seal payload structurally valid; full chain walk requires SealEnvelope and seal store (not yet available)",
        evidence: {
          sealId: seal.sealId,
          chainWalked: false,
          chainValid: true,
        },
      });
    },
  };
}
