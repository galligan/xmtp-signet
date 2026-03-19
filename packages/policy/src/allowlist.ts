import { Result } from "better-result";
import {
  type ContentTypeId,
  type ViewMode,
  ValidationError,
} from "@xmtp/signet-schemas";
import type { SignetContentTypeConfig } from "./types.js";

/**
 * Validates that a view mode is supported in the current version.
 * Removed modes are rejected by the schema before reaching policy code.
 */
export function validateViewMode(
  _mode: ViewMode,
): Result<void, ValidationError> {
  return Result.ok(undefined);
}

/**
 * Computes the effective allowlist as the intersection of
 * baseline, signet-level, and agent view-level allowlists.
 *
 * effectiveAllowlist = baseline ∩ signet ∩ agent
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
