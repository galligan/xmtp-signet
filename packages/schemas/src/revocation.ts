import { z } from "zod";

/** Reason an agent was revoked from a group. */
export const AgentRevocationReason: z.ZodEnum<
  [
    "owner-initiated",
    "session-expired",
    "admin-removed",
    "heartbeat-timeout",
    "policy-violation",
  ]
> = z
  .enum([
    "owner-initiated",
    "session-expired",
    "admin-removed",
    "heartbeat-timeout",
    "policy-violation",
  ])
  .describe("Why the agent was revoked from a group");

/** Reason an agent was revoked from a group. */
export type AgentRevocationReason = z.infer<typeof AgentRevocationReason>;

/** Reason a session was revoked. */
export const SessionRevocationReason: z.ZodEnum<
  [
    "owner-initiated",
    "session-expired",
    "heartbeat-timeout",
    "policy-violation",
    "reauthorization-required",
  ]
> = z
  .enum([
    "owner-initiated",
    "session-expired",
    "heartbeat-timeout",
    "policy-violation",
    "reauthorization-required",
  ])
  .describe("Why a session was revoked");

/** Reason a session was revoked. */
export type SessionRevocationReason = z.infer<typeof SessionRevocationReason>;

/** Seal that records revocation of an agent's group membership. */
export type RevocationSeal = {
  sealId: string;
  previousSealId: string;
  agentInboxId: string;
  groupId: string;
  reason: AgentRevocationReason;
  revokedAt: string;
  issuer: string;
};

/** Zod schema for a revocation seal. */
export const RevocationSeal: z.ZodType<RevocationSeal> = z
  .object({
    sealId: z.string().describe("ID of this revocation seal"),
    previousSealId: z.string().describe("ID of the seal being revoked"),
    agentInboxId: z.string().describe("Agent being revoked"),
    groupId: z.string().describe("Group the revocation applies to"),
    reason: AgentRevocationReason.describe("Why the agent was revoked"),
    revokedAt: z
      .string()
      .datetime()
      .describe("When the revocation took effect"),
    issuer: z.string().describe("Identity of the revocation issuer"),
  })
  .describe("Group-visible revocation of an agent's seal");
