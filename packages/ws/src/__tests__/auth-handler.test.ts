import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { handleAuth } from "../auth-handler.js";
import { AuthError } from "@xmtp/signet-schemas";
import type { SessionRecord } from "@xmtp/signet-contracts";
import type { AuthFrame } from "../frames.js";

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
    state: "active",
    issuedAt: "2024-01-01T00:00:00Z",
    expiresAt: "2024-01-02T00:00:00Z",
    lastHeartbeat: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("handleAuth", () => {
  const validFrame: AuthFrame = {
    type: "auth",
    token: "valid_token",
    lastSeenSeq: null,
  };

  test("returns session record on valid token", async () => {
    const lookup = async (_token: string) => Result.ok(makeSessionRecord());
    const result = await handleAuth(validFrame, lookup);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.sessionId).toBe("sess_123");
    }
  });

  test("returns error when lookup fails", async () => {
    const lookup = async (_token: string) =>
      Result.err(AuthError.create("Invalid token"));
    const result = await handleAuth(validFrame, lookup);
    expect(result.isErr()).toBe(true);
  });

  test("returns error when session is expired", async () => {
    const lookup = async (_token: string) =>
      Result.ok(makeSessionRecord({ state: "expired" }));
    const result = await handleAuth(validFrame, lookup);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("not active");
    }
  });

  test("returns error when session is revoked", async () => {
    const lookup = async (_token: string) =>
      Result.ok(makeSessionRecord({ state: "revoked" }));
    const result = await handleAuth(validFrame, lookup);
    expect(result.isErr()).toBe(true);
  });
});
