/**
 * Internal raw event types emitted by SignetCore.
 *
 * These are unfiltered events from the XMTP client, before any policy
 * filtering. They carry enough metadata for the policy engine to apply
 * views and grants. They are plain TypeScript interfaces, not Zod schemas,
 * because they never cross a serialization boundary.
 */

/** Raw message received from XMTP, before any policy filtering. */
export interface RawMessageEvent {
  readonly type: "raw.message";
  readonly messageId: string;
  readonly groupId: string;
  readonly senderInboxId: string;
  readonly contentType: string;
  readonly content: unknown;
  readonly sentAt: string;
  /** Thread anchor ID — derived from Reply referenceId. Null for non-reply messages. */
  readonly threadId: string | null;
  /** True if this message was received during recovery sync. */
  readonly isHistorical: boolean;
}

/** A new group was discovered (joined or created). */
export interface RawGroupJoinedEvent {
  readonly type: "raw.group.joined";
  readonly groupId: string;
  readonly groupName: string;
}

/** Group membership changed. */
export interface RawGroupUpdatedEvent {
  readonly type: "raw.group.updated";
  readonly groupId: string;
  readonly update: unknown;
}

/** Core lifecycle: started. */
export interface RawCoreStartedEvent {
  readonly type: "raw.core.started";
  readonly identityCount: number;
  readonly syncedThrough: string;
}

/** Core lifecycle: stopped. */
export interface RawCoreStoppedEvent {
  readonly type: "raw.core.stopped";
  readonly reason: string;
}

/** Core heartbeat. */
export interface RawHeartbeatEvent {
  readonly type: "raw.heartbeat";
  readonly timestamp: string;
}

/** Union of all raw events emitted by the core. */
export type CoreRawEvent =
  | RawMessageEvent
  | RawGroupJoinedEvent
  | RawGroupUpdatedEvent
  | RawCoreStartedEvent
  | RawCoreStoppedEvent
  | RawHeartbeatEvent;

/** Handler function for raw events. */
export type RawEventHandler = (event: CoreRawEvent) => void;
