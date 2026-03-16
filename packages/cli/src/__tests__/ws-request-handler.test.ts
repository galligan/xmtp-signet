import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import type { SessionRecord } from "@xmtp-broker/contracts";
import type { HarnessRequest } from "@xmtp-broker/schemas";
import { AuthError, PermissionError } from "@xmtp-broker/schemas";
import { createWsRequestHandler } from "../ws/request-handler.js";

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
});
