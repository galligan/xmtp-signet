import { z } from "zod";
import {
  SealId,
  CredentialId,
  OperatorId,
  ConversationId,
} from "./resource-id.js";

/** Reason an agent was revoked from a group. */
export const AgentRevocationReason: z.ZodEnum<
  [
    "owner-initiated",
    "credential-expired",
    "admin-removed",
    "heartbeat-timeout",
    "policy-violation",
  ]
> = z
  .enum([
    "owner-initiated",
    "credential-expired",
    "admin-removed",
    "heartbeat-timeout",
    "policy-violation",
  ])
  .describe("Why the agent was revoked from a group");

/** Reason an agent was revoked from a group. */
export type AgentRevocationReason = z.infer<typeof AgentRevocationReason>;

/** Reason a credential was revoked. */
export const CredentialRevocationReason: z.ZodEnum<
  [
    "owner-initiated",
    "credential-expired",
    "heartbeat-timeout",
    "policy-violation",
    "reauthorization-required",
  ]
> = z
  .enum([
    "owner-initiated",
    "credential-expired",
    "heartbeat-timeout",
    "policy-violation",
    "reauthorization-required",
  ])
  .describe("Why a credential was revoked");

/** Reason a credential was revoked. */
export type CredentialRevocationReason = z.infer<
  typeof CredentialRevocationReason
>;

/** Seal that records revocation of an agent's group membership. */
export type RevocationSeal = {
  sealId: string;
  previousSealId: string;
  operatorId: string;
  credentialId: string;
  chatId: string;
  reason: AgentRevocationReason;
  revokedAt: string;
  issuer: string;
};

/** Zod schema for a revocation seal. */
export const RevocationSeal: z.ZodType<RevocationSeal> = z
  .object({
    /** ID of this revocation seal. */
    sealId: SealId,
    /** ID of the seal being revoked. */
    previousSealId: SealId,
    /** Operator being revoked. */
    operatorId: OperatorId,
    /** Credential associated with the revocation. */
    credentialId: CredentialId,
    /** Conversation the revocation applies to. */
    chatId: ConversationId,
    /** Why the agent was revoked. */
    reason: AgentRevocationReason,
    /** When the revocation took effect. */
    revokedAt: z.string().datetime(),
    /** Identity of the revocation issuer. */
    issuer: z.string(),
  })
  .describe("Group-visible revocation of an agent's seal");
