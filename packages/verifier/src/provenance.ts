import type {
  ProvenanceMapType,
  ClaimProvenanceRecordType,
} from "@xmtp/signet-schemas";
import type { VerificationStatement } from "./schemas/statement.js";

/**
 * Maps verifier check IDs to the provenance fields they can attest.
 *
 * When a check passes, the fields it covers are marked as `verified`
 * in the provenance map. Checks that validate the seal's own structure
 * (seal_signature, seal_chain, schema_compliance) don't map to
 * provenance fields — those are derived claims, not disclosure claims.
 */
const CHECK_TO_PROVENANCE_FIELDS: Record<string, readonly string[]> = {
  build_provenance: ["buildProvenance"],
  source_available: ["sourceRepo"],
  release_signing: ["releaseSigning"],
};

/**
 * Derives a provenance map from a verification statement.
 *
 * For each passing check that maps to provenance fields, a `verified`
 * record is created with the verifier's identity and the statement's
 * issuedAt timestamp. The `trustTier` field is always included when
 * the statement's verifiedTier is above `unverified`.
 *
 * This function is intended to be called by the signet after receiving
 * a verification statement, so the resulting map can be included in
 * the next seal published to the group.
 */
export function deriveProvenanceMap(
  statement: VerificationStatement,
): ProvenanceMapType {
  const map: ProvenanceMapType = {};

  const verifiedRecord: ClaimProvenanceRecordType = {
    source: "verified",
    attestedBy: statement.verifierInboxId,
    attestedAt: statement.issuedAt,
    expiresAt: statement.expiresAt,
  };

  // Map passing checks to provenance fields
  for (const check of statement.checks) {
    if (check.verdict !== "pass") continue;

    const fields = CHECK_TO_PROVENANCE_FIELDS[check.checkId];
    if (fields === undefined) continue;

    for (const field of fields) {
      map[field] = { ...verifiedRecord };
    }
  }

  // Trust tier is verified when above unverified
  if (statement.verifiedTier !== "unverified") {
    map["trustTier"] = { ...verifiedRecord };
  }

  return map;
}
