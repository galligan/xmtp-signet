import { z } from "zod";
import { ContentTypeId } from "./content-types.js";
import { SealSchema } from "./seal.js";
import type { Seal } from "./seal.js";
import { SessionToken } from "./session.js";
import { ViewConfig } from "./view.js";
import { GrantConfig } from "./grant.js";
import { RevocationSeal } from "./revocation.js";

export const MessageVisibility: z.ZodEnum<
  ["visible", "historical", "hidden", "revealed", "redacted"]
> = z
  .enum(["visible", "historical", "hidden", "revealed", "redacted"])
  .describe("How the message is being projected to the agent");

export type MessageVisibility = z.infer<typeof MessageVisibility>;

export type MessageEvent = {
  type: "message.visible";
  messageId: string;
  groupId: string;
  senderInboxId: string;
  contentType: string;
  content?: unknown;
  visibility: MessageVisibility;
  sentAt: string;
  sealId: string | null;
  /** Thread anchor ID — derived from Reply referenceId. Null for non-reply messages. */
  threadId: string | null;
};

const _MessageEvent = z
  .object({
    type: z.literal("message.visible").describe("Event type discriminator"),
    messageId: z.string().describe("XMTP message ID"),
    groupId: z.string().describe("Group the message belongs to"),
    senderInboxId: z.string().describe("Inbox ID of the sender"),
    contentType: ContentTypeId.describe("Content type of the message"),
    content: z.unknown().describe("Decoded message payload"),
    visibility: MessageVisibility.describe("How this message is projected"),
    sentAt: z.string().datetime().describe("When the message was sent"),
    sealId: z
      .string()
      .nullable()
      .describe("Seal ID if sent by a signet-managed agent, null otherwise"),
    threadId: z
      .string()
      .nullable()
      .describe(
        "Thread anchor ID — derived from Reply referenceId. Null for non-reply messages",
      ),
  })
  .describe("A message projected to the agent according to its view");

export const MessageEvent: z.ZodType<MessageEvent> = _MessageEvent;

export type SealStampedEvent = {
  type: "seal.stamped";
  seal: Seal;
};

const _SealStampedEvent = z
  .object({
    type: z.literal("seal.stamped").describe("Event type discriminator"),
    seal: SealSchema.describe("The stamped seal"),
  })
  .describe("Seal was stamped or updated");

export const SealStampedEvent: z.ZodType<SealStampedEvent> = _SealStampedEvent;

export type SessionStartedEvent = {
  type: "session.started";
  session: z.infer<typeof SessionToken>;
  view: z.infer<typeof ViewConfig>;
  grant: z.infer<typeof GrantConfig>;
};

const _SessionStartedEvent = z
  .object({
    type: z.literal("session.started").describe("Event type discriminator"),
    session: SessionToken.describe("The issued session token"),
    view: ViewConfig.describe("Active view for this session"),
    grant: GrantConfig.describe("Active grant for this session"),
  })
  .describe("Session successfully established");

export const SessionStartedEvent: z.ZodType<SessionStartedEvent> =
  _SessionStartedEvent;

export type SessionExpiredEvent = {
  type: "session.expired";
  sessionId: string;
  reason: string;
};

const _SessionExpiredEvent = z
  .object({
    type: z.literal("session.expired").describe("Event type discriminator"),
    sessionId: z.string().describe("Expired session ID"),
    reason: z.string().describe("Why the session expired"),
  })
  .describe("Session has expired");

export const SessionExpiredEvent: z.ZodType<SessionExpiredEvent> =
  _SessionExpiredEvent;

export type SessionReauthRequiredEvent = {
  type: "session.reauthorization_required";
  sessionId: string;
  reason: string;
};

const _SessionReauthRequiredEvent = z
  .object({
    type: z
      .literal("session.reauthorization_required")
      .describe("Event type discriminator"),
    sessionId: z.string().describe("Session requiring reauthorization"),
    reason: z.string().describe("What policy change triggered reauthorization"),
  })
  .describe("Session must be reauthorized due to material policy change");

export const SessionReauthRequiredEvent: z.ZodType<SessionReauthRequiredEvent> =
  _SessionReauthRequiredEvent;

export type HeartbeatEvent = {
  type: "heartbeat";
  sessionId: string;
  timestamp: string;
};

const _HeartbeatEvent = z
  .object({
    type: z.literal("heartbeat").describe("Event type discriminator"),
    sessionId: z.string().describe("Session this heartbeat is for"),
    timestamp: z.string().datetime().describe("Heartbeat timestamp"),
  })
  .describe("Liveness signal from the signet");

