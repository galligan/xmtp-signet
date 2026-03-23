import { describe, expect, test } from "bun:test";
import type { CredentialRecord } from "@xmtp/signet-contracts";
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

function makeCredentialRecord(
  overrides: Partial<CredentialRecord> = {},
): CredentialRecord {
  return {
    id: "cred_123",
    config: {
      operatorId: "operator_1",
      chatIds: ["g1"],
      allow: ["send", "read-messages", "stream-messages"],
      deny: [],
    },
    inboxIds: ["inbox_12345678feedbabe"],
    credentialId: "cred_123",
    operatorId: "operator_1",
    effectiveScopes: {
      allow: ["send", "read-messages", "stream-messages"],
      deny: [],
    },
    status: "active",
    issuedAt: "2024-01-01T00:00:00Z",
    expiresAt: "2024-01-02T00:00:00Z",
    issuedBy: "op_admin1234",
    isExpired: false,
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
  test("credential with read-messages scope passes messages through", () => {
    const store = makeRevealStore(false);
    const projector = createEventProjector(makeDeps(store));
    const credential = makeCredentialRecord();
    const event = makeMessageEvent({ content: "Secret message" });

    const result = projector(event, credential);

    expect(result).not.toBeNull();
    const msg = result as MessageEvent;
    expect(msg.type).toBe("message.visible");
  });

  test("credential with denied read-messages drops messages", () => {
    const store = makeRevealStore(false);
    const projector = createEventProjector(makeDeps(store));
    const credential = makeCredentialRecord({
      effectiveScopes: {
        allow: ["send"],
        deny: ["read-messages"],
      },
    });
    const event = makeMessageEvent({ content: "Secret message" });

    const result = projector(event, credential);

    expect(result).toBeNull();
  });

  test("revealed messages pass through even with limited scopes", () => {
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
    const credential = makeCredentialRecord({
      effectiveScopes: {
        allow: ["send", "read-messages"],
        deny: [],
      },
    });
    const event = makeMessageEvent({ content: "Now visible" });

    const result = projector(event, credential);

    expect(result).not.toBeNull();
    const msg = result as MessageEvent;
    expect(msg.type).toBe("message.visible");
  });
});
