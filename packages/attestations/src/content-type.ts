import { z } from "zod";
import { SignedAttestationEnvelope } from "@xmtp-broker/contracts";
import type {
  SignedAttestation,
  SignedRevocationEnvelope,
} from "@xmtp-broker/contracts";
import { RevocationAttestation } from "@xmtp-broker/schemas";
import type { RevocationAttestation as RevocationAttestationType } from "@xmtp-broker/schemas";

/**
 * Custom XMTP content type for attestations.
 * Follows the authority/type:version convention.
 */
export const ATTESTATION_CONTENT_TYPE_ID =
  "xmtp.org/agentAttestation:1.0" as const;

/**
 * Custom XMTP content type for revocations.
 * Follows the authority/type:version convention.
 */
export const REVOCATION_CONTENT_TYPE_ID =
  "xmtp.org/agentRevocation:1.0" as const;

export type AttestationMessage = z.infer<typeof SignedAttestationEnvelope> & {
  contentType: typeof ATTESTATION_CONTENT_TYPE_ID;
};

/** Schema for a full attestation message with contentType discriminator. */
const _AttestationMessage = SignedAttestationEnvelope.extend({
  contentType: z.literal(ATTESTATION_CONTENT_TYPE_ID),
}).describe("Attestation message with content type discriminator");

export const AttestationMessage: z.ZodType<AttestationMessage> =
  _AttestationMessage;

/**
 * Signed revocation envelope schema, reconstructed here to avoid a
 * name-collision export issue in the contracts package dist.
 */
const SignedRevocationEnvelopeLocal = z.object({
  revocation: RevocationAttestation,
  signature: z.string(),
  signatureAlgorithm: z.string(),
  signerKeyRef: z.string(),
});

export type RevocationMessage = {
  revocation: RevocationAttestationType;
  signature: string;
  signatureAlgorithm: string;
  signerKeyRef: string;
  contentType: typeof REVOCATION_CONTENT_TYPE_ID;
};

/** Schema for a full revocation message with contentType discriminator. */
const _RevocationMessage = SignedRevocationEnvelopeLocal.extend({
  contentType: z.literal(REVOCATION_CONTENT_TYPE_ID),
}).describe("Revocation message with content type discriminator");

export const RevocationMessage: z.ZodType<RevocationMessage> =
  _RevocationMessage;

/** Wraps a signed attestation with the contentType discriminator field. */
export function encodeAttestationMessage(
  envelope: SignedAttestation,
): AttestationMessage {
  return { contentType: ATTESTATION_CONTENT_TYPE_ID, ...envelope };
}

/** Wraps a signed revocation with the contentType discriminator field. */
export function encodeRevocationMessage(
  envelope: SignedRevocationEnvelope,
): RevocationMessage {
  return { contentType: REVOCATION_CONTENT_TYPE_ID, ...envelope };
}
