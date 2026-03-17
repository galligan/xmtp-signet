import { z } from "zod";
import {
  SealEnvelopeSchema,
  type SealEnvelope,
  type SignedRevocationEnvelope,
} from "@xmtp/signet-contracts";
import { RevocationSeal } from "@xmtp/signet-schemas";
import type { RevocationSeal as RevocationSealType } from "@xmtp/signet-schemas";

/**
 * Custom XMTP content type for seals.
 * Follows the authority/type:version convention.
 */
export const SEAL_CONTENT_TYPE_ID = "xmtp.org/agentSeal:1.0" as const;

/**
 * Custom XMTP content type for revocations.
 * Follows the authority/type:version convention.
 */
export const REVOCATION_CONTENT_TYPE_ID =
  "xmtp.org/agentRevocation:1.0" as const;

export type SealMessage = z.infer<typeof SealEnvelopeSchema> & {
  contentType: typeof SEAL_CONTENT_TYPE_ID;
};

/** Schema for a full seal message with contentType discriminator. */
const _SealMessage = SealEnvelopeSchema.extend({
  contentType: z.literal(SEAL_CONTENT_TYPE_ID),
}).describe("Seal message with content type discriminator");

export const SealMessage: z.ZodType<SealMessage> = _SealMessage;

/**
 * Signed revocation envelope schema, reconstructed here to avoid a
 * name-collision export issue in the contracts package dist.
 */
const SignedRevocationEnvelopeLocal = z.object({
  revocation: RevocationSeal,
  signature: z.string(),
  signatureAlgorithm: z.string(),
  signerKeyRef: z.string(),
});

export type RevocationMessage = {
  revocation: RevocationSealType;
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

/** Wraps a signed seal with the contentType discriminator field. */
export function encodeSealMessage(envelope: SealEnvelope): SealMessage {
  return { contentType: SEAL_CONTENT_TYPE_ID, ...envelope };
}

/** Wraps a signed revocation with the contentType discriminator field. */
export function encodeRevocationMessage(
  envelope: SignedRevocationEnvelope,
): RevocationMessage {
  return { contentType: REVOCATION_CONTENT_TYPE_ID, ...envelope };
}
