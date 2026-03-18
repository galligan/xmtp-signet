import { z } from "zod";
import { SealSchema, TrustTier } from "@xmtp/signet-schemas";
import type { Seal, TrustTier as TrustTierType } from "@xmtp/signet-schemas";

/** Verification request sent to the verifier. */
export type VerificationRequest = {
  requestId: string;
  agentInboxId: string;
  signetInboxId: string;
  groupId: string | null;
  seal: Seal | null;
  artifactDigest: string;
  buildProvenanceBundle: string | null;
  sourceRepoUrl: string;
  releaseTag: string | null;
  requestedTier: TrustTierType;
  challengeNonce: string;
};

/** Zod schema for a verifier request. */
export const VerificationRequestSchema: z.ZodType<VerificationRequest> = z
  .object({
    requestId: z.string().describe("Unique request identifier for correlation"),
    agentInboxId: z
      .string()
      .describe("XMTP inbox ID of the agent being verified"),
    signetInboxId: z
      .string()
      .describe("XMTP inbox ID of the signet operating the agent"),
    groupId: z
      .string()
      .nullable()
      .describe("Group context for verification, null for signet-wide"),
    seal: SealSchema.nullable().describe(
      "Seal to verify, null if only checking provenance",
    ),
    artifactDigest: z
      .string()
      .describe("SHA-256 digest of the signet artifact (hex-encoded)"),
    buildProvenanceBundle: z
      .string()
      .nullable()
      .describe("Base64-encoded SLSA provenance or Sigstore bundle"),
    sourceRepoUrl: z
      .string()
      .url()
      .describe("URL of the signet source repository"),
    releaseTag: z
      .string()
      .nullable()
      .describe("Git tag or release version, null for dev builds"),
    requestedTier: TrustTier.describe("Trust tier the requester is claiming"),
    challengeNonce: z
      .string()
      .describe("Random nonce to prevent replay (hex-encoded, 32 bytes)"),
  })
  .describe("Verification request sent to the verifier via XMTP DM");
