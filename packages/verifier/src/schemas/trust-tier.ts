import { z } from "zod";

/**
 * Trust tiers for verification. This is a verifier-specific concept
 * covering the full spectrum from unverified to runtime-attested.
 *
 * - unverified: no checks passed or no seal provided
 * - source-verified: source code is available and matches
 * - reproducibly-verified: build is reproducible from source
 * - runtime-attested: runtime environment is attested (e.g., TEE)
 */
export const TrustTier: z.ZodEnum<
  ["unverified", "source-verified", "reproducibly-verified", "runtime-attested"]
> = z.enum([
  "unverified",
  "source-verified",
  "reproducibly-verified",
  "runtime-attested",
]);

/** Trust tier for verification outcomes. */
export type TrustTier = z.infer<typeof TrustTier>;
