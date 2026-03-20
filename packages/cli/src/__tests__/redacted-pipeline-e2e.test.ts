import { describe, expect, test } from "bun:test";
import type { SessionRecord } from "@xmtp/signet-contracts";
import type { RevealStateStore } from "@xmtp/signet-contracts";
import { createRevealStateStore } from "@xmtp/signet-policy";
import type {
  MessageEvent,
  RevealGrant,
  RevealRequest,
} from "@xmtp/signet-schemas";
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
      mode: "redacted",
      threadScopes: [{ groupId: "g1", threadId: null }],
      contentTypes: ["xmtp.org/text:1.0"],
    },
    grant: {
      messaging: {
        send: true,
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

describe("redacted pipeline e2e", () => {
  test("redacted mode nulls content for unrevealed messages", () => {
    const store = makeRevealStore(false);
    const projector = createEventProjector(makeDeps(store));
    const session = makeSessionRecord({
      view: {
        mode: "redacted",
        threadScopes: [{ groupId: "g1", threadId: null }],
        contentTypes: ["xmtp.org/text:1.0"],
      },
    });
    const event = makeMessageEvent({ content: "Secret message" });

    const result = projector(event, session);

    expect(result).not.toBeNull();
    const msg = result as MessageEvent;
    expect(msg.visibility).toBe("redacted");
    expect(msg.content).toBeNull();
  });

  test("redacted mode preserves content for revealed messages", () => {
    const store = createRevealStateStore();
    const grant: RevealGrant = {
      revealId: "reveal_1",
      grantedAt: "2024-01-01T00:00:00Z",
      grantedBy: "owner_1",
      expiresAt: null,
    };
    const request: RevealRequest = {
      revealId: "reveal_1",
      groupId: "g1",
      scope: "message",
      targetId: "msg_1",
      requestedBy: "owner_1",
      expiresAt: null,
    };
    store.grant(grant, request);

    const projector = createEventProjector(makeDeps(store));
    const session = makeSessionRecord({
      view: {
        mode: "redacted",
        threadScopes: [{ groupId: "g1", threadId: null }],
        contentTypes: ["xmtp.org/text:1.0"],
      },
    });
    const event = makeMessageEvent({ content: "Now visible" });

    const result = projector(event, session);

    expect(result).not.toBeNull();
    const msg = result as MessageEvent;
    expect(msg.visibility).toBe("revealed");
    expect(msg.content).toBe("Now visible");
  });

  test("redacted mode drops messages outside thread scope", () => {
    const store = makeRevealStore(false);
    const projector = createEventProjector(makeDeps(store));
    const session = makeSessionRecord({
      view: {
        mode: "redacted",
        threadScopes: [{ groupId: "g1", threadId: "thread-42" }],
        contentTypes: ["xmtp.org/text:1.0"],
      },
    });
    const event = makeMessageEvent({ threadId: "other-thread" });

    const result = projector(event, session);

    expect(result).toBeNull();
  });

  test("redacted mode drops disallowed content types", () => {
    const store = makeRevealStore(false);
    const projector = createEventProjector(makeDeps(store));
    const session = makeSessionRecord({
      view: {
        mode: "redacted",
        threadScopes: [{ groupId: "g1", threadId: null }],
        contentTypes: ["xmtp.org/text:1.0"],
      },
    });
    const event = makeMessageEvent({
      contentType: "xmtp.org/reaction:1.0",
    });

    const result = projector(event, session);

    expect(result).toBeNull();
  });
});
