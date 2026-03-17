import { Result } from "better-result";
import type { InternalError } from "@xmtp/signet-schemas";
import type { VerificationCheck } from "../schemas/check.js";
import type { VerificationRequest } from "../schemas/request.js";
import type { CheckHandler } from "./handler.js";

export const BUILD_PROVENANCE_CHECK_ID = "build_provenance" as const;

/**
 * Verifies the agent was built from the claimed source.
 * v0: stub that returns "skip" when no bundle is provided,
 * or a basic structural validation when one is.
 */
export function createBuildProvenanceCheck(): CheckHandler {
  return {
    checkId: BUILD_PROVENANCE_CHECK_ID,

    async execute(
      request: VerificationRequest,
    ): Promise<Result<VerificationCheck, InternalError>> {
      if (request.buildProvenanceBundle === null) {
        return Result.ok({
          checkId: BUILD_PROVENANCE_CHECK_ID,
          verdict: "skip",
          reason: "No build provenance bundle provided",
          evidence: null,
        });
      }

      // v0 stub: attempt basic JSON parse but don't do full verification
      try {
        const decoded = atob(request.buildProvenanceBundle);
        JSON.parse(decoded);

        return Result.ok({
          checkId: BUILD_PROVENANCE_CHECK_ID,
          verdict: "fail",
          reason: "Build provenance verification not yet implemented (v0 stub)",
          evidence: {
            bundlePresent: true,
            artifactDigest: request.artifactDigest,
          },
        });
      } catch {
        return Result.ok({
          checkId: BUILD_PROVENANCE_CHECK_ID,
          verdict: "fail",
          reason: "Build provenance bundle is not valid base64-encoded JSON",
          evidence: {
            bundlePresent: true,
            artifactDigest: request.artifactDigest,
          },
        });
      }
    },
  };
}
