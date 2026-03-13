import { describe, expect, test } from "bun:test";
import {
  AuthFrame,
  AuthenticatedFrame,
  AuthErrorFrame,
  BackpressureFrame,
  SequencedFrame,
} from "../frames.js";

describe("AuthFrame", () => {
  test("parses valid auth frame", () => {
    const result = AuthFrame.safeParse({
      type: "auth",
      token: "tok_abc123",
      lastSeenSeq: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("auth");
      expect(result.data.token).toBe("tok_abc123");
      expect(result.data.lastSeenSeq).toBeNull();
    }
  });

  test("parses auth frame with lastSeenSeq", () => {
    const result = AuthFrame.safeParse({
      type: "auth",
      token: "tok_abc123",
      lastSeenSeq: 42,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lastSeenSeq).toBe(42);
    }
  });

  test("rejects negative lastSeenSeq", () => {
    const result = AuthFrame.safeParse({
      type: "auth",
      token: "tok_abc123",
      lastSeenSeq: -1,
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing token", () => {
    const result = AuthFrame.safeParse({
      type: "auth",
      lastSeenSeq: null,
    });
    expect(result.success).toBe(false);
  });

  test("rejects wrong type", () => {
    const result = AuthFrame.safeParse({
      type: "wrong",
      token: "tok",
      lastSeenSeq: null,
    });
    expect(result.success).toBe(false);
  });
});

describe("AuthErrorFrame", () => {
  test("parses valid auth error frame", () => {
    const result = AuthErrorFrame.safeParse({
      type: "auth_error",
      code: 4001,
      message: "Invalid token",
    });
    expect(result.success).toBe(true);
  });
});

describe("BackpressureFrame", () => {
  test("parses valid backpressure frame", () => {
    const result = BackpressureFrame.safeParse({
      type: "backpressure",
      buffered: 100,
      limit: 256,
    });
    expect(result.success).toBe(true);
  });
});

describe("SequencedFrame", () => {
  test("parses valid sequenced frame with heartbeat event", () => {
    const result = SequencedFrame.safeParse({
      seq: 1,
      event: {
        type: "heartbeat",
        sessionId: "sess_123",
        timestamp: "2024-01-01T00:00:00Z",
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.seq).toBe(1);
      expect(result.data.event.type).toBe("heartbeat");
    }
  });

  test("rejects zero seq", () => {
    const result = SequencedFrame.safeParse({
      seq: 0,
      event: {
        type: "heartbeat",
        sessionId: "sess_123",
        timestamp: "2024-01-01T00:00:00Z",
      },
    });
    expect(result.success).toBe(false);
  });

  test("rejects negative seq", () => {
    const result = SequencedFrame.safeParse({
      seq: -1,
      event: {
        type: "heartbeat",
        sessionId: "sess_123",
        timestamp: "2024-01-01T00:00:00Z",
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("AuthenticatedFrame", () => {
  test("parses valid authenticated frame", () => {
    const result = AuthenticatedFrame.safeParse({
      type: "authenticated",
      connectionId: "conn_abc",
      session: {
        sessionId: "sess_123",
        agentInboxId: "agent_1",
        sessionKeyFingerprint: "fp_abc",
        issuedAt: "2024-01-01T00:00:00Z",
        expiresAt: "2024-01-02T00:00:00Z",
      },
      view: {
        mode: "full",
        threadScopes: [{ groupId: "g1", threadId: null }],
        contentTypes: ["xmtp.org/text:1.0"],
      },
      grant: {
        messaging: {
          send: true,
          reply: true,
          react: true,
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
      resumedFromSeq: null,
    });
    expect(result.success).toBe(true);
  });
});
