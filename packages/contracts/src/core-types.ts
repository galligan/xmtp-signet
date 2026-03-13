import type { ContentTypeId } from "@xmtp-broker/schemas";
import type { SignerProvider } from "./providers.js";

/** Broker lifecycle states. */
export type CoreState =
  | "uninitialized"
  | "initializing"
  | "ready-local"
  | "ready"
  | "shutting-down"
  | "stopped"
  | "error";

/** Context object passed to handlers during broker operations. */
export interface CoreContext {
  readonly brokerId: string;
  readonly signerProvider: SignerProvider;
}

/** Broker-internal representation of a group's state. */
export interface GroupInfo {
  readonly groupId: string;
  readonly identityKeyFingerprint: string;
  readonly memberInboxIds: readonly string[];
  readonly createdAt: string;
}

/** Unfiltered message from the XMTP client. */
export interface RawMessage {
  readonly messageId: string;
  readonly groupId: string;
  readonly senderInboxId: string;
  readonly contentType: ContentTypeId;
  readonly content: unknown;
  readonly sentAt: string;
}

/** Union of raw XMTP events before view filtering. */
export type RawEvent =
  | {
      readonly type: "message";
      readonly message: RawMessage;
    }
  | {
      readonly type: "group.member_added";
      readonly groupId: string;
      readonly inboxId: string;
    }
  | {
      readonly type: "group.member_removed";
      readonly groupId: string;
      readonly inboxId: string;
    }
  | {
      readonly type: "group.metadata_updated";
      readonly groupId: string;
      readonly fields: Record<string, string>;
    };
