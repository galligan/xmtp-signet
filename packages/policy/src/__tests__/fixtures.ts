import type {
  ContentTypeId,
  ViewConfig,
  GrantConfig,
} from "@xmtp/signet-schemas";
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

/** Creates a minimal ViewConfig that passes all messages. */
export function createPassthroughView(groupId: string): ViewConfig {
  return {
    mode: "full",
    threadScopes: [{ groupId, threadId: null }],
    contentTypes: [
      "xmtp.org/text:1.0" as ContentTypeId,
      "xmtp.org/reaction:1.0" as ContentTypeId,
      "xmtp.org/reply:1.0" as ContentTypeId,
      "xmtp.org/readReceipt:1.0" as ContentTypeId,
      "xmtp.org/groupUpdated:1.0" as ContentTypeId,
    ],
  };
}

/** Creates a GrantConfig with all permissions enabled. */
export function createFullGrant(): GrantConfig {
  return {
    messaging: {
      send: true,
      reply: true,
      react: true,
      draftOnly: false,
    },
    groupManagement: {
      addMembers: true,
      removeMembers: true,
      updateMetadata: true,
      inviteUsers: true,
    },
    tools: {
      scopes: [],
    },
    egress: {
      storeExcerpts: true,
      useForMemory: true,
      forwardToProviders: true,
      quoteRevealed: true,
      summarize: true,
    },
  };
}

/** Creates a GrantConfig with all permissions denied. */
export function createDenyAllGrant(): GrantConfig {
  return {
    messaging: {
      send: false,
      reply: false,
      react: false,
      draftOnly: false,
    },
    groupManagement: {
      addMembers: false,
      removeMembers: false,
      updateMetadata: false,
      inviteUsers: false,
    },
    tools: {
      scopes: [],
    },
    egress: {
      storeExcerpts: false,
      useForMemory: false,
      forwardToProviders: false,
      quoteRevealed: false,
      summarize: false,
    },
  };
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
