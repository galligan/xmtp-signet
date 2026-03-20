import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import type { SessionRecord } from "@xmtp/signet-contracts";
import type {
  HarnessRequest,
  RevealEvent,
  SignetEvent,
} from "@xmtp/signet-schemas";
import {
  AuthError,
  NotFoundError,
  PermissionError,
} from "@xmtp/signet-schemas";
import { createWsRequestHandler } from "../ws/request-handler.js";
import type { ReplayMessage } from "../ws/request-handler.js";
import { createPendingActionStore } from "@xmtp/signet-sessions";
import { createRevealStateStore } from "@xmtp/signet-policy";

function makeSessionRecord(
  overrides: Partial<SessionRecord> = {},
): SessionRecord {
  return {
    sessionId: "sess_123",
    agentInboxId: "agent_1",
    sessionKeyFingerprint: "fp_abc",
    view: {
      mode: "full",
      threadScopes: [{ groupId: "g1", threadId: null }],
      contentTypes: ["xmtp.org/text:1.0"],
    },
    grant: {
      messaging: { send: true, reply: false, react: false, draftOnly: false },
      groupManagement: {
        addMembers: false,
        removeMembers: false,
        updateMetadata: false,
        inviteUsers: false,
      },
      tools: { scopes: [] },
      egress: {
        storeExcerpts: false,
        useForMemory: false,
        forwardToProviders: false,
        quoteRevealed: false,
        summarize: false,
      },
    },
    state: "active",
    issuedAt: "2024-01-01T00:00:00Z",
    expiresAt: "2024-01-02T00:00:00Z",
    lastHeartbeat: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("createWsRequestHandler", () => {
  test("sends allowed messages after ensuring the core is ready", async () => {
    const calls: string[] = [];
    const handler = createWsRequestHandler({
      ensureCoreReady: async () => {
        calls.push("ensureCoreReady");
        return Result.ok(undefined);
      },
      sendMessage: async (groupId, contentType, content) => {
        calls.push(`send:${groupId}:${contentType}:${JSON.stringify(content)}`);
        return Result.ok({ messageId: "msg_1" });
      },
      sessionManager: {
        heartbeat: async () => Result.ok(undefined),
      },
    });

    const request: HarnessRequest = {
      type: "send_message",
      requestId: "req_1",
      groupId: "g1",
      contentType: "xmtp.org/text:1.0",
      content: { text: "hello" },
    };

    const result = await handler(request, makeSessionRecord());

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ messageId: "msg_1" });
    }
    expect(calls).toEqual([
      "ensureCoreReady",
      'send:g1:xmtp.org/text:1.0:{"text":"hello"}',
    ]);
  });

  test("rejects heartbeats whose session id does not match the authenticated session", async () => {
    const heartbeatCalls: string[] = [];
    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => Result.ok({ messageId: "unused" }),
      sessionManager: {
        heartbeat: async (sessionId: string) => {
          heartbeatCalls.push(sessionId);
          return Result.ok(undefined);
        },
      },
    });

    const request: HarnessRequest = {
      type: "heartbeat",
      requestId: "req_2",
      sessionId: "spoofed_session",
    };

    const result = await handler(request, makeSessionRecord());

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(AuthError);
      expect(result.error.category).toBe("auth");
    }
    expect(heartbeatCalls).toEqual([]);
  });

  test("records heartbeat for the authenticated session", async () => {
    const heartbeatCalls: string[] = [];
    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => Result.ok({ messageId: "unused" }),
      sessionManager: {
        heartbeat: async (sessionId: string) => {
          heartbeatCalls.push(sessionId);
          return Result.ok(undefined);
        },
      },
    });

    const request: HarnessRequest = {
      type: "heartbeat",
      requestId: "req_2b",
      sessionId: "sess_123",
    };

    const result = await handler(request, makeSessionRecord());

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBeNull();
    }
    expect(heartbeatCalls).toEqual(["sess_123"]);
  });

  test("rejects content types outside the session view", async () => {
    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => Result.ok({ messageId: "msg_1" }),
      sessionManager: {
        heartbeat: async () => Result.ok(undefined),
      },
    });

    const request: HarnessRequest = {
      type: "send_message",
      requestId: "req_3",
      groupId: "g1",
      contentType: "xmtp.org/reaction:1.0",
      content: { emoji: ":+1:" },
    };

    const result = await handler(request, makeSessionRecord());

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(PermissionError);
      expect(result.error.category).toBe("permission");
    }
  });

  test("rejects unsupported request types for Phase 2B", async () => {
    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => Result.ok({ messageId: "msg_1" }),
      sessionManager: {
        heartbeat: async () => Result.ok(undefined),
      },
    });

    const request: HarnessRequest = {
      type: "send_reply",
      requestId: "req_4",
      groupId: "g1",
      messageId: "msg_parent",
      contentType: "xmtp.org/text:1.0",
      content: { text: "reply" },
    };

    const result = await handler(request, makeSessionRecord());

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("not supported");
    }
  });

  test("queues pending action for draftOnly sessions instead of rejecting", async () => {
    const broadcastedEvents: { sessionId: string; event: SignetEvent }[] = [];
    const pendingActions = createPendingActionStore();

    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => Result.ok({ messageId: "msg_1" }),
      sessionManager: {
        heartbeat: async () => Result.ok(undefined),
      },
      pendingActions,
      broadcast: (sessionId, event) => {
        broadcastedEvents.push({ sessionId, event });
      },
    });

    const session = makeSessionRecord({
      grant: {
        messaging: { send: true, reply: false, react: false, draftOnly: true },
        groupManagement: {
          addMembers: false,
          removeMembers: false,
          updateMetadata: false,
          inviteUsers: false,
        },
        tools: { scopes: [] },
        egress: {
          storeExcerpts: false,
          useForMemory: false,
          forwardToProviders: false,
          quoteRevealed: false,
          summarize: false,
        },
      },
    });

    const request: HarnessRequest = {
      type: "send_message",
      requestId: "req_draft",
      groupId: "g1",
      contentType: "xmtp.org/text:1.0",
      content: { text: "draft message" },
    };

    const result = await handler(request, session);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const data = result.value as { pending: boolean; actionId: string };
      expect(data.pending).toBe(true);
      expect(typeof data.actionId).toBe("string");

      // Verify action was stored
      const stored = pendingActions.get(data.actionId);
      expect(stored).not.toBeNull();
      expect(stored?.actionType).toBe("send_message");
      expect(stored?.sessionId).toBe("sess_123");
    }

    // Verify broadcast was called with confirmation event
    expect(broadcastedEvents).toHaveLength(1);
    expect(broadcastedEvents[0]?.event.type).toBe(
      "action.confirmation_required",
    );
  });

  test("confirm_action executes the pending action when confirmed", async () => {
    const sendCalls: string[] = [];
    const pendingActions = createPendingActionStore();

    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async (groupId, contentType, _content) => {
        sendCalls.push(`send:${groupId}:${contentType}`);
        return Result.ok({ messageId: "msg_confirmed" });
      },
      sessionManager: {
        heartbeat: async () => Result.ok(undefined),
      },
      pendingActions,
      broadcast: () => {},
    });

    // Pre-populate a pending action
    pendingActions.add({
      actionId: "act_confirm_1",
      sessionId: "sess_123",
      actionType: "send_message",
      payload: {
        groupId: "g1",
        contentType: "xmtp.org/text:1.0",
        content: { text: "hello" },
      },
      createdAt: "2024-01-01T00:00:00Z",
      expiresAt: "2099-01-01T00:05:00Z",
    });

    const request: HarnessRequest = {
      type: "confirm_action",
      requestId: "req_confirm",
      actionId: "act_confirm_1",
      confirmed: true,
    };

    const result = await handler(request, makeSessionRecord());

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ messageId: "msg_confirmed" });
    }
    expect(sendCalls).toEqual(["send:g1:xmtp.org/text:1.0"]);

    // Action should be removed from store
    expect(pendingActions.get("act_confirm_1")).toBeNull();
  });

  test("confirm_action discards the pending action when denied", async () => {
    const sendCalls: string[] = [];
    const pendingActions = createPendingActionStore();

    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => {
        sendCalls.push("send");
        return Result.ok({ messageId: "unused" });
      },
      sessionManager: {
        heartbeat: async () => Result.ok(undefined),
      },
      pendingActions,
      broadcast: () => {},
    });

    pendingActions.add({
      actionId: "act_deny_1",
      sessionId: "sess_123",
      actionType: "send_message",
      payload: {
        groupId: "g1",
        contentType: "xmtp.org/text:1.0",
        content: { text: "hello" },
      },
      createdAt: "2024-01-01T00:00:00Z",
      expiresAt: "2099-01-01T00:05:00Z",
    });

    const request: HarnessRequest = {
      type: "confirm_action",
      requestId: "req_deny",
      actionId: "act_deny_1",
      confirmed: false,
    };

    const result = await handler(request, makeSessionRecord());

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ denied: true, actionId: "act_deny_1" });
    }
    expect(sendCalls).toEqual([]);
    expect(pendingActions.get("act_deny_1")).toBeNull();
  });

  test("confirm_action returns not_found for unknown actionId", async () => {
    const pendingActions = createPendingActionStore();

    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => Result.ok({ messageId: "unused" }),
      sessionManager: {
        heartbeat: async () => Result.ok(undefined),
      },
      pendingActions,
      broadcast: () => {},
    });

    const request: HarnessRequest = {
      type: "confirm_action",
      requestId: "req_missing",
      actionId: "nonexistent",
      confirmed: true,
    };

    const result = await handler(request, makeSessionRecord());

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(NotFoundError);
      expect(result.error.category).toBe("not_found");
    }
  });

  test("confirm_action rejects when session does not match pending action", async () => {
    const pendingActions = createPendingActionStore();

    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => Result.ok({ messageId: "unused" }),
      sessionManager: {
        heartbeat: async () => Result.ok(undefined),
      },
      pendingActions,
      broadcast: () => {},
    });

    pendingActions.add({
      actionId: "act_other",
      sessionId: "sess_other",
      actionType: "send_message",
      payload: {},
      createdAt: "2024-01-01T00:00:00Z",
      expiresAt: "2099-01-01T00:05:00Z",
    });

    const request: HarnessRequest = {
      type: "confirm_action",
      requestId: "req_mismatch",
      actionId: "act_other",
      confirmed: true,
    };

    const result = await handler(request, makeSessionRecord());

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(PermissionError);
    }
  });

  test("reveal_content replays historical messages as message.revealed events", async () => {
    const revealStore = createRevealStateStore();
    const broadcastedEvents: {
      sessionId: string;
      event: SignetEvent;
    }[] = [];

    const messages: readonly ReplayMessage[] = [
      {
        messageId: "msg_1",
        groupId: "g1",
        senderInboxId: "sender_a",
        contentType: "xmtp.org/text:1.0",
        content: { text: "hello" },
        sentAt: "2024-01-01T00:01:00Z",
        threadId: "thread_1",
      },
      {
        messageId: "msg_2",
        groupId: "g1",
        senderInboxId: "sender_b",
        contentType: "xmtp.org/text:1.0",
        content: { text: "world" },
        sentAt: "2024-01-01T00:02:00Z",
        threadId: "thread_1",
      },
    ];

    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => Result.ok({ messageId: "unused" }),
      sessionManager: {
        heartbeat: async () => Result.ok(undefined),
        getRevealState: () => Result.ok(revealStore),
      },
      broadcast: (sessionId, event) => {
        broadcastedEvents.push({ sessionId, event });
      },
      listMessages: async () => Result.ok(messages),
    });

    const request: HarnessRequest = {
      type: "reveal_content",
      requestId: "req_reveal_1",
      reveal: {
        revealId: "rev_1",
        groupId: "g1",
        scope: "thread",
        targetId: "thread_1",
        requestedBy: "owner_1",
        expiresAt: null,
      },
    };

    const result = await handler(request, makeSessionRecord());

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const grant = result.value as { revealId: string };
      expect(grant.revealId).toBe("rev_1");
    }

    // Both messages should be revealed via broadcast
    expect(broadcastedEvents).toHaveLength(2);
    for (const entry of broadcastedEvents) {
      expect(entry.sessionId).toBe("sess_123");
      expect(entry.event.type).toBe("message.revealed");
    }

    const first = broadcastedEvents[0]?.event as RevealEvent;
    expect(first.messageId).toBe("msg_1");
    expect(first.revealId).toBe("rev_1");
    expect(first.content).toEqual({ text: "hello" });

    const second = broadcastedEvents[1]?.event as RevealEvent;
    expect(second.messageId).toBe("msg_2");
    expect(second.revealId).toBe("rev_1");
  });

  test("reveal_content skips replay when listMessages is not provided", async () => {
    const revealStore = createRevealStateStore();
    const broadcastedEvents: {
      sessionId: string;
      event: SignetEvent;
    }[] = [];

    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => Result.ok({ messageId: "unused" }),
      sessionManager: {
        heartbeat: async () => Result.ok(undefined),
        getRevealState: () => Result.ok(revealStore),
      },
      broadcast: (sessionId, event) => {
        broadcastedEvents.push({ sessionId, event });
      },
    });

    const request: HarnessRequest = {
      type: "reveal_content",
      requestId: "req_reveal_2",
      reveal: {
        revealId: "rev_2",
        groupId: "g1",
        scope: "message",
        targetId: "msg_1",
        requestedBy: "owner_1",
        expiresAt: null,
      },
    };

    const result = await handler(request, makeSessionRecord());

    expect(result.isOk()).toBe(true);
    // No broadcast since listMessages is not wired
    expect(broadcastedEvents).toHaveLength(0);
  });

  test("reveal_content filters out replayed messages with disallowed content types", async () => {
    const revealStore = createRevealStateStore();
    const broadcastedEvents: {
      sessionId: string;
      event: SignetEvent;
    }[] = [];

    const messages: readonly ReplayMessage[] = [
      {
        messageId: "msg_text",
        groupId: "g1",
        senderInboxId: "sender_a",
        contentType: "xmtp.org/text:1.0",
        content: { text: "allowed" },
        sentAt: "2024-01-01T00:01:00Z",
        threadId: null,
      },
      {
        messageId: "msg_reaction",
        groupId: "g1",
        senderInboxId: "sender_a",
        contentType: "xmtp.org/reaction:1.0",
        content: { emoji: ":+1:" },
        sentAt: "2024-01-01T00:02:00Z",
        threadId: null,
      },
    ];

    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => Result.ok({ messageId: "unused" }),
      sessionManager: {
        heartbeat: async () => Result.ok(undefined),
        getRevealState: () => Result.ok(revealStore),
      },
      broadcast: (sessionId, event) => {
        broadcastedEvents.push({ sessionId, event });
      },
      listMessages: async () => Result.ok(messages),
    });

    // Use sender scope to reveal all messages from sender_a.
    // Session only allows text content type, so reaction should be filtered.
    const request: HarnessRequest = {
      type: "reveal_content",
      requestId: "req_reveal_filter",
      reveal: {
        revealId: "rev_filter",
        groupId: "g1",
        scope: "sender",
        targetId: "sender_a",
        requestedBy: "owner_1",
        expiresAt: null,
      },
    };

    const result = await handler(request, makeSessionRecord());

    expect(result.isOk()).toBe(true);
    // Only the text message should be broadcast; the reaction is filtered
    expect(broadcastedEvents).toHaveLength(1);
    const revealed = broadcastedEvents[0]?.event as RevealEvent;
    expect(revealed.messageId).toBe("msg_text");
    expect(revealed.contentType).toBe("xmtp.org/text:1.0");
  });

  test("reveal_content filters out replayed messages outside thread scope", async () => {
    const revealStore = createRevealStateStore();
    const broadcastedEvents: {
      sessionId: string;
      event: SignetEvent;
    }[] = [];

    const messages: readonly ReplayMessage[] = [
      {
        messageId: "msg_in_scope",
        groupId: "g1",
        senderInboxId: "sender_a",
        contentType: "xmtp.org/text:1.0",
        content: { text: "in scope" },
        sentAt: "2024-01-01T00:01:00Z",
        threadId: "thread_allowed",
      },
      {
        messageId: "msg_out_scope",
        groupId: "g1",
        senderInboxId: "sender_a",
        contentType: "xmtp.org/text:1.0",
        content: { text: "out of scope" },
        sentAt: "2024-01-01T00:02:00Z",
        threadId: "thread_not_allowed",
      },
    ];

    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => Result.ok({ messageId: "unused" }),
      sessionManager: {
        heartbeat: async () => Result.ok(undefined),
        getRevealState: () => Result.ok(revealStore),
      },
      broadcast: (sessionId, event) => {
        broadcastedEvents.push({ sessionId, event });
      },
      listMessages: async () => Result.ok(messages),
    });

    // Session scoped to a specific thread. Use sender scope to reveal
    // all messages from sender_a; thread scope filter should drop the
    // message in thread_not_allowed.
    const session = makeSessionRecord({
      view: {
        mode: "full",
        threadScopes: [{ groupId: "g1", threadId: "thread_allowed" }],
        contentTypes: ["xmtp.org/text:1.0"],
      },
    });

    const request: HarnessRequest = {
      type: "reveal_content",
      requestId: "req_reveal_scope",
      reveal: {
        revealId: "rev_scope",
        groupId: "g1",
        scope: "sender",
        targetId: "sender_a",
        requestedBy: "owner_1",
        expiresAt: null,
      },
    };

    const result = await handler(request, session);

    expect(result.isOk()).toBe(true);
    // Only in-scope thread message should be broadcast
    expect(broadcastedEvents).toHaveLength(1);
    const revealed = broadcastedEvents[0]?.event as RevealEvent;
    expect(revealed.messageId).toBe("msg_in_scope");
  });

  test("reveal_content only replays messages matching the reveal scope", async () => {
    const revealStore = createRevealStateStore();
    const broadcastedEvents: {
      sessionId: string;
      event: SignetEvent;
    }[] = [];

    const messages: readonly ReplayMessage[] = [
      {
        messageId: "msg_target",
        groupId: "g1",
        senderInboxId: "sender_a",
        contentType: "xmtp.org/text:1.0",
        content: { text: "revealed" },
        sentAt: "2024-01-01T00:01:00Z",
        threadId: null,
      },
      {
        messageId: "msg_other",
        groupId: "g1",
        senderInboxId: "sender_b",
        contentType: "xmtp.org/text:1.0",
        content: { text: "not revealed" },
        sentAt: "2024-01-01T00:02:00Z",
        threadId: null,
      },
    ];

    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => Result.ok({ messageId: "unused" }),
      sessionManager: {
        heartbeat: async () => Result.ok(undefined),
        getRevealState: () => Result.ok(revealStore),
      },
      broadcast: (sessionId, event) => {
        broadcastedEvents.push({ sessionId, event });
      },
      listMessages: async () => Result.ok(messages),
    });

    // Reveal only a single message by ID
    const request: HarnessRequest = {
      type: "reveal_content",
      requestId: "req_reveal_3",
      reveal: {
        revealId: "rev_3",
        groupId: "g1",
        scope: "message",
        targetId: "msg_target",
        requestedBy: "owner_1",
        expiresAt: null,
      },
    };

    const result = await handler(request, makeSessionRecord());

    expect(result.isOk()).toBe(true);
    // Only the targeted message should be revealed
    expect(broadcastedEvents).toHaveLength(1);
    const revealed = broadcastedEvents[0]?.event as RevealEvent;
    expect(revealed.messageId).toBe("msg_target");
    expect(revealed.revealId).toBe("rev_3");
  });
});
