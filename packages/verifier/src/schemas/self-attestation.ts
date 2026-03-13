import { z } from "zod";
import { TrustTier } from "@xmtp-broker/schemas";
import type { TrustTier as TrustTierType } from "@xmtp-broker/schemas";

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

export const VerifierCapabilities: z.ZodType<VerifierCapabilities> =
  _VerifierCapabilities;

export type VerifierSelfAttestation = {
  verifierInboxId: string;
  capabilities: VerifierCapabilities;
  sourceRepoUrl: string;
  issuedAt: string;
  signature: string;
};

export const VerifierSelfAttestationSchema: z.ZodType<VerifierSelfAttestation> =
  z
    .object({
      verifierInboxId: z.string().describe("XMTP inbox ID of this verifier"),
      capabilities: _VerifierCapabilities.describe(
        "What this verifier can do",
      ),
      sourceRepoUrl: z
        .string()
        .url()
        .describe("URL of the verifier's source code"),
      issuedAt: z
        .string()
        .datetime()
        .describe("When this self-attestation was created"),
      signature: z.string().describe("Base64-encoded self-signature"),
    })
    .describe("Self-attestation published by the verifier");