export const HeartbeatEvent: z.ZodType<HeartbeatEvent> = _HeartbeatEvent;

export type RevealEvent = {
  type: "message.revealed";
  messageId: string;
  groupId: string;
  contentType: string;
  content?: unknown;
  revealId: string;
};

const _RevealEvent = z
  .object({
    type: z.literal("message.revealed").describe("Event type discriminator"),
    messageId: z.string().describe("Message being revealed"),
    groupId: z.string().describe("Group the message belongs to"),
    contentType: ContentTypeId.describe("Content type of the revealed message"),
    content: z.unknown().describe("Decoded message payload"),
    revealId: z.string().describe("Reveal grant that authorized this"),
  })
  .describe("Previously hidden content revealed to the agent");

export const RevealEvent: z.ZodType<RevealEvent> = _RevealEvent;

export type ViewUpdatedEvent = {
  type: "view.updated";
  view: z.infer<typeof ViewConfig>;
};

const _ViewUpdatedEvent = z
  .object({
    type: z.literal("view.updated").describe("Event type discriminator"),
    view: ViewConfig.describe("Updated view configuration"),
  })
  .describe("View configuration changed within the current session");

export const ViewUpdatedEvent: z.ZodType<ViewUpdatedEvent> = _ViewUpdatedEvent;

export type GrantUpdatedEvent = {
  type: "grant.updated";
  grant: z.infer<typeof GrantConfig>;
};

const _GrantUpdatedEvent = z
  .object({
    type: z.literal("grant.updated").describe("Event type discriminator"),
    grant: GrantConfig.describe("Updated grant configuration"),
  })
  .describe("Grant configuration changed within the current session");

export const GrantUpdatedEvent: z.ZodType<GrantUpdatedEvent> =
  _GrantUpdatedEvent;

export type AgentRevokedEvent = {
  type: "agent.revoked";
  revocation: z.infer<typeof RevocationSeal>;
};

const _AgentRevokedEvent = z
  .object({
    type: z.literal("agent.revoked").describe("Event type discriminator"),
    revocation: RevocationSeal.describe("The revocation details"),
  })
  .describe("Agent has been revoked from the group");

export const AgentRevokedEvent: z.ZodType<AgentRevokedEvent> =
  _AgentRevokedEvent;

export type ActionConfirmationEvent = {
  type: "action.confirmation_required";
  actionId: string;
  actionType: string;
  preview?: unknown;
};

const _ActionConfirmationEvent = z
  .object({
    type: z
      .literal("action.confirmation_required")
      .describe("Event type discriminator"),
    actionId: z.string().describe("ID of the pending action"),
    actionType: z.string().describe("Type of action awaiting confirmation"),
    preview: z.unknown().describe("Preview of the action for owner review"),
  })
  .describe("An action requires owner confirmation before execution");

export const ActionConfirmationEvent: z.ZodType<ActionConfirmationEvent> =
  _ActionConfirmationEvent;

export type SignetRecoveryEvent = {
  type: "signet.recovery.complete";
  caughtUpThrough: string;
};

const _SignetRecoveryEvent = z
  .object({
    type: z
      .literal("signet.recovery.complete")
      .describe("Event type discriminator"),
    caughtUpThrough: z
      .string()
      .datetime()
      .describe("Timestamp through which the signet has resynced"),
  })
  .describe("Signet has recovered and resynced");

export const SignetRecoveryEvent: z.ZodType<SignetRecoveryEvent> =
  _SignetRecoveryEvent;

export type SignetEvent =
  | MessageEvent
  | SealStampedEvent
  | SessionStartedEvent
  | SessionExpiredEvent
  | SessionReauthRequiredEvent
  | HeartbeatEvent
  | RevealEvent
  | ViewUpdatedEvent
  | GrantUpdatedEvent
  | AgentRevokedEvent
  | ActionConfirmationEvent
  | SignetRecoveryEvent;

/** Discriminated union of all signet-to-harness events. */
export const SignetEvent: z.ZodType<SignetEvent> = z
  .discriminatedUnion("type", [
    _MessageEvent,
    _SealStampedEvent,
    _SessionStartedEvent,
    _SessionExpiredEvent,
    _SessionReauthRequiredEvent,
    _HeartbeatEvent,
    _RevealEvent,
    _ViewUpdatedEvent,
    _GrantUpdatedEvent,
    _AgentRevokedEvent,
    _ActionConfirmationEvent,
    _SignetRecoveryEvent,
  ])
  .describe("Any event the signet may send to a harness");
