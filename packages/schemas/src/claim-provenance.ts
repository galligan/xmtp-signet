import { z } from "zod";

// -- Types (declared first for isolatedDeclarations) -----------------------

/**
 * How a seal claim's value was established.
 *
 * - `verified`: cryptographically proven or computed by the signet itself.
 *   No external trust required — math or the signet runtime guarantees it.
 * - `observed`: independently inspected by a signed, trusted component
 *   (e.g., a harness inspector plugin). Not self-reported, but not
 *   cryptographically proven either.
 * - `declared`: stated by the operator. The signet passes it through
 *   transparently without independent confirmation.
 */
export type ClaimProvenanceType = "verified" | "observed" | "declared";

/** Metadata about how a specific claim was established. */
export type ClaimProvenanceRecordType = {
  source: ClaimProvenanceType;
  /** Identity of the party that attested this claim (verifier ID, inspector ID). */
  attestedBy?: string | undefined;
  /** When the attestation was produced (ISO 8601). */
  attestedAt?: string | undefined;
  /** When this provenance record expires (ISO 8601). After this time, consumers should treat the claim as stale. */
  expiresAt?: string | undefined;
};

/** Map from disclosure field names to their provenance records. */
export type ProvenanceMapType = Record<string, ClaimProvenanceRecordType>;

// -- Schemas ---------------------------------------------------------------

/**
 * How a seal claim's value was established.
 *
 * - `verified`: cryptographically proven or computed by the signet itself
 * - `observed`: independently inspected by a signed, trusted component
 * - `declared`: stated by the operator without independent confirmation
 */
export const ClaimProvenance: z.ZodEnum<["verified", "observed", "declared"]> =
  z.enum(["verified", "observed", "declared"]);

/** Metadata about how a specific claim was established. */
export const ClaimProvenanceRecord: z.ZodType<ClaimProvenanceRecordType> = z
  .object({
    /** How this claim was established. */
    source: ClaimProvenance,
    /** Identity of the attesting party (verifier ID, inspector ID). */
    attestedBy: z.string().optional(),
    /** When the attestation was produced (ISO 8601). */
    attestedAt: z.string().datetime().optional(),
    /** When this provenance expires (ISO 8601). Consumers should treat the claim as stale after this time. */
    expiresAt: z.string().datetime().optional(),
  })
  .describe("Provenance metadata for a seal claim");

/** Map from disclosure field names to their provenance records. */
export const ProvenanceMap: z.ZodType<ProvenanceMapType> = z
  .record(z.string(), ClaimProvenanceRecord)
  .describe(
    "Maps disclosure field names to provenance records indicating how each claim was established",
  );
