/**
 * Generates a random attestation ID.
 *
 * Format: "att_" prefix + 32 hex chars derived from crypto.randomUUID().
 * Random (not deterministic) because the same logical change applied at
 * different times is a different attestation.
 */
export function generateAttestationId(): string {
  const uuid = crypto.randomUUID().replaceAll("-", "");
  return `att_${uuid}`;
}
