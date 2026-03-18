import { z } from "zod";
import { TrustTier } from "@xmtp/signet-schemas";
import type { TrustTier as TrustTierType } from "@xmtp/signet-schemas";
import { VerificationCheck } from "./check.js";

/** Overall outcome emitted by the verifier. */
export const VerificationVerdict: z.ZodEnum<
  ["verified", "partial", "rejected"]
> = z
  .enum(["verified", "partial", "rejected"])
  .describe("Overall verification outcome");

/** Type union for verifier outcomes. */
export type VerificationVerdict = z.infer<typeof VerificationVerdict>;

/** Signed statement produced by the verifier for a request. */
export type VerificationStatement = {
  statementId: string;
  requestId: string;
  verifierInboxId: string;
  signetInboxId: string;
  agentInboxId: string;
  verdict: VerificationVerdict;
  verifiedTier: TrustTierType;
  checks: z.infer<typeof VerificationCheck>[];
  challengeNonce: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
  signatureAlgorithm: "Ed25519";
};

/** Zod schema for a verifier statement. */
export const VerificationStatementSchema: z.ZodType<VerificationStatement> = z
  .object({
    statementId: z.string().describe("Unique statement identifier"),
    requestId: z.string().describe("Correlates with the original request"),
    verifierInboxId: z
      .string()
      .describe("XMTP inbox ID of the verifier that issued this statement"),
    signetInboxId: z
      .string()
      .describe("XMTP inbox ID of the signet being verified"),
    agentInboxId: z
      .string()
      .describe("XMTP inbox ID of the agent being verified"),
    verdict: VerificationVerdict.describe("Overall verification outcome"),
    verifiedTier: TrustTier.describe(
      "Highest trust tier confirmed by this verification",
    ),
    checks: z.array(VerificationCheck).describe("Individual check results"),
    challengeNonce: z.string().describe("Echoed nonce from the request"),
    issuedAt: z.string().datetime().describe("When this statement was issued"),
    expiresAt: z.string().datetime().describe("When this statement expires"),
    signature: z
      .string()
      .describe(
        "Base64-encoded Ed25519 signature over canonical statement bytes",
      ),
    signatureAlgorithm: z.literal("Ed25519").describe("Signature algorithm"),
  })
  .describe("Signed verification statement issued by the verifier");
