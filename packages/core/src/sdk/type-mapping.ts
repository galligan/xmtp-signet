import type {
  XmtpGroupInfo,
  XmtpDecodedMessage,
} from "../xmtp-client-factory.js";

/**
 * Shape of an SDK Group needed for type mapping.
 * Uses structural typing to avoid importing SDK types directly.
 */
export interface GroupLike {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly createdAtNs: bigint;
}

/**
 * Shape of an SDK GroupMember needed for type mapping.
 */
export interface GroupMemberLike {
  readonly inboxId: string;
}

/**
 * Shape of an SDK DecodedMessage needed for type mapping.
 */
export interface DecodedMessageLike {
  readonly id: string;
  readonly conversationId: string;
  readonly senderInboxId: string;
  readonly contentType?: { readonly typeId?: string } | undefined;
  readonly content: unknown;
  readonly sentAt: Date;
  readonly sentAtNs: bigint;
}

/** Convert an SDK group + members to signet XmtpGroupInfo. */
export function toGroupInfo(
  group: GroupLike,
  members: readonly GroupMemberLike[],
): XmtpGroupInfo {
  return {
    groupId: group.id,
    name: group.name,
    description: group.description,
    memberInboxIds: members.map((m) => m.inboxId),
    createdAt: new Date(Number(group.createdAtNs / 1_000_000n)).toISOString(),
  };
}

/**
 * Extract thread anchor ID from Reply content type.
 * A Reply's referenceId points to the root message — this serves as
 * the thread ID for scope filtering and reveal matching.
 */
function extractThreadId(content: unknown): string | null {
  if (
    typeof content === "object" &&
    content !== null &&
    "reference" in content &&
    typeof (content as Record<string, unknown>)["reference"] === "string"
  ) {
    return (content as Record<string, unknown>)["reference"] as string;
  }
  return null;
}

/** Convert an SDK DecodedMessage to signet XmtpDecodedMessage. */
export function toDecodedMessage(msg: DecodedMessageLike): XmtpDecodedMessage {
  const contentType = msg.contentType?.typeId ?? "unknown";
  return {
    messageId: msg.id,
    groupId: msg.conversationId,
    senderInboxId: msg.senderInboxId,
    contentType,
    content: msg.content,
    sentAt: msg.sentAt.toISOString(),
    threadId: extractThreadId(msg.content),
  };
}
