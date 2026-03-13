import { z } from "zod";
import { AttestationSchema, RevocationAttestation } from "@xmtp-broker/schemas";

/** Provenance info attached to outbound messages. */
export interface MessageProvenanceMetadata {
  readonly attestationId: string;
  readonly sessionKeyFingerprint: string;
  readonly policyHash: string;
}

const BASE64_SIGNATURE: z.ZodString = z
  .string()
  .min(1)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
  .describe("Base64-encoded signature bytes");

type SignedAttestationEnvelopeShape = {
  attestation: typeof AttestationSchema;
  signature: typeof BASE64_SIGNATURE;
  signatureAlgorithm: z.ZodString;
  signerKeyRef: z.ZodString;
};

const signedAttestationEnvelopeShape: SignedAttestationEnvelopeShape = {
  attestation: AttestationSchema.describe("The attestation payload"),
  signature: BASE64_SIGNATURE.describe(
    "Base64-encoded signature over the canonical attestation bytes",
  ),
  signatureAlgorithm: z
    .string()
    .describe("Algorithm used to produce the signature"),
  signerKeyRef: z
    .string()
    .describe("Reference to the key that produced the signature"),
};

/** Signed attestation ready for group publication. */
export const SignedAttestationEnvelope: z.ZodObject<SignedAttestationEnvelopeShape> =
  z
    .object(signedAttestationEnvelopeShape)
    .describe("Signed attestation ready for group publication");

export type SignedAttestation = z.infer<typeof SignedAttestationEnvelope>;

type SignedRevocationEnvelopeShape = {
  revocation: typeof RevocationAttestation;
  signature: typeof BASE64_SIGNATURE;
  signatureAlgorithm: z.ZodString;
  signerKeyRef: z.ZodString;
};

const signedRevocationEnvelopeShape: SignedRevocationEnvelopeShape = {
  revocation: RevocationAttestation.describe("The revocation payload"),
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

/** Signed revocation ready for group publication. */
export const SignedRevocationEnvelope: z.ZodObject<SignedRevocationEnvelopeShape> =
  z
    .object(signedRevocationEnvelopeShape)
    .describe("Signed revocation ready for group publication");

export type SignedRevocationEnvelope = z.infer<typeof SignedRevocationEnvelope>;
