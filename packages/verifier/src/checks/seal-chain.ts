import { Result } from "better-result";
import type { InternalError } from "@xmtp/signet-schemas";
import { validateSealChain, verifyChainDelta } from "@xmtp/signet-seals";
import type { VerificationCheck } from "../schemas/check.js";
import type { VerificationRequest } from "../schemas/request.js";
import { canonicalize, bytesEqual } from "../canonicalize.js";
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
 * When the full envelope is present on the request, the check validates the
 * inline chain structure and stored delta locally. Without the envelope, it
 * degrades gracefully to a skip verdict after structural payload checks.
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

      if (request.sealEnvelope == null) {
        return Result.ok({
          checkId: SEAL_CHAIN_CHECK_ID,
          verdict: "skip",
          reason:
            "Seal payload structurally valid; full chain validation requires the local envelope",
          evidence: {
            sealId: seal.sealId,
            chainWalked: false,
            chainValid: true,
          },
        });
      }

      if (request.sealEnvelope.chain.current.sealId !== seal.sealId) {
        return Result.ok({
          checkId: SEAL_CHAIN_CHECK_ID,
          verdict: "fail",
          reason: "Seal envelope does not match the requested seal payload",
          evidence: {
            expectedSealId: seal.sealId,
            envelopeSealId: request.sealEnvelope.chain.current.sealId,
            chainValid: false,
            chainWalked: false,
          },
        });
      }

      // Verify claimed seal payload matches the signed envelope content
      const sealBytes = canonicalize(seal);
      const envelopeBytes = canonicalize(request.sealEnvelope.chain.current);
      if (!bytesEqual(sealBytes, envelopeBytes)) {
        return Result.ok({
          checkId: SEAL_CHAIN_CHECK_ID,
          verdict: "fail",
          reason: "Seal payload does not match signed envelope content",
          evidence: {
            sealId: seal.sealId,
            chainValid: false,
            chainWalked: false,
          },
        });
      }

      const structure = validateSealChain(request.sealEnvelope.chain);
      if (Result.isError(structure)) {
        return Result.ok({
          checkId: SEAL_CHAIN_CHECK_ID,
          verdict: "fail",
          reason: structure.error.message,
          evidence: {
            sealId: seal.sealId,
            chainValid: false,
            chainWalked: request.sealEnvelope.chain.previous !== undefined,
          },
        });
      }

      const delta = verifyChainDelta(request.sealEnvelope.chain);
      if (Result.isError(delta)) {
        return Result.ok({
          checkId: SEAL_CHAIN_CHECK_ID,
          verdict: "fail",
          reason: delta.error.message,
          evidence: {
            sealId: seal.sealId,
            chainValid: false,
            chainWalked: request.sealEnvelope.chain.previous !== undefined,
          },
        });
      }

      return Result.ok({
        checkId: SEAL_CHAIN_CHECK_ID,
        verdict: "pass",
        reason: "Seal chain and stored delta validated locally",
        evidence: {
          sealId: seal.sealId,
          chainWalked: request.sealEnvelope.chain.previous !== undefined,
          chainValid: true,
        },
      });
    },
  };
}
