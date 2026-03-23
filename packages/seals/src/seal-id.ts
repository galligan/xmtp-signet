import { createResourceId } from "@xmtp/signet-schemas";

/**
 * Generates a random seal ID using the standard resource ID format.
 *
 * Format: "seal_" prefix + 16 hex chars (8 bytes of entropy).
 * Random (not deterministic) because the same logical change applied at
 * different times is a different seal.
 */
export function generateSealId(): string {
  return createResourceId("seal");
}
