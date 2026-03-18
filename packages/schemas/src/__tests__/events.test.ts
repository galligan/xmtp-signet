import { describe, expect, it } from "bun:test";
import {
  MessageVisibility,
  MessageEvent,
  SessionStartedEvent,
  HeartbeatEvent,
  SignetRecoveryEvent,
  SignetEvent,
} from "../events.js";

describe("MessageVisibility", () => {
  it("accepts all valid visibility values", () => {
    for (const v of [
      "visible",
      "historical",
      "hidden",
      "revealed",
      "redacted",
    ]) {
      expect(MessageVisibility.safeParse(v).success).toBe(true);
    }
  });
});

describe("MessageEvent", () => {
  const valid = {
    type: "message.visible",
    messageId: "msg-1",
    groupId: "group-1",
    senderInboxId: "inbox-1",
    contentType: "xmtp.org/text:1.0",
    content: { text: "hello" },
    visibility: "visible",
    sentAt: "2024-01-01T00:00:00Z",
    sealId: null,
    threadId: null,
  };

  it("accepts valid message event", () => {
    expect(MessageEvent.safeParse(valid).success).toBe(true);
  });

  it("accepts message with seal ID", () => {
    expect(MessageEvent.safeParse({ ...valid, sealId: "att-1" }).success).toBe(
      true,
    );
  });

  it("rejects wrong type discriminator", () => {
    expect(MessageEvent.safeParse({ ...valid, type: "wrong" }).success).toBe(
      false,
    );
  });
});

describe("SessionStartedEvent", () => {
  const valid = {
    type: "session.started",
    session: {
      sessionId: "sess-1",
      agentInboxId: "agent-1",
      sessionKeyFingerprint: "fp",
      issuedAt: "2024-01-01T00:00:00Z",
      expiresAt: "2024-01-01T01:00:00Z",
    },
    view: {
      mode: "full",
      threadScopes: [{ groupId: "g1", threadId: null }],
      contentTypes: ["xmtp.org/text:1.0"],
    },
    grant: {
      messaging: { send: true, reply: true, react: true, draftOnly: false },
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
  };

  it("accepts valid session started event", () => {
    expect(SessionStartedEvent.safeParse(valid).success).toBe(true);
  });
});

describe("HeartbeatEvent", () => {
  it("accepts valid heartbeat", () => {
    const valid = {
      type: "heartbeat",
      sessionId: "sess-1",
      timestamp: "2024-01-01T00:00:00Z",
    };
    expect(HeartbeatEvent.safeParse(valid).success).toBe(true);
  });
});

describe("SignetRecoveryEvent", () => {
  it("accepts valid recovery event", () => {
    const valid = {
      type: "signet.recovery.complete",
      caughtUpThrough: "2024-01-01T00:00:00Z",
    };
    expect(SignetRecoveryEvent.safeParse(valid).success).toBe(true);
  });
});

describe("SignetEvent discriminated union", () => {
  it("discriminates on type field", () => {
    const heartbeat = {
      type: "heartbeat",
      sessionId: "sess-1",
      timestamp: "2024-01-01T00:00:00Z",
    };
    const result = SignetEvent.safeParse(heartbeat);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("heartbeat");
    }
  });

  it("rejects events with unknown type", () => {
    const invalid = { type: "unknown.event", data: {} };
    expect(SignetEvent.safeParse(invalid).success).toBe(false);
  });

  it("accepts all 12 event types", () => {
    const validSeal = {
      sealId: "att-001",
      previousSealId: null,
      agentInboxId: "agent-1",
      ownerInboxId: "owner-1",
      groupId: "group-1",
      threadScope: null,
      viewMode: "full",
      contentTypes: ["xmtp.org/text:1.0"],
      grantedOps: [],
      toolScopes: [],
      inferenceMode: "external",
      inferenceProviders: [],
      contentEgressScope: "none",
      retentionAtProvider: "none",
      hostingMode: "managed",
      trustTier: "unverified",
      buildProvenanceRef: null,
      verifierStatementRef: null,
      sessionKeyFingerprint: null,
      policyHash: "abc",
      heartbeatInterval: 30,
      issuedAt: "2024-01-01T00:00:00Z",
      expiresAt: "2024-01-01T01:00:00Z",
      revocationRules: {
        maxTtlSeconds: 3600,
        requireHeartbeat: true,
        ownerCanRevoke: true,
        adminCanRemove: false,
      },
      issuer: "signet-1",
    };

    const validGrant = {
      messaging: { send: true, reply: true, react: true, draftOnly: false },
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
    };

    const events = [
      {
        type: "message.visible",
        messageId: "m1",
        groupId: "g1",
        senderInboxId: "i1",
        contentType: "xmtp.org/text:1.0",
        content: {},
        visibility: "visible",
        sentAt: "2024-01-01T00:00:00Z",
        sealId: null,
        threadId: null,
      },
      { type: "seal.stamped", seal: validSeal },
      {
        type: "session.started",
        session: {
          sessionId: "s1",
          agentInboxId: "a1",
          sessionKeyFingerprint: "fp",
          issuedAt: "2024-01-01T00:00:00Z",
          expiresAt: "2024-01-01T01:00:00Z",
        },
        view: {
          mode: "full",
          threadScopes: [{ groupId: "g1", threadId: null }],
          contentTypes: ["xmtp.org/text:1.0"],
        },
        grant: validGrant,
      },
      { type: "session.expired", sessionId: "s1", reason: "ttl" },
      {
        type: "session.reauthorization_required",
        sessionId: "s1",
        reason: "policy change",
      },
      {
        type: "heartbeat",
        sessionId: "s1",
        timestamp: "2024-01-01T00:00:00Z",
      },
      {
        type: "message.revealed",
        messageId: "m1",
        groupId: "g1",
        contentType: "xmtp.org/text:1.0",
        content: {},
        revealId: "r1",
      },
      {
        type: "view.updated",
        view: {
          mode: "full",
          threadScopes: [{ groupId: "g1", threadId: null }],
          contentTypes: ["xmtp.org/text:1.0"],
        },
      },
      { type: "grant.updated", grant: validGrant },
      {
        type: "agent.revoked",
        revocation: {
          sealId: "rev-1",
          previousSealId: "att-001",
          agentInboxId: "a1",
          groupId: "g1",
          reason: "owner-initiated",
          revokedAt: "2024-01-01T00:00:00Z",
          issuer: "signet-1",
        },
      },
      {
        type: "action.confirmation_required",
        actionId: "act-1",
        actionType: "send_message",
        preview: { text: "hello" },
      },
      {
        type: "signet.recovery.complete",
        caughtUpThrough: "2024-01-01T00:00:00Z",
      },
    ];

    for (const event of events) {
      const result = SignetEvent.safeParse(event);
      expect(result.success).toBe(true);
    }
  });
});
