import type { CheckVerdict } from "./schemas/check.js";
import type { VerificationVerdict } from "./schemas/statement.js";
import type { TrustTier } from "@xmtp/signet-schemas";

/**
 * Determines the overall verification verdict from individual check results.
 *
 * - verified: all applicable checks pass
 * - partial: some checks pass, some skip, none fail
 * - rejected: any check fails
 */
export function determineVerdict(
  verdicts: readonly CheckVerdict[],
): VerificationVerdict {
  const hasFail = verdicts.some((v) => v === "fail");
  if (hasFail) {
    return "rejected";
  }

  const hasSkip = verdicts.some((v) => v === "skip");
  if (hasSkip) {
    return "partial";
  }

  return "verified";
}

/**
 * Determines the highest verified trust tier based on check results.
 * For v0, the maximum achievable tier is "source-verified".
 * Returns "unverified" if any required check fails.
 */
export function determineVerifiedTier(
  verdict: VerificationVerdict,
  requestedTier: TrustTier,
): TrustTier {
  if (verdict === "rejected") {
    return "unverified";
  }

  // v0 caps at source-verified regardless of what was requested
  const tierRank: Record<TrustTier, number> = {
    unverified: 0,
    "source-verified": 1,
    "reproducibly-verified": 2,
    "runtime-attested": 3,
  };

  const requestedRank = tierRank[requestedTier];
  const maxV0Rank = tierRank["source-verified"];
  const effectiveRank = Math.min(requestedRank, maxV0Rank);

  // source-verified requires all applicable checks to pass
  if (verdict === "verified") {
    if (effectiveRank >= tierRank["source-verified"]) {
      return "source-verified";
    }
  }

  return "unverified";
}
