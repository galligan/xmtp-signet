/**
 * Generates a random seal ID.
 *
 * Format: "att_" prefix + 32 hex chars derived from crypto.randomUUID().
 * Random (not deterministic) because the same logical change applied at
 * different times is a different seal.
 */
export function generateSealId(): string {
  const uuid = crypto.randomUUID().replaceAll("-", "");
  return `att_${uuid}`;
}
