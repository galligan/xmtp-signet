import { Result } from "better-result";
import { type ContentTypeId, ValidationError } from "@xmtp/signet-schemas";
import type { SignetContentTypeConfig } from "./types.js";

/**
 * Computes the effective allowlist as the intersection of
 * baseline, signet-level, and agent view-level allowlists.
 *
 * effectiveAllowlist = baseline intersection signet intersection credential
 *
 * Returns ValidationError if the intersection is empty.
 */
export function resolveEffectiveAllowlist(
  baseline: readonly ContentTypeId[],
  signetConfig: SignetContentTypeConfig,
  agentAllowlist: readonly ContentTypeId[],
): Result<ReadonlySet<ContentTypeId>, ValidationError> {
  const baselineSet = new Set(baseline);
  const effective = new Set<ContentTypeId>();

  for (const ct of agentAllowlist) {
    if (baselineSet.has(ct) && signetConfig.allowlist.has(ct)) {
      effective.add(ct);
    }
  }

  if (effective.size === 0) {
    return Result.err(
      ValidationError.create(
        "contentTypes",
        "Effective content type allowlist is empty: no types are permitted across baseline, signet, and agent allowlists",
      ),
    );
  }

  return Result.ok(effective);
}
