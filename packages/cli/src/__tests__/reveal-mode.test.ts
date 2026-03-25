import { describe, expect, test } from "bun:test";
import type { CredentialRecord } from "@xmtp/signet-contracts";
import type { MessageEvent } from "@xmtp/signet-schemas";
import { createRevealStateStore } from "@xmtp/signet-policy";
import {
  createEventProjector,
  type EventProjectorDeps,
} from "../ws/event-projector.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCredentialRecord(
  overrides: Partial<CredentialRecord> = {},
): CredentialRecord {
  return {
    id: "cred_reveal",
    config: {
      operatorId: "operator_1",
      chatIds: ["g1"],
      allow: ["send", "read-messages", "stream-messages"],
      deny: [],
    },
    inboxIds: ["inbox_reveal"],
    credentialId: "cred_reveal",
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

// ---------------------------------------------------------------------------
// Tests -- integration of event projector + reveal state store
// ---------------------------------------------------------------------------

describe("reveal mode integration", () => {
  test("credential without read-messages drops unrevealed messages", () => {
    const store = createRevealStateStore();
    const deps: EventProjectorDeps = {
      getRevealState: () => store,
    };
    const projector = createEventProjector(deps);
    const credential = makeCredentialRecord({
      effectiveScopes: {
        allow: ["send"],
        deny: ["read-messages"],
      },
    });
    const event = makeMessageEvent();

    const result = projector(event, credential);

    expect(result).toBeNull();
  });

  test("credential with read-messages passes revealed messages", () => {
    const store = createRevealStateStore();
    // Record reveal access for the sender
    store.record(
      {
        revealId: "rev_1",
        grantedAt: "2024-01-01T00:00:00Z",
        grantedBy: "owner_1",
        expiresAt: null,
      },
      {
        revealId: "rev_1",
        groupId: "g1",
        scope: "sender",
        targetId: "sender_1",
        requestedBy: "owner_1",
        expiresAt: null,
      },
    );

    const deps: EventProjectorDeps = {
      getRevealState: () => store,
    };
    const projector = createEventProjector(deps);
    const credential = makeCredentialRecord();
    const event = makeMessageEvent();

    const result = projector(event, credential);

    expect(result).not.toBeNull();
    const msg = result as MessageEvent;
    expect(msg.type).toBe("message.visible");
  });

  test("credential with full scopes passes events through", () => {
    const deps: EventProjectorDeps = {
      getRevealState: () => null,
    };
    const projector = createEventProjector(deps);
    const credential = makeCredentialRecord();
    const event = makeMessageEvent();

    const result = projector(event, credential);

    expect(result).not.toBeNull();
  });

  test("reveal access cycle: record passes, new store drops", () => {
    // Phase 1: record reveal access -> message passes
    const store1 = createRevealStateStore();
    store1.record(
      {
        revealId: "rev_2",
        grantedAt: "2024-01-01T00:00:00Z",
        grantedBy: "owner_1",
        expiresAt: null,
      },
      {
        revealId: "rev_2",
        groupId: "g1",
        scope: "sender",
        targetId: "sender_1",
        requestedBy: "owner_1",
        expiresAt: null,
      },
    );

    const deps1: EventProjectorDeps = {
      getRevealState: () => store1,
    };
    const projector1 = createEventProjector(deps1);
    const credential = makeCredentialRecord();
    const event = makeMessageEvent();

    const revealed = projector1(event, credential);
    expect(revealed).not.toBeNull();

    // Phase 2: credential without read-messages -> dropped
    const store2 = createRevealStateStore();
    const deps2: EventProjectorDeps = {
      getRevealState: () => store2,
    };
    const projector2 = createEventProjector(deps2);

    const credNoRead = makeCredentialRecord({
      effectiveScopes: {
        allow: ["send"],
        deny: ["read-messages"],
      },
    });

    const dropped = projector2(event, credNoRead);
    expect(dropped).toBeNull();
  });
});
