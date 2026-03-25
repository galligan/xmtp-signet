import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import type { CredentialRecord } from "@xmtp/signet-contracts";
import type {
  HarnessRequest,
  RevealEvent,
  SignetEvent,
} from "@xmtp/signet-schemas";
import {
  AuthError,
  NotFoundError,
  PermissionError,
} from "@xmtp/signet-schemas";
import { createWsRequestHandler } from "../ws/request-handler.js";
import type { ReplayMessage } from "../ws/request-handler.js";
import { createPendingActionStore } from "@xmtp/signet-sessions";
import { createRevealStateStore } from "@xmtp/signet-policy";
import type { InternalCredentialManager } from "@xmtp/signet-sessions";

function makeCredentialRecord(
  overrides: Partial<CredentialRecord> = {},
): CredentialRecord {
  return {
    id: "cred_123",
    config: {
      operatorId: "operator_1",
      chatIds: ["g1"],
      allow: ["send", "read-messages"],
      deny: [],
    },
    inboxIds: ["inbox_12345678feedbabe"],
    credentialId: "cred_123",
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

function makeInternalCredentialManager(
  overrides: Partial<InternalCredentialManager> = {},
): InternalCredentialManager {
  return {
    issueCredential: async () =>
      Result.err({
        _tag: "InternalError",
        code: 0,
        category: "internal",
        message: "not impl",
        context: null,
      }),
    getCredentialByToken: () =>
      Result.err({
        _tag: "NotFoundError",
        code: 0,
        category: "not_found",
        message: "not found",
        context: null,
      }),
    getCredentialById: () =>
      Result.err({
        _tag: "NotFoundError",
        code: 0,
        category: "not_found",
        message: "not found",
        context: null,
      }),
    getActiveCredentials: () => [],
    listCredentials: () => [],
    recordHeartbeat: () => Result.ok(undefined),
    renewCredential: async () =>
      Result.err({
        _tag: "NotFoundError",
        code: 0,
        category: "not_found",
        message: "not found",
        context: null,
      }),
    updateCredentialScopes: () =>
      Result.err({
        _tag: "NotFoundError",
        code: 0,
        category: "not_found",
        message: "not found",
        context: null,
      }),
    revokeCredential: () =>
      Result.err({
        _tag: "NotFoundError",
        code: 0,
        category: "not_found",
        message: "not found",
        context: null,
      }),
    revokeAllCredentials: () => [],
    lookupByToken: () =>
      Result.err({
        _tag: "NotFoundError",
        code: 0,
        category: "not_found",
        message: "not found",
        context: null,
      }),
    checkMateriality: () =>
      Result.ok({
        isMaterial: false,
        reason: null,
        requiresReauthorization: false,
      }),
    getRevealState: () => Result.ok(createRevealStateStore()),
    setCredentialStatus: () =>
      Result.err({
        _tag: "NotFoundError",
        code: 0,
        category: "not_found",
        message: "not found",
        context: null,
      }),
    sweepExpired: () => [],
    isHeartbeatStale: () => Result.ok(false),
    ...overrides,
  } as unknown as InternalCredentialManager;
}

describe("createWsRequestHandler", () => {
  test("sends allowed messages after ensuring the core is ready", async () => {
    const calls: string[] = [];
    const handler = createWsRequestHandler({
      ensureCoreReady: async () => {
        calls.push("ensureCoreReady");
        return Result.ok(undefined);
      },
      sendMessage: async (groupId, contentType, content) => {
        calls.push(`send:${groupId}:${contentType}:${JSON.stringify(content)}`);
        return Result.ok({ messageId: "msg_1" });
      },
      credentialManager: {
        lookup: async () => Result.ok(makeCredentialRecord()),
        lookupByToken: async () => Result.ok(makeCredentialRecord()),
      },
    });

    const request: HarnessRequest = {
      type: "send_message",
      requestId: "req_1",
      groupId: "g1",
      contentType: "xmtp.org/text:1.0",
      content: { text: "hello" },
    };

    const result = await handler(
      request,
      makeCredentialRecord({
        config: {
          operatorId: "operator_1",
          chatIds: ["g1"],
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
        effectiveScopes: {
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        messageId: "msg_1",
        provenance: null,
      });
    }
    expect(calls).toEqual([
      "ensureCoreReady",
      'send:g1:xmtp.org/text:1.0:{"text":"hello"}',
    ]);
  });

  test("rejects heartbeats whose credential id does not match the authenticated credential", async () => {
    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => Result.ok({ messageId: "unused" }),
      credentialManager: {
        lookup: async () => Result.ok(makeCredentialRecord()),
        lookupByToken: async () => Result.ok(makeCredentialRecord()),
      },
      internalCredentialManager: makeInternalCredentialManager(),
    });

    const request: HarnessRequest = {
      type: "heartbeat",
      requestId: "req_2",
      credentialId: "spoofed_credential",
    };

    const result = await handler(
      request,
      makeCredentialRecord({
        config: {
          operatorId: "operator_1",
          chatIds: ["g1"],
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
        effectiveScopes: {
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
      }),
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(AuthError);
      expect(result.error.category).toBe("auth");
    }
  });

  test("records heartbeat for the authenticated credential", async () => {
    const heartbeatCalls: string[] = [];
    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => Result.ok({ messageId: "unused" }),
      credentialManager: {
        lookup: async () => Result.ok(makeCredentialRecord()),
        lookupByToken: async () => Result.ok(makeCredentialRecord()),
      },
      internalCredentialManager: makeInternalCredentialManager({
        recordHeartbeat: (credentialId: string) => {
          heartbeatCalls.push(credentialId);
          return Result.ok(undefined);
        },
      } as unknown as Partial<InternalCredentialManager>),
    });

    const request: HarnessRequest = {
      type: "heartbeat",
      requestId: "req_2b",
      credentialId: "cred_123",
    };

    const result = await handler(
      request,
      makeCredentialRecord({
        config: {
          operatorId: "operator_1",
          chatIds: ["g1"],
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
        effectiveScopes: {
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBeNull();
    }
    expect(heartbeatCalls).toEqual(["cred_123"]);
  });

  test("applies scope narrowing in place without marking the credential pending", async () => {
    const statusCalls: string[] = [];
    const updateCalls: Array<{
      credentialId: string;
      scopes: { allow: readonly string[]; deny: readonly string[] };
    }> = [];

    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => Result.ok({ messageId: "unused" }),
      credentialManager: {
        lookup: async () => Result.ok(makeCredentialRecord()),
        lookupByToken: async () => Result.ok(makeCredentialRecord()),
      },
      internalCredentialManager: makeInternalCredentialManager({
        checkMateriality: () =>
          Result.ok({
            isMaterial: true,
            reason: "Material change: removed: send",
            requiresReauthorization: false,
          }),
        updateCredentialScopes: (credentialId, scopes) => {
          updateCalls.push({ credentialId, scopes });
          return Result.ok({
            credentialId,
            token: "token",
            operatorId: "operator_1",
            chatIds: ["g1"],
            effectiveScopes: scopes,
            resolvedScopes: new Set(scopes.allow),
            policyHash: "hash",
            status: "active",
            heartbeatInterval: 30,
            lastHeartbeat: "2024-01-01T00:00:00Z",
            issuedAt: "2024-01-01T00:00:00Z",
            expiresAt: "2024-01-02T00:00:00Z",
            ttlMs: 3600_000,
            revokedAt: null,
            revocationReason: null,
          });
        },
        setCredentialStatus: (_credentialId, status) => {
          statusCalls.push(status);
          return Result.err(NotFoundError.create("credential", "cred_123"));
        },
      } as unknown as Partial<InternalCredentialManager>),
    });

    const request: HarnessRequest = {
      type: "update_scopes",
      requestId: "req_update_1",
      allow: ["read-messages"],
      deny: ["send"],
    };

    const result = await handler(request, makeCredentialRecord());

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value).toEqual({
      updated: true,
      material: true,
      reason: "Material change: removed: send",
    });
    expect(updateCalls).toEqual([
      {
        credentialId: "cred_123",
        scopes: { allow: ["read-messages"], deny: ["send"] },
      },
    ]);
    expect(statusCalls).toEqual([]);
  });

  test("marks the credential pending when scope escalation requires reauthorization", async () => {
    const statusCalls: string[] = [];
    const updateCalls: string[] = [];

    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => Result.ok({ messageId: "unused" }),
      credentialManager: {
        lookup: async () => Result.ok(makeCredentialRecord()),
        lookupByToken: async () => Result.ok(makeCredentialRecord()),
      },
      internalCredentialManager: makeInternalCredentialManager({
        checkMateriality: () =>
          Result.ok({
            isMaterial: true,
            reason: "Material change: added: reply",
            requiresReauthorization: true,
          }),
        updateCredentialScopes: (credentialId) => {
          updateCalls.push(credentialId);
          return Result.err(NotFoundError.create("credential", credentialId));
        },
        setCredentialStatus: (_credentialId, status) => {
          statusCalls.push(status);
          return Result.ok({
            credentialId: "cred_123",
            token: "token",
            operatorId: "operator_1",
            chatIds: ["g1"],
            effectiveScopes: { allow: ["send", "read-messages"], deny: [] },
            resolvedScopes: new Set(["send", "read-messages"]),
            policyHash: "hash",
            status,
            heartbeatInterval: 30,
            lastHeartbeat: "2024-01-01T00:00:00Z",
            issuedAt: "2024-01-01T00:00:00Z",
            expiresAt: "2024-01-02T00:00:00Z",
            ttlMs: 3600_000,
            revokedAt: null,
            revocationReason: null,
          });
        },
      } as unknown as Partial<InternalCredentialManager>),
    });

    const request: HarnessRequest = {
      type: "update_scopes",
      requestId: "req_update_2",
      allow: ["send", "read-messages", "reply"],
    };

    const result = await handler(request, makeCredentialRecord());

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value).toEqual({
      updated: false,
      material: true,
      reason: "Material change: added: reply",
    });
    expect(statusCalls).toEqual(["pending"]);
    expect(updateCalls).toEqual([]);
  });

  test("rejects unsupported request types", async () => {
    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => Result.ok({ messageId: "msg_1" }),
      credentialManager: {
        lookup: async () => Result.ok(makeCredentialRecord()),
        lookupByToken: async () => Result.ok(makeCredentialRecord()),
      },
    });

    const request: HarnessRequest = {
      type: "send_reply",
      requestId: "req_4",
      groupId: "g1",
      messageId: "msg_parent",
      contentType: "xmtp.org/text:1.0",
      content: { text: "reply" },
    };

    const result = await handler(
      request,
      makeCredentialRecord({
        config: {
          operatorId: "operator_1",
          chatIds: ["g1"],
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
        effectiveScopes: {
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
      }),
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("not supported");
    }
  });

  test("attaches message-seal bindings when seal lookup and binding are available", async () => {
    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => Result.ok({ messageId: "msg_bound" }),
      credentialManager: {
        lookup: async () => Result.ok(makeCredentialRecord()),
        lookupByToken: async () => Result.ok(makeCredentialRecord()),
      },
      sealManager: {
        current: async () =>
          Result.ok({
            chain: {
              current: {
                sealId: "seal_12345678feedbabe",
                credentialId: "cred_123",
                operatorId: "operator_1",
                chatId: "g1",
                scopeMode: "per-chat",
                permissions: { allow: ["send"], deny: [] },
                issuedAt: "2024-01-01T00:00:00Z",
              },
              delta: { added: [], removed: [], changed: [] },
            },
            signature: "dGVzdA==",
            keyId: "key_12345678feedbabe",
            algorithm: "Ed25519",
          }),
      },
      createMessageBinding: async () =>
        Result.ok({
          sealRef: "seal_12345678feedbabe",
          sealSignature: "dGVzdC1zaWduYXR1cmU=",
        }),
    });

    const request: HarnessRequest = {
      type: "send_message",
      requestId: "req_bound",
      groupId: "g1",
      contentType: "xmtp.org/text:1.0",
      content: { text: "bound" },
    };

    const result = await handler(
      request,
      makeCredentialRecord({
        config: {
          operatorId: "operator_1",
          chatIds: ["g1"],
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
        effectiveScopes: {
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
      }),
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toEqual({
      messageId: "msg_bound",
      provenance: {
        credentialId: "cred_123",
        operatorId: "operator_1",
        sealRef: "seal_12345678feedbabe",
        sealSignature: "dGVzdC1zaWduYXR1cmU=",
      },
    });
  });

  test("confirm_action executes the pending action when confirmed", async () => {
    const sendCalls: string[] = [];
    const pendingActions = createPendingActionStore();

    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async (groupId, contentType, _content) => {
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
      actionId: "act_confirm_1",
      credentialId: "cred_123",
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
      requestId: "req_confirm",
      actionId: "act_confirm_1",
      confirmed: true,
    };

    const result = await handler(
      request,
      makeCredentialRecord({
        config: {
          operatorId: "operator_1",
          chatIds: ["g1"],
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
        effectiveScopes: {
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ messageId: "msg_confirmed" });
    }
    expect(sendCalls).toEqual(["send:g1:xmtp.org/text:1.0"]);

    // Action should be removed from store
    expect(pendingActions.get("act_confirm_1")).toBeNull();
  });

  test("confirm_action discards the pending action when denied", async () => {
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
      actionId: "act_deny_1",
      credentialId: "cred_123",
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
      requestId: "req_deny",
      actionId: "act_deny_1",
      confirmed: false,
    };

    const result = await handler(
      request,
      makeCredentialRecord({
        config: {
          operatorId: "operator_1",
          chatIds: ["g1"],
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
        effectiveScopes: {
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ denied: true, actionId: "act_deny_1" });
    }
    expect(sendCalls).toEqual([]);
    expect(pendingActions.get("act_deny_1")).toBeNull();
  });

  test("confirm_action returns not_found for unknown actionId", async () => {
    const pendingActions = createPendingActionStore();

    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => Result.ok({ messageId: "unused" }),
      credentialManager: {
        lookup: async () => Result.ok(makeCredentialRecord()),
        lookupByToken: async () => Result.ok(makeCredentialRecord()),
      },
      pendingActions,
      broadcast: () => {},
    });

    const request: HarnessRequest = {
      type: "confirm_action",
      requestId: "req_missing",
      actionId: "nonexistent",
      confirmed: true,
    };

    const result = await handler(
      request,
      makeCredentialRecord({
        config: {
          operatorId: "operator_1",
          chatIds: ["g1"],
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
        effectiveScopes: {
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
      }),
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(NotFoundError);
      expect(result.error.category).toBe("not_found");
    }
  });

  test("confirm_action rejects when credential does not match pending action", async () => {
    const pendingActions = createPendingActionStore();

    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => Result.ok({ messageId: "unused" }),
      credentialManager: {
        lookup: async () => Result.ok(makeCredentialRecord()),
        lookupByToken: async () => Result.ok(makeCredentialRecord()),
      },
      pendingActions,
      broadcast: () => {},
    });

    pendingActions.add({
      actionId: "act_other",
      credentialId: "cred_other",
      actionType: "send_message",
      payload: {},
      createdAt: "2024-01-01T00:00:00Z",
      expiresAt: "2099-01-01T00:05:00Z",
    });

    const request: HarnessRequest = {
      type: "confirm_action",
      requestId: "req_mismatch",
      actionId: "act_other",
      confirmed: true,
    };

    const result = await handler(
      request,
      makeCredentialRecord({
        config: {
          operatorId: "operator_1",
          chatIds: ["g1"],
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
        effectiveScopes: {
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
      }),
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(PermissionError);
    }
  });

  test("reveal_content replays historical messages as message.revealed events", async () => {
    const revealStore = createRevealStateStore();
    const broadcastedEvents: {
      credentialId: string;
      event: SignetEvent;
    }[] = [];

    const messages: readonly ReplayMessage[] = [
      {
        messageId: "msg_1",
        groupId: "g1",
        senderInboxId: "sender_a",
        contentType: "xmtp.org/text:1.0",
        content: { text: "hello" },
        sentAt: "2024-01-01T00:01:00Z",
        threadId: "thread_1",
      },
      {
        messageId: "msg_2",
        groupId: "g1",
        senderInboxId: "sender_b",
        contentType: "xmtp.org/text:1.0",
        content: { text: "world" },
        sentAt: "2024-01-01T00:02:00Z",
        threadId: "thread_1",
      },
    ];

    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => Result.ok({ messageId: "unused" }),
      credentialManager: {
        lookup: async () => Result.ok(makeCredentialRecord()),
        lookupByToken: async () => Result.ok(makeCredentialRecord()),
      },
      internalCredentialManager: makeInternalCredentialManager({
        getRevealState: () => Result.ok(revealStore),
      } as unknown as Partial<InternalCredentialManager>),
      broadcast: (credentialId, event) => {
        broadcastedEvents.push({ credentialId, event });
      },
      listMessages: async () => Result.ok(messages),
    });

    const request: HarnessRequest = {
      type: "reveal_content",
      requestId: "req_reveal_1",
      reveal: {
        revealId: "rev_1",
        groupId: "g1",
        scope: "thread",
        targetId: "thread_1",
        requestedBy: "owner_1",
        expiresAt: null,
      },
    };

    const result = await handler(
      request,
      makeCredentialRecord({
        config: {
          operatorId: "operator_1",
          chatIds: ["g1"],
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
        effectiveScopes: {
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const access = result.value as { revealId: string };
      expect(access.revealId).toBe("rev_1");
    }

    // Both messages should be revealed via broadcast
    expect(broadcastedEvents).toHaveLength(2);
    for (const entry of broadcastedEvents) {
      expect(entry.credentialId).toBe("cred_123");
      expect(entry.event.type).toBe("message.revealed");
    }

    const first = broadcastedEvents[0]?.event as RevealEvent;
    expect(first.messageId).toBe("msg_1");
    expect(first.revealId).toBe("rev_1");
    expect(first.content).toEqual({ text: "hello" });

    const second = broadcastedEvents[1]?.event as RevealEvent;
    expect(second.messageId).toBe("msg_2");
    expect(second.revealId).toBe("rev_1");
  });

  test("reveal_content skips replay when listMessages is not provided", async () => {
    const revealStore = createRevealStateStore();
    const broadcastedEvents: {
      credentialId: string;
      event: SignetEvent;
    }[] = [];

    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => Result.ok({ messageId: "unused" }),
      credentialManager: {
        lookup: async () => Result.ok(makeCredentialRecord()),
        lookupByToken: async () => Result.ok(makeCredentialRecord()),
      },
      internalCredentialManager: makeInternalCredentialManager({
        getRevealState: () => Result.ok(revealStore),
      } as unknown as Partial<InternalCredentialManager>),
      broadcast: (credentialId, event) => {
        broadcastedEvents.push({ credentialId, event });
      },
    });

    const request: HarnessRequest = {
      type: "reveal_content",
      requestId: "req_reveal_2",
      reveal: {
        revealId: "rev_2",
        groupId: "g1",
        scope: "message",
        targetId: "msg_1",
        requestedBy: "owner_1",
        expiresAt: null,
      },
    };

    const result = await handler(
      request,
      makeCredentialRecord({
        config: {
          operatorId: "operator_1",
          chatIds: ["g1"],
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
        effectiveScopes: {
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
      }),
    );

    expect(result.isOk()).toBe(true);
    // No broadcast since listMessages is not wired
    expect(broadcastedEvents).toHaveLength(0);
  });

  test("reveal_content only replays messages matching the reveal scope", async () => {
    const revealStore = createRevealStateStore();
    const broadcastedEvents: {
      credentialId: string;
      event: SignetEvent;
    }[] = [];

    const messages: readonly ReplayMessage[] = [
      {
        messageId: "msg_target",
        groupId: "g1",
        senderInboxId: "sender_a",
        contentType: "xmtp.org/text:1.0",
        content: { text: "revealed" },
        sentAt: "2024-01-01T00:01:00Z",
        threadId: null,
      },
      {
        messageId: "msg_other",
        groupId: "g1",
        senderInboxId: "sender_b",
        contentType: "xmtp.org/text:1.0",
        content: { text: "not revealed" },
        sentAt: "2024-01-01T00:02:00Z",
        threadId: null,
      },
    ];

    const handler = createWsRequestHandler({
      ensureCoreReady: async () => Result.ok(undefined),
      sendMessage: async () => Result.ok({ messageId: "unused" }),
      credentialManager: {
        lookup: async () => Result.ok(makeCredentialRecord()),
        lookupByToken: async () => Result.ok(makeCredentialRecord()),
      },
      internalCredentialManager: makeInternalCredentialManager({
        getRevealState: () => Result.ok(revealStore),
      } as unknown as Partial<InternalCredentialManager>),
      broadcast: (credentialId, event) => {
        broadcastedEvents.push({ credentialId, event });
      },
      listMessages: async () => Result.ok(messages),
    });

    // Reveal only a single message by ID
    const request: HarnessRequest = {
      type: "reveal_content",
      requestId: "req_reveal_3",
      reveal: {
        revealId: "rev_3",
        groupId: "g1",
        scope: "message",
        targetId: "msg_target",
        requestedBy: "owner_1",
        expiresAt: null,
      },
    };

    const result = await handler(
      request,
      makeCredentialRecord({
        config: {
          operatorId: "operator_1",
          chatIds: ["g1"],
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
        effectiveScopes: {
          allow: ["send", "read-messages", "read-history"],
          deny: [],
        },
      }),
    );

    expect(result.isOk()).toBe(true);
    // Only the targeted message should be revealed
    expect(broadcastedEvents).toHaveLength(1);
    const revealed = broadcastedEvents[0]?.event as RevealEvent;
    expect(revealed.messageId).toBe("msg_target");
    expect(revealed.revealId).toBe("rev_3");
  });
});
