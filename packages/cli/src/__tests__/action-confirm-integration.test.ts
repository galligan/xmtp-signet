import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import type { CredentialRecord } from "@xmtp/signet-contracts";
import type { HarnessRequest, SignetEvent } from "@xmtp/signet-schemas";
import { createWsRequestHandler } from "../ws/request-handler.js";
import { createPendingActionStore } from "@xmtp/signet-sessions";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCredentialRecord(
  overrides: Partial<CredentialRecord> = {},
): CredentialRecord {
  return {
    id: "cred_action",
    config: {
      operatorId: "operator_1",
      chatIds: ["g1"],
      allow: ["send", "read-messages"],
      deny: [],
    },
    inboxIds: ["inbox_action"],
    credentialId: "cred_action",
    operatorId: "operator_1",
    effectiveScopes: {
      allow: ["send", "read-messages"],
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

// ---------------------------------------------------------------------------
// Integration: credential -> queue -> confirm/deny cycle
// ---------------------------------------------------------------------------

describe("action confirmation integration", () => {
  test("confirm executes the queued action", async () => {
    const sendCalls: string[] = [];
    const pendingActions = createPendingActionStore();

    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async (groupId, contentType) => {
        sendCalls.push(`send:${groupId}:${contentType}`);
        return Result.ok({ messageId: "msg_confirmed" });
      },
      credentialManager: {
        lookup: async () => Result.ok(makeCredentialRecord()),
        lookupByToken: async () => Result.ok(makeCredentialRecord()),
      },
      pendingActions,
      broadcast: () => {},
    });

    // Pre-populate a pending action
    pendingActions.add({
      actionId: "act_e2e_confirm",
      credentialId: "cred_action",
      actionType: "send_message",
      payload: {
        groupId: "g1",
        contentType: "xmtp.org/text:1.0",
        content: { text: "hello" },
      },
      createdAt: "2024-01-01T00:00:00Z",
      expiresAt: "2099-01-01T00:05:00Z",
    });

    const request: HarnessRequest = {
      type: "confirm_action",
      requestId: "req_e2e_confirm",
      actionId: "act_e2e_confirm",
      confirmed: true,
    };

    const result = await handler(request, makeCredentialRecord());

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ messageId: "msg_confirmed" });
    }
    expect(sendCalls).toEqual(["send:g1:xmtp.org/text:1.0"]);
    expect(pendingActions.get("act_e2e_confirm")).toBeNull();
  });

  test("deny discards the queued action without sending", async () => {
    const sendCalls: string[] = [];
    const pendingActions = createPendingActionStore();

    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => {
        sendCalls.push("send");
        return Result.ok({ messageId: "unused" });
      },
      credentialManager: {
        lookup: async () => Result.ok(makeCredentialRecord()),
        lookupByToken: async () => Result.ok(makeCredentialRecord()),
      },
      pendingActions,
      broadcast: () => {},
    });

    pendingActions.add({
      actionId: "act_e2e_deny",
      credentialId: "cred_action",
      actionType: "send_message",
      payload: {
        groupId: "g1",
        contentType: "xmtp.org/text:1.0",
        content: { text: "nope" },
      },
      createdAt: "2024-01-01T00:00:00Z",
      expiresAt: "2099-01-01T00:05:00Z",
    });

    const request: HarnessRequest = {
      type: "confirm_action",
      requestId: "req_e2e_deny",
      actionId: "act_e2e_deny",
      confirmed: false,
    };

    const result = await handler(request, makeCredentialRecord());

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        denied: true,
        actionId: "act_e2e_deny",
      });
    }
    expect(sendCalls).toEqual([]);
    expect(pendingActions.get("act_e2e_deny")).toBeNull();
  });
});
