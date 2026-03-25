import { z } from "zod";

/** Granularity of a reveal operation. */
export const RevealScope: z.ZodEnum<
  ["message", "thread", "time-window", "content-type", "sender"]
> = z
  .enum(["message", "thread", "time-window", "content-type", "sender"])
  .describe("Granularity of a reveal operation");

/** Granularity of a reveal operation. */
export type RevealScope = z.infer<typeof RevealScope>;

/** Request to reveal previously hidden content within a group. */
export type RevealRequest = {
  revealId: string;
  groupId: string;
  scope: RevealScope;
  targetId: string;
  requestedBy: string;
  expiresAt: string | null;
};

/** Zod schema for a reveal request. */
export const RevealRequest: z.ZodType<RevealRequest> = z
  .object({
    revealId: z.string().describe("Unique reveal request identifier"),
    groupId: z.string().describe("Group containing the content"),
    scope: RevealScope.describe("What granularity to reveal"),
    targetId: z
      .string()
      .describe(
        "Target identifier: message ID, thread ID, content type, sender inbox ID, or 'startISO|endISO' for time-window scope",
      ),
    requestedBy: z
      .string()
      .describe("Inbox ID of the member requesting the reveal"),
    expiresAt: z
      .string()
      .datetime()
      .nullable()
      .describe("When this reveal expires, null for permanent"),
  })
  .describe("Request to reveal content to an agent");

/** Reveal access that makes previously hidden content visible. */
export type RevealAccess = {
  revealId: string;
  grantedAt: string;
  grantedBy: string;
  expiresAt: string | null;
};

/** Zod schema for active reveal access. */
export const RevealAccess: z.ZodType<RevealAccess> = z
  .object({
    revealId: z.string().describe("Matches the RevealRequest.revealId"),
    grantedAt: z.string().datetime().describe("When reveal access was granted"),
    grantedBy: z.string().describe("Inbox ID of the approving member"),
    expiresAt: z
      .string()
      .datetime()
      .nullable()
      .describe("When this reveal access expires, null for permanent"),
  })
  .describe("Active reveal access making content visible to the agent");

/** Aggregate reveal state tracked for a credential. */
export type RevealState = {
  activeReveals: RevealAccess[];
};

/** Zod schema for aggregate reveal state tracked in a credential. */
export const RevealState: z.ZodType<RevealState> = z
  .object({
    activeReveals: z
      .array(RevealAccess)
      .describe("Currently active reveal access records"),
  })
  .describe("Aggregate reveal state for a credential");
