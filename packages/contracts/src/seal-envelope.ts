import { z } from "zod";
import { SealSchema, RevocationSeal } from "@xmtp/signet-schemas";

/** Provenance metadata attached to outbound message seals. */
export interface MessageProvenanceMetadata {
  readonly sealId: string;
  readonly sessionKeyFingerprint: string;
  readonly policyHash: string;
}

const BASE64_SIGNATURE: z.ZodString = z
  .string()
  .min(1)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
  .describe("Base64-encoded signature bytes");

type SealEnvelopeShape = {
  seal: typeof SealSchema;
  signature: typeof BASE64_SIGNATURE;
  signatureAlgorithm: z.ZodString;
  signerKeyRef: z.ZodString;
};

const sealEnvelopeShape: SealEnvelopeShape = {
  seal: SealSchema.describe("The seal payload"),
  signature: BASE64_SIGNATURE.describe(
    "Base64-encoded signature over the canonical seal bytes",
  ),
  signatureAlgorithm: z
    .string()
    .describe("Algorithm used to produce the signature"),
  signerKeyRef: z
    .string()
    .describe("Reference to the key that produced the signature"),
};

/** Zod schema for a signed seal ready for group publication. */
export const SealEnvelope: z.ZodObject<SealEnvelopeShape> = z
  .object(sealEnvelopeShape)
  .describe("Signed seal ready for group publication");

/** Schema alias for a signed seal ready for publication. */
export const SealEnvelopeSchema: z.ZodObject<SealEnvelopeShape> = SealEnvelope;
/** Parsed signed seal envelope. */
export type SealEnvelope = z.infer<typeof SealEnvelopeSchema>;

type SignedRevocationEnvelopeShape = {
  revocation: typeof RevocationSeal;
  signature: typeof BASE64_SIGNATURE;
  signatureAlgorithm: z.ZodString;
  signerKeyRef: z.ZodString;
};

const signedRevocationEnvelopeShape: SignedRevocationEnvelopeShape = {
  revocation: RevocationSeal.describe("The revocation payload"),
  signature: BASE64_SIGNATURE.describe(
    "Base64-encoded signature over the canonical revocation bytes",
  ),
  signatureAlgorithm: z
    .string()
    .describe("Algorithm used to produce the signature"),
  signerKeyRef: z
    .string()
    .describe("Reference to the key that produced the signature"),
};

/** Zod schema for a signed revocation ready for group publication. */
export const SignedRevocationEnvelope: z.ZodObject<SignedRevocationEnvelopeShape> =
  z
    .object(signedRevocationEnvelopeShape)
    .describe("Signed revocation ready for group publication");

/** Parsed signed revocation envelope. */
export type SignedRevocationEnvelope = z.infer<typeof SignedRevocationEnvelope>;
