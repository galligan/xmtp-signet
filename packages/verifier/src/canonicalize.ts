/**
 * Produces the canonical byte representation of a verification statement
 * for signing. Serializes with sorted keys and no whitespace as UTF-8.
 *
 * Accepts the statement fields without signature/signatureAlgorithm
 * (which are added after signing).
 */
export function canonicalizeStatement(
  statement: Omit<
    import("./schemas/statement.js").VerificationStatement,
    "signature" | "signatureAlgorithm"
  >,
): Uint8Array {
  return canonicalize(statement);
}

/** Deterministic JSON serialization as UTF-8 bytes. */
export function canonicalize(value: unknown): Uint8Array {
  const json = JSON.stringify(sortKeys(value));
  return new TextEncoder().encode(json);
}

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
