import { z } from "zod";
import { ContentTypeId } from "./content-types.js";
import { SealEnvelope } from "./seal.js";
import type { SealEnvelopeType } from "./seal.js";
import { ScopeSet } from "./permission-scopes.js";
import type { ScopeSetType } from "./permission-scopes.js";
import { RevocationSeal } from "./revocation.js";

/** Projection modes the signet may use when surfacing a message. */
export const MessageVisibility: z.ZodEnum<
  ["visible", "historical", "hidden", "revealed", "redacted"]
> = z
  .enum(["visible", "historical", "hidden", "revealed", "redacted"])
  .describe("How the message is being projected to the agent");

/** Projection mode assigned to a surfaced message event. */
export type MessageVisibility = z.infer<typeof MessageVisibility>;

/** Event emitted when a message is surfaced to the harness. */
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
  /** Thread anchor ID -- derived from Reply referenceId. Null for non-reply messages. */
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
        "Thread anchor ID -- derived from Reply referenceId. Null for non-reply messages",
      ),
  })
  .describe("A message projected to the agent according to its view");

/** Zod schema for `message.visible` events. */
export const MessageEvent: z.ZodType<MessageEvent> = _MessageEvent;

/** Event emitted when a seal envelope is stamped. */
export type SealStampedEvent = {
  type: "seal.stamped";
  seal: SealEnvelopeType;
};

const _SealStampedEvent = z
  .object({
    type: z.literal("seal.stamped").describe("Event type discriminator"),
    seal: SealEnvelope.describe("The stamped seal envelope"),
  })
  .describe("Seal was stamped or updated");

/** Zod schema for `seal.stamped` events. */
export const SealStampedEvent: z.ZodType<SealStampedEvent> = _SealStampedEvent;

/** Event emitted when a new credential is issued. */
export type CredentialIssuedEvent = {
  type: "credential.issued";
  credentialId: string;
  operatorId: string;
};

const _CredentialIssuedEvent = z
  .object({
    type: z.literal("credential.issued").describe("Event type discriminator"),
    credentialId: z.string().describe("Issued credential ID"),
    operatorId: z.string().describe("Operator the credential was issued to"),
  })
  .describe("Credential successfully issued");

/** Zod schema for `credential.issued` events. */
export const CredentialIssuedEvent: z.ZodType<CredentialIssuedEvent> =
  _CredentialIssuedEvent;

/** Event emitted when a credential is no longer usable. */
export type CredentialExpiredEvent = {
  type: "credential.expired";
  credentialId: string;
  reason: string;
};

const _CredentialExpiredEvent = z
  .object({
    type: z.literal("credential.expired").describe("Event type discriminator"),
    credentialId: z.string().describe("Expired credential ID"),
    reason: z.string().describe("Why the credential expired"),
  })
  .describe("Credential has expired");

/** Zod schema for `credential.expired` events. */
export const CredentialExpiredEvent: z.ZodType<CredentialExpiredEvent> =
  _CredentialExpiredEvent;

/** Event emitted when a credential must be reauthorized after a material change. */
export type CredentialReauthRequiredEvent = {
  type: "credential.reauthorization_required";
  credentialId: string;
  reason: string;
};

const _CredentialReauthRequiredEvent = z
  .object({
    type: z
      .literal("credential.reauthorization_required")
      .describe("Event type discriminator"),
    credentialId: z.string().describe("Credential requiring reauthorization"),
    reason: z.string().describe("What policy change triggered reauthorization"),
  })
  .describe("Credential must be reauthorized due to material policy change");

/** Zod schema for `credential.reauthorization_required` events. */
export const CredentialReauthRequiredEvent: z.ZodType<CredentialReauthRequiredEvent> =
  _CredentialReauthRequiredEvent;

/** Liveness event emitted by the signet over active sockets. */
export type HeartbeatEvent = {
  type: "heartbeat";
  credentialId: string;
  timestamp: string;
};

const _HeartbeatEvent = z
  .object({
    type: z.literal("heartbeat").describe("Event type discriminator"),
    credentialId: z.string().describe("Credential this heartbeat is for"),
    timestamp: z.string().datetime().describe("Heartbeat timestamp"),
  })
  .describe("Liveness signal from the signet");

/** Zod schema for `heartbeat` events. */
export const HeartbeatEvent: z.ZodType<HeartbeatEvent> = _HeartbeatEvent;

/** Event emitted when previously hidden message content becomes available. */
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

/** Zod schema for `message.revealed` events. */
export const RevealEvent: z.ZodType<RevealEvent> = _RevealEvent;

/** Event emitted when permission scopes are updated for a credential. */
export type ScopesUpdatedEvent = {
  type: "scopes.updated";
  credentialId: string;
  permissions: ScopeSetType;
};

const _ScopesUpdatedEvent = z
  .object({
    type: z.literal("scopes.updated").describe("Event type discriminator"),
    credentialId: z.string().describe("Credential whose scopes changed"),
    permissions: ScopeSet.describe("Updated permission scope set"),
  })
  .describe("Permission scopes updated for a credential");

/** Zod schema for `scopes.updated` events. */
export const ScopesUpdatedEvent: z.ZodType<ScopesUpdatedEvent> =
  _ScopesUpdatedEvent;

/** Event emitted when an agent is revoked by a revocation seal. */
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

/** Zod schema for `agent.revoked` events. */
export const AgentRevokedEvent: z.ZodType<AgentRevokedEvent> =
  _AgentRevokedEvent;

/** Event emitted when owner confirmation is required before an action runs. */
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

/** Zod schema for `action.confirmation_required` events. */
export const ActionConfirmationEvent: z.ZodType<ActionConfirmationEvent> =
  _ActionConfirmationEvent;

/** Event emitted when a recovering client has caught up with replay state. */
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

/** Zod schema for `signet.recovery.complete` events. */
export const SignetRecoveryEvent: z.ZodType<SignetRecoveryEvent> =
  _SignetRecoveryEvent;

/** Union of all events the signet can emit to a harness session. */
export type SignetEvent =
  | MessageEvent
  | SealStampedEvent
  | CredentialIssuedEvent
  | CredentialExpiredEvent
  | CredentialReauthRequiredEvent
  | HeartbeatEvent
  | RevealEvent
  | ScopesUpdatedEvent
  | AgentRevokedEvent
  | ActionConfirmationEvent
  | SignetRecoveryEvent;

/** Discriminated union of all signet-to-harness events. */
export const SignetEvent: z.ZodType<SignetEvent> = z
  .discriminatedUnion("type", [
    _MessageEvent,
    _SealStampedEvent,
    _CredentialIssuedEvent,
    _CredentialExpiredEvent,
    _CredentialReauthRequiredEvent,
    _HeartbeatEvent,
    _RevealEvent,
    _ScopesUpdatedEvent,
    _AgentRevokedEvent,
    _ActionConfirmationEvent,
    _SignetRecoveryEvent,
  ])
  .describe("Any event the signet may send to a harness");
