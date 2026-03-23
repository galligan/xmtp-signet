import { describe, expect, it } from "bun:test";
import {
  MessageVisibility,
  MessageEvent,
  SealStampedEvent,
  CredentialIssuedEvent,
  CredentialExpiredEvent,
  CredentialReauthRequiredEvent,
  HeartbeatEvent,
  RevealEvent,
  ScopesUpdatedEvent,
  AgentRevokedEvent,
  ActionConfirmationEvent,
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

describe("SealStampedEvent", () => {
  const validEnvelope = {
    chain: {
      current: {
        sealId: "seal_abc12345fedcba98",
        credentialId: "cred_abc12345fedcba98",
        operatorId: "op_abc12345fedcba98",
        chatId: "conv_abc12345fedcba98",
        scopeMode: "per-chat",
        permissions: { allow: ["send"], deny: [] },
        issuedAt: "2024-01-01T00:00:00Z",
      },
      delta: { added: ["send"], removed: [], changed: [] },
    },
    signature: "sig_hex",
    keyId: "key_abc12345feedbabe",
    algorithm: "Ed25519",
  };

  it("accepts valid seal stamped event with SealEnvelope", () => {
    const valid = { type: "seal.stamped", seal: validEnvelope };
    expect(SealStampedEvent.safeParse(valid).success).toBe(true);
  });
});

describe("CredentialIssuedEvent", () => {
  it("accepts valid credential issued event", () => {
    const valid = {
      type: "credential.issued",
      credentialId: "cred-1",
      operatorId: "op-1",
    };
    expect(CredentialIssuedEvent.safeParse(valid).success).toBe(true);
  });

  it("rejects wrong type discriminator", () => {
    expect(
      CredentialIssuedEvent.safeParse({
        type: "session.started",
        credentialId: "c1",
        operatorId: "o1",
      }).success,
    ).toBe(false);
  });
});

describe("CredentialExpiredEvent", () => {
  it("accepts valid credential expired event", () => {
    const valid = {
      type: "credential.expired",
      credentialId: "cred-1",
      reason: "ttl exceeded",
    };
    expect(CredentialExpiredEvent.safeParse(valid).success).toBe(true);
  });
});

describe("CredentialReauthRequiredEvent", () => {
  it("accepts valid credential reauth event", () => {
    const valid = {
      type: "credential.reauthorization_required",
      credentialId: "cred-1",
      reason: "policy changed",
    };
    expect(CredentialReauthRequiredEvent.safeParse(valid).success).toBe(true);
  });
});

describe("HeartbeatEvent", () => {
  it("accepts valid heartbeat with credentialId", () => {
    const valid = {
      type: "heartbeat",
      credentialId: "cred-1",
      timestamp: "2024-01-01T00:00:00Z",
    };
    expect(HeartbeatEvent.safeParse(valid).success).toBe(true);
  });

  it("rejects heartbeat with sessionId instead of credentialId", () => {
    const invalid = {
      type: "heartbeat",
      sessionId: "sess-1",
      timestamp: "2024-01-01T00:00:00Z",
    };
    expect(HeartbeatEvent.safeParse(invalid).success).toBe(false);
  });
});

describe("RevealEvent", () => {
  it("accepts valid reveal event", () => {
    const valid = {
      type: "message.revealed",
      messageId: "m1",
      groupId: "g1",
      contentType: "xmtp.org/text:1.0",
      content: {},
      revealId: "r1",
    };
    expect(RevealEvent.safeParse(valid).success).toBe(true);
  });
});

describe("ScopesUpdatedEvent", () => {
  it("accepts valid scopes updated event", () => {
    const valid = {
      type: "scopes.updated",
      credentialId: "cred-1",
      permissions: { allow: ["send", "reply"], deny: ["add-member"] },
    };
    expect(ScopesUpdatedEvent.safeParse(valid).success).toBe(true);
  });

  it("rejects invalid permission scope", () => {
    expect(
      ScopesUpdatedEvent.safeParse({
        type: "scopes.updated",
        credentialId: "cred-1",
        permissions: { allow: ["invalid-scope"], deny: [] },
      }).success,
    ).toBe(false);
  });
});

describe("AgentRevokedEvent", () => {
  it("accepts valid agent revoked event with new revocation seal", () => {
    const valid = {
      type: "agent.revoked",
      revocation: {
        sealId: "seal_fedc1234deadbeef",
        previousSealId: "seal_abc12345fedcba98",
        operatorId: "op_abc12345fedcba98",
        credentialId: "cred_abc12345fedcba98",
        chatId: "conv_abc12345fedcba98",
        reason: "owner-initiated",
        revokedAt: "2024-01-01T00:00:00Z",
        issuer: "signet-1",
      },
    };
    expect(AgentRevokedEvent.safeParse(valid).success).toBe(true);
  });
});

describe("ActionConfirmationEvent", () => {
  it("accepts valid action confirmation event", () => {
    const valid = {
      type: "action.confirmation_required",
      actionId: "act-1",
      actionType: "send_message",
      preview: { text: "hello" },
    };
    expect(ActionConfirmationEvent.safeParse(valid).success).toBe(true);
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
      credentialId: "cred-1",
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

  it("rejects old session-based events", () => {
    expect(
      SignetEvent.safeParse({
        type: "session.started",
        session: {},
        view: {},
        grant: {},
      }).success,
    ).toBe(false);

    expect(
      SignetEvent.safeParse({
        type: "view.updated",
        view: {},
      }).success,
    ).toBe(false);

    expect(
      SignetEvent.safeParse({
        type: "grant.updated",
        grant: {},
      }).success,
    ).toBe(false);
  });

  it("accepts all 11 event types", () => {
    const validEnvelope = {
      chain: {
        current: {
          sealId: "seal_abc12345fedcba98",
          credentialId: "cred_abc12345fedcba98",
          operatorId: "op_abc12345fedcba98",
          chatId: "conv_abc12345fedcba98",
          scopeMode: "per-chat",
          permissions: { allow: ["send"], deny: [] },
          issuedAt: "2024-01-01T00:00:00Z",
        },
        delta: { added: ["send"], removed: [], changed: [] },
      },
      signature: "sig_hex",
      keyId: "key_abc12345feedbabe",
      algorithm: "Ed25519",
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
      { type: "seal.stamped", seal: validEnvelope },
      {
        type: "credential.issued",
        credentialId: "cred-1",
        operatorId: "op-1",
      },
      {
        type: "credential.expired",
        credentialId: "cred-1",
        reason: "ttl",
      },
      {
        type: "credential.reauthorization_required",
        credentialId: "cred-1",
        reason: "policy change",
      },
      {
        type: "heartbeat",
        credentialId: "cred-1",
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
        type: "scopes.updated",
        credentialId: "cred-1",
        permissions: { allow: ["send"], deny: [] },
      },
      {
        type: "agent.revoked",
        revocation: {
          sealId: "seal_fedc1234deadbeef",
          previousSealId: "seal_abc12345fedcba98",
          operatorId: "op_abc12345fedcba98",
          credentialId: "cred_abc12345fedcba98",
          chatId: "conv_abc12345fedcba98",
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
