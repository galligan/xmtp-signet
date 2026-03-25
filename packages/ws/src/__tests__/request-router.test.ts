import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { routeRequest } from "../request-router.js";
import type { HarnessRequest } from "@xmtp/signet-schemas";
import { PermissionError } from "@xmtp/signet-schemas";
import type { CredentialRecord } from "@xmtp/signet-contracts";

function makeCredentialRecord(): CredentialRecord {
  return {
    credentialId: "cred_123",
    operatorId: "op_1",
    effectiveScopes: {
      allow: ["send", "reply", "read-messages"],
      deny: [],
    },
    status: "active",
    issuedAt: "2024-01-01T00:00:00Z",
    expiresAt: "2024-01-02T00:00:00Z",
    lastHeartbeat: "2024-01-01T00:00:00Z",
  };
}

describe("routeRequest", () => {
  test("routes send_message to handler and returns success", async () => {
    const request: HarnessRequest = {
      type: "send_message",
      requestId: "req_1",
      groupId: "g1",
      contentType: "xmtp.org/text:1.0",
      content: { text: "hello" },
    };

    const handler = async () => Result.ok({ messageId: "msg_1" } as unknown);

    const result = await routeRequest(request, makeCredentialRecord(), handler);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.requestId).toBe("req_1");
    }
  });

  test("returns failure when handler errors", async () => {
    const request: HarnessRequest = {
      type: "send_message",
      requestId: "req_2",
      groupId: "g1",
      contentType: "xmtp.org/text:1.0",
      content: { text: "hello" },
    };

    const handler = async () =>
      Result.err(PermissionError.create("send_message", "not allowed"));

    const result = await routeRequest(request, makeCredentialRecord(), handler);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.requestId).toBe("req_2");
      expect(result.error.category).toBe("permission");
    }
  });

  test("routes heartbeat requests", async () => {
    const request: HarnessRequest = {
      type: "heartbeat",
      requestId: "req_3",
      sessionId: "sess_123",
    };

    const handler = async () => Result.ok(null as unknown);

    const result = await routeRequest(request, makeCredentialRecord(), handler);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.requestId).toBe("req_3");
    }
  });
});
