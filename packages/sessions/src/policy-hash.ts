/**
 * Deterministic policy hashing for session deduplication.
 *
 * Computes a hash from the canonical JSON representation of a
 * view + grant configuration. Two sessions with the same policy
 * hash have identical effective policies.
 */

import type { ViewConfig, GrantConfig } from "@xmtp/signet-schemas";

/** Compute a deterministic hash of the view + grant policy. */
export function computePolicyHash(
  view: ViewConfig,
  grant: GrantConfig,
): string {
  const canonical = canonicalize({ view, grant });
  // Bun.hash returns a bigint; convert to hex string
  return Bun.hash(canonical).toString(16);
}

/** Produce a canonical JSON string with sorted keys at all levels. */
function canonicalize(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    const normalizedItems = value.map((item) => normalize(item));
    return normalizedItems.sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  }

  if (isRecord(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = normalize(value[key]);
    }
    return sorted;
  }

  return value;
}
