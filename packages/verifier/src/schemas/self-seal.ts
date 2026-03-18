import { z } from "zod";
import { TrustTier } from "@xmtp/signet-schemas";
import type { TrustTier as TrustTierType } from "@xmtp/signet-schemas";

/** Capabilities advertised by a verifier instance. */
export type VerifierCapabilities = {
  supportedTiers: TrustTierType[];
  supportedChecks: string[];
  maxRequestsPerHour: number;
};

const _VerifierCapabilities = z
  .object({
    supportedTiers: z
      .array(TrustTier)
      .describe("Trust tiers this verifier can check"),
    supportedChecks: z
      .array(z.string())
      .describe("Check IDs this verifier performs"),
    maxRequestsPerHour: z
      .number()
      .int()
      .positive()
      .describe("Rate limit per requester per hour"),
  })
  .describe("Capabilities advertised by this verifier");

/** Zod schema for verifier capabilities. */
export const VerifierCapabilities: z.ZodType<VerifierCapabilities> =
  _VerifierCapabilities;

/** Self-seal document published by a verifier. */
export type VerifierSelfSeal = {
  verifierInboxId: string;
  capabilities: VerifierCapabilities;
  sourceRepoUrl: string;
  issuedAt: string;
  signature: string;
};

/** Zod schema for a verifier self-seal. */
export const VerifierSelfSealSchema: z.ZodType<VerifierSelfSeal> = z
  .object({
    verifierInboxId: z.string().describe("XMTP inbox ID of this verifier"),
    capabilities: _VerifierCapabilities.describe("What this verifier can do"),
    sourceRepoUrl: z
      .string()
      .url()
      .describe("URL of the verifier's source code"),
    issuedAt: z.string().datetime().describe("When this self-seal was created"),
    signature: z.string().describe("Base64-encoded self-seal signature"),
  })
  .describe("Self-seal published by the verifier");
