import { Result } from "better-result";
import type { InternalError } from "@xmtp-broker/schemas";
import type { VerificationCheck } from "../schemas/check.js";
import type { VerificationRequest } from "../schemas/request.js";
import type { CheckHandler } from "./handler.js";

export const RELEASE_SIGNING_CHECK_ID = "release_signing" as const;

/**
 * Verifies the release artifact is signed.
 * v0: stub that returns "skip" since full GitHub API
 * attestation verification is deferred.
 */
export function createReleaseSigningCheck(): CheckHandler {
  return {
    checkId: RELEASE_SIGNING_CHECK_ID,

    async execute(
      request: VerificationRequest,
    ): Promise<Result<VerificationCheck, InternalError>> {
      if (request.releaseTag === null) {
        return Result.ok({
          checkId: RELEASE_SIGNING_CHECK_ID,
          verdict: "skip",
          reason: "No release tag provided",
          evidence: null,
        });
      }

      // v0 stub: acknowledge the tag but skip verification
      return Result.ok({
        checkId: RELEASE_SIGNING_CHECK_ID,
        verdict: "skip",
        reason: "Release signing verification not yet implemented (v0 stub)",
        evidence: {
          releaseTag: request.releaseTag,
          sourceRepoUrl: request.sourceRepoUrl,
        },
      });
    },
  };
}
