/**
 * Produces the canonical byte representation of a value for signing.
 *
 * Uses deterministic JSON serialization (sorted keys, no whitespace)
 * encoded as UTF-8. This ensures the same value always produces the
 * same bytes regardless of field insertion order.
 */
export function canonicalize(value: unknown): Uint8Array {
  const json = JSON.stringify(sortKeys(value));
  return new TextEncoder().encode(json);
}

/** Recursively sorts object keys for deterministic serialization. */
function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(value as Record<string, unknown>).sort();
  for (const key of keys) {
    sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}
