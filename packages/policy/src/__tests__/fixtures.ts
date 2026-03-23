import type { ContentTypeId } from "@xmtp/signet-schemas";
import type { RevealStateSnapshot } from "../reveal-state.js";
import type { RawMessage, SignetContentTypeConfig } from "../types.js";

/** Creates a RawMessage fixture. */
export function createTestRawMessage(
  overrides?: Partial<RawMessage>,
): RawMessage {
  return {
    messageId: "msg-1",
    groupId: "group-1",
    senderInboxId: "sender-1",
    contentType: "xmtp.org/text:1.0" as ContentTypeId,
    content: { text: "hello" },
    sentAt: "2024-01-01T00:00:00Z",
    threadId: null,
    sealId: null,
    ...overrides,
  };
}

/** Creates a resolved scope set with all common scopes allowed. */
export function createFullScopes(): ReadonlySet<string> {
  return new Set([
    "send",
    "reply",
    "react",
    "read-receipt",
    "attachment",
    "add-member",
    "remove-member",
    "promote-admin",
    "demote-admin",
    "update-permission",
    "update-name",
    "update-description",
    "update-image",
    "invite",
    "join",
    "leave",
    "create-group",
    "create-dm",
    "read-messages",
    "read-history",
    "list-members",
    "list-conversations",
    "read-permissions",
    "stream-messages",
    "stream-conversations",
    "forward-to-provider",
    "store-excerpts",
    "use-for-memory",
    "quote-revealed",
    "summarize",
  ]);
}

/** Creates a resolved scope set with no scopes allowed. */
export function createEmptyScopes(): ReadonlySet<string> {
  return new Set();
}

/** Creates a chatIds array containing the given chat IDs. */
export function createChatIds(...chatIds: string[]): readonly string[] {
  return chatIds;
}

/** Creates a signet content type config with all baseline types. */
export function createBaselineSignetConfig(): SignetContentTypeConfig {
  return {
    allowlist: new Set([
      "xmtp.org/text:1.0" as ContentTypeId,
      "xmtp.org/reaction:1.0" as ContentTypeId,
      "xmtp.org/reply:1.0" as ContentTypeId,
      "xmtp.org/readReceipt:1.0" as ContentTypeId,
      "xmtp.org/groupUpdated:1.0" as ContentTypeId,
    ]),
  };
}

/** Creates an empty RevealStateSnapshot. */
export function createEmptyRevealState(): RevealStateSnapshot {
  return { activeReveals: [] };
}
