import { describe, expect, test } from "bun:test";
import type { CredentialRecord } from "@xmtp/signet-contracts";
import type { RevealStateStore } from "@xmtp/signet-contracts";
import type { SignetEvent, MessageEvent } from "@xmtp/signet-schemas";
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

describe("createEventProjector", () => {
  describe("credential with read-messages scope", () => {
    test("passes message events through", () => {
      const projector = createEventProjector(makeDeps());
      const credential = makeCredentialRecord();
      const event = makeMessageEvent();

      const result = projector(event, credential);

      expect(result).not.toBeNull();
    });

    test("drops message events outside the credential's scoped chats", () => {
      const projector = createEventProjector(makeDeps());
      const credential = makeCredentialRecord({
        config: {
          operatorId: "operator_1",
          chatIds: ["g1"],
          allow: ["send", "read-messages", "stream-messages"],
          deny: [],
        },
      });
      const event = makeMessageEvent({ groupId: "g2" });

      const result = projector(event, credential);

      expect(result).toBeNull();
    });
  });

  describe("credential without read-messages scope", () => {
    test("drops message events when read-messages is denied", () => {
      const store = makeRevealStore(false);
      const projector = createEventProjector(makeDeps(store));
      const credential = makeCredentialRecord({
        effectiveScopes: {
          allow: ["send"],
          deny: ["read-messages"],
        },
      });
      const event = makeMessageEvent();

      const result = projector(event, credential);

      // Without read-messages scope, messages are hidden (dropped)
      expect(result).toBeNull();
    });
  });

  describe("revealed messages", () => {
    test("passes message events when revealed", () => {
      const store = makeRevealStore(true);
      const projector = createEventProjector(makeDeps(store));
      const credential = makeCredentialRecord({
        effectiveScopes: {
          allow: ["send", "read-messages"],
          deny: [],
        },
      });
      const event = makeMessageEvent();

      const result = projector(event, credential);

      expect(result).not.toBeNull();
      const msg = result as MessageEvent;
      expect(msg.type).toBe("message.visible");
    });
  });

  describe("non-message events", () => {
    test("passes heartbeat events through regardless of scopes", () => {
      const store = makeRevealStore(false);
      const projector = createEventProjector(makeDeps(store));
      const credential = makeCredentialRecord({
        effectiveScopes: {
          allow: [],
          deny: [],
        },
      });
      const heartbeat: SignetEvent = {
        type: "heartbeat",
        credentialId: "cred_123",
        timestamp: "2024-01-01T00:00:00Z",
      };

      const result = projector(heartbeat, credential);

      expect(result).toEqual(heartbeat);
    });

    test("passes credential.expired events through regardless of scopes", () => {
      const store = makeRevealStore(false);
      const projector = createEventProjector(makeDeps(store));
      const credential = makeCredentialRecord({
        effectiveScopes: {
          allow: [],
          deny: [],
        },
      });
      const expired: SignetEvent = {
        type: "credential.expired",
        credentialId: "cred_123",
        reason: "timeout",
      };

      const result = projector(expired, credential);

      expect(result).toEqual(expired);
    });
  });

  describe("missing reveal store", () => {
    test("treats messages as not revealed when store is null", () => {
      const projector = createEventProjector(makeDeps(null));
      const credential = makeCredentialRecord({
        effectiveScopes: {
          allow: ["send"],
          deny: ["read-messages"],
        },
      });
      const event = makeMessageEvent();

      const result = projector(event, credential);

      // Without read-messages scope and no reveal, should be dropped
      expect(result).toBeNull();
    });
  });
});
