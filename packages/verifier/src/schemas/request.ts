import { z } from "zod";
import {
  AttestationSchema,
  TrustTier,
} from "@xmtp-broker/schemas";
import type { Attestation, TrustTier as TrustTierType } from "@xmtp-broker/schemas";

export type VerificationRequest = {
  requestId: string;
  agentInboxId: string;
  brokerInboxId: string;
  groupId: string | null;
  attestation: Attestation | null;
  artifactDigest: string;
  buildProvenanceBundle: string | null;
  sourceRepoUrl: string;
  releaseTag: string | null;
  requestedTier: TrustTierType;
  challengeNonce: string;
};

export const VerificationRequestSchema: z.ZodType<VerificationRequest> = z
  .object({
    requestId: z.string().describe("Unique request identifier for correlation"),
    agentInboxId: z
      .string()
      .describe("XMTP inbox ID of the agent being verified"),
    brokerInboxId: z
      .string()
      .describe("XMTP inbox ID of the broker operating the agent"),
    groupId: z
      .string()
      .nullable()
      .describe("Group context for verification, null for broker-wide"),
    attestation: AttestationSchema.nullable().describe(
      "Attestation to verify, null if only checking provenance",
    ),
    artifactDigest: z
      .string()
      .describe("SHA-256 digest of the broker artifact (hex-encoded)"),
    buildProvenanceBundle: z
      .string()
      .nullable()
      .describe("Base64-encoded SLSA provenance or Sigstore bundle"),
    sourceRepoUrl: z
      .string()
      .url()
      .describe("URL of the broker source repository"),
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
