import { describe, expect, test } from "bun:test";
import type { SessionRecord } from "@xmtp/signet-contracts";
import type { RevealStateStore } from "@xmtp/signet-contracts";
import type { SignetEvent, MessageEvent } from "@xmtp/signet-schemas";
import {
  createEventProjector,
  type EventProjectorDeps,
} from "../ws/event-projector.js";

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

function makeMessageEvent(overrides: Partial<MessageEvent> = {}): MessageEvent {
  return {
    type: "message.visible",
    messageId: "msg_1",
    groupId: "g1",
    senderInboxId: "sender_1",
    contentType: "xmtp.org/text:1.0",
    content: "Hello world",
    visibility: "visible",
    sentAt: "2024-01-01T00:00:00Z",
    sealId: null,
    threadId: null,
    ...overrides,
  };
}

function makeRevealStore(revealed: boolean): RevealStateStore {
  return {
    grant: () => {},
    isRevealed: () => revealed,
    expireStale: () => 0,
    snapshot: () => ({ activeReveals: [] }),
    restore: () => {},
  };
}

function makeDeps(store: RevealStateStore | null = null): EventProjectorDeps {
  return {
    getRevealState: () => store,
  };
}

describe("createEventProjector", () => {
  describe("full mode", () => {
    test("passes message events through unchanged", () => {
      const projector = createEventProjector(makeDeps());
      const session = makeSessionRecord({
        view: {
          mode: "full",
          threadScopes: [{ groupId: "g1", threadId: null }],
          contentTypes: ["xmtp.org/text:1.0"],
        },
      });
      const event = makeMessageEvent();

      const result = projector(event, session);

      expect(result).not.toBeNull();
      expect(result).toEqual(event);
    });
  });

  describe("reveal-only mode", () => {
    test("drops message events when not revealed", () => {
      const store = makeRevealStore(false);
      const projector = createEventProjector(makeDeps(store));
      const session = makeSessionRecord({
        view: {
          mode: "reveal-only",
          threadScopes: [{ groupId: "g1", threadId: null }],
          contentTypes: ["xmtp.org/text:1.0"],
        },
      });
      const event = makeMessageEvent();

      const result = projector(event, session);

      expect(result).toBeNull();
    });

    test("passes message events when revealed with visibility 'revealed'", () => {
      const store = makeRevealStore(true);
      const projector = createEventProjector(makeDeps(store));
      const session = makeSessionRecord({
        view: {
          mode: "reveal-only",
          threadScopes: [{ groupId: "g1", threadId: null }],
          contentTypes: ["xmtp.org/text:1.0"],
        },
      });
      const event = makeMessageEvent();

      const result = projector(event, session);

      expect(result).not.toBeNull();
      const msg = result as MessageEvent;
      expect(msg.type).toBe("message.visible");
      expect(msg.visibility).toBe("revealed");
      expect(msg.content).toBe("Hello world");
    });
  });

  describe("redacted mode", () => {
    test("passes message events with content null when not revealed", () => {
      const store = makeRevealStore(false);
      const projector = createEventProjector(makeDeps(store));
      const session = makeSessionRecord({
        view: {
          mode: "redacted",
          threadScopes: [{ groupId: "g1", threadId: null }],
          contentTypes: ["xmtp.org/text:1.0"],
        },
      });
      const event = makeMessageEvent();

      const result = projector(event, session);

      expect(result).not.toBeNull();
      const msg = result as MessageEvent;
      expect(msg.type).toBe("message.visible");
      expect(msg.visibility).toBe("redacted");
      expect(msg.content).toBeNull();
    });
  });

  describe("non-message events", () => {
    test("passes heartbeat events through regardless of mode", () => {
      const store = makeRevealStore(false);
      const projector = createEventProjector(makeDeps(store));
      const session = makeSessionRecord({
        view: {
          mode: "reveal-only",
          threadScopes: [{ groupId: "g1", threadId: null }],
          contentTypes: ["xmtp.org/text:1.0"],
        },
      });
      const heartbeat: SignetEvent = {
        type: "heartbeat",
        sessionId: "sess_123",
        timestamp: "2024-01-01T00:00:00Z",
      };

      const result = projector(heartbeat, session);

      expect(result).toEqual(heartbeat);
    });

    test("passes session.expired events through regardless of mode", () => {
      const store = makeRevealStore(false);
      const projector = createEventProjector(makeDeps(store));
      const session = makeSessionRecord({
        view: {
          mode: "reveal-only",
          threadScopes: [{ groupId: "g1", threadId: null }],
          contentTypes: ["xmtp.org/text:1.0"],
        },
      });
      const expired: SignetEvent = {
        type: "session.expired",
        sessionId: "sess_123",
        reason: "timeout",
      };

      const result = projector(expired, session);

      expect(result).toEqual(expired);
    });
  });

  describe("thread-scoped filtering", () => {
    test("passes message with matching threadId through thread-scoped session", () => {
      const store = makeRevealStore(false);
      const projector = createEventProjector(makeDeps(store));
      const session = makeSessionRecord({
        view: {
          mode: "full",
          threadScopes: [{ groupId: "g1", threadId: "thread-42" }],
          contentTypes: ["xmtp.org/text:1.0"],
        },
      });
      const event = makeMessageEvent({ threadId: "thread-42" });
      const result = projector(event, session);
      expect(result).not.toBeNull();
    });

    test("drops message with non-matching threadId in thread-scoped session", () => {
      const store = makeRevealStore(false);
      const projector = createEventProjector(makeDeps(store));
      const session = makeSessionRecord({
        view: {
          mode: "full",
          threadScopes: [{ groupId: "g1", threadId: "thread-42" }],
          contentTypes: ["xmtp.org/text:1.0"],
        },
      });
      const event = makeMessageEvent({ threadId: "other-thread" });
      const result = projector(event, session);
      expect(result).toBeNull();
    });

    test("drops message with null threadId in thread-scoped session", () => {
      const store = makeRevealStore(false);
      const projector = createEventProjector(makeDeps(store));
      const session = makeSessionRecord({
        view: {
          mode: "full",
          threadScopes: [{ groupId: "g1", threadId: "thread-42" }],
          contentTypes: ["xmtp.org/text:1.0"],
        },
      });
      const event = makeMessageEvent({ threadId: null });
      const result = projector(event, session);
      expect(result).toBeNull();
    });

    test("passes message with any threadId through group-scoped session (threadId: null)", () => {
      const store = makeRevealStore(false);
      const projector = createEventProjector(makeDeps(store));
      const session = makeSessionRecord({
        view: {
          mode: "full",
          threadScopes: [{ groupId: "g1", threadId: null }],
          contentTypes: ["xmtp.org/text:1.0"],
        },
      });
      const event = makeMessageEvent({ threadId: "any-thread" });
      const result = projector(event, session);
      expect(result).not.toBeNull();
    });

    test("projected event carries threadId through to output", () => {
      const store = makeRevealStore(false);
      const projector = createEventProjector(makeDeps(store));
      const session = makeSessionRecord({
        view: {
          mode: "full",
          threadScopes: [{ groupId: "g1", threadId: null }],
          contentTypes: ["xmtp.org/text:1.0"],
        },
      });
      const event = makeMessageEvent({ threadId: "thread-99" });
      const result = projector(event, session);
      expect(result).not.toBeNull();
      expect((result as MessageEvent).threadId).toBe("thread-99");
    });
  });

  describe("missing reveal store", () => {
    test("treats messages as not revealed when store is null", () => {
      const projector = createEventProjector(makeDeps(null));
      const session = makeSessionRecord({
        view: {
          mode: "reveal-only",
          threadScopes: [{ groupId: "g1", threadId: null }],
          contentTypes: ["xmtp.org/text:1.0"],
        },
      });
      const event = makeMessageEvent();

      const result = projector(event, session);

      expect(result).toBeNull();
    });
  });
});
