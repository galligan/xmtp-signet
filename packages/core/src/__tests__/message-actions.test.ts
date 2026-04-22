import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { Result } from "better-result";
import { NotFoundError } from "@xmtp/signet-schemas";
import type {
  SignetError,
  IdMappingStore,
  AdminReadElevationType,
} from "@xmtp/signet-schemas";
import type { HandlerContext } from "@xmtp/signet-contracts";
import { SqliteIdentityStore } from "../identity-store.js";
import { createSqliteIdMappingStore } from "../id-mapping-store.js";
import type { ManagedClient } from "../client-registry.js";
import type { XmtpClient, XmtpDecodedMessage } from "../xmtp-client-factory.js";
import {
  createMessageActions,
  type MessageActionDeps,
} from "../message-actions.js";

/** Minimal handler context for tests. */
function stubCtx(): HandlerContext {
  return {
    requestId: "test-req-1",
    signal: AbortSignal.timeout(5_000),
  };
}

function stubAdminReadCtx(
  overrides: Partial<AdminReadElevationType> = {},
): HandlerContext {
  return {
    requestId: "test-admin-read-req-1",
    signal: AbortSignal.timeout(5_000),
    adminAuth: { adminKeyFingerprint: "admin-fingerprint-1" },
    adminReadElevation: {
      approvalId: "approval_read_1",
      scope: {
        chatIds: ["conv_0123456789abcdef"],
      },
      approvedAt: "2026-04-13T16:00:00.000Z",
      expiresAt: "2099-04-13T17:00:00.000Z",
      approvalKeyFingerprint: "local-approval-fingerprint",
      ...overrides,
    },
  };
}

/** Create a mock XmtpClient with message support. */
function createMockClient(options?: {
  inboxId?: string;
  messages?: XmtpDecodedMessage[];
  sentMessageId?: string;
}): XmtpClient {
  const inboxId = options?.inboxId ?? "mock-inbox-1";
  const messages = options?.messages ?? [];
  const sentMessageId = options?.sentMessageId ?? "msg-1";

  // Track calls for assertion
  const sendCalls: {
    groupId: string;
    content: unknown;
    contentType?: string;
  }[] = [];

  const client: XmtpClient & {
    _sendCalls: typeof sendCalls;
  } = {
    inboxId,
    _sendCalls: sendCalls,
    sendMessage: async (groupId, content, contentType?) => {
      sendCalls.push({ groupId, content, contentType });
      return Result.ok(sentMessageId);
    },
    createDm: async (peerInboxId) => Result.ok({ dmId: "dm-1", peerInboxId }),
    sendDmMessage: async () => Result.ok("dm-msg-1"),
    syncAll: async () => Result.ok(),
    syncGroup: async () => Result.ok(),
    getGroupInfo: async (groupId) => {
      return Result.err(NotFoundError.create("group", groupId) as SignetError);
    },
    listGroups: async () => Result.ok([]),
    addMembers: async () => Result.ok(),
    removeMembers: async () => Result.ok(),
    createGroup: async (memberInboxIds, opts) => {
      return Result.ok({
        groupId: "new-group-1",
        name: opts?.name ?? "",
        description: "",
        memberInboxIds: [inboxId, ...memberInboxIds],
        createdAt: new Date().toISOString(),
      });
    },
    getMessageById: (messageId: string) => {
      const found = messages.find((m) => m.messageId === messageId);
      return Result.ok(found);
    },
    listMessages: async () => Result.ok(messages),
    streamAllMessages: async () =>
      Result.ok({ messages: emptyAsyncIterable(), abort: () => {} }),
    streamGroups: async () =>
      Result.ok({ groups: emptyAsyncIterable(), abort: () => {} }),
    streamDms: async () =>
      Result.ok({ dms: emptyAsyncIterable(), abort: () => {} }),
    getConsentState: async () => Result.ok("unknown" as const),
    setConsentState: async () => Result.ok(undefined),
  };

  return client;
}

function emptyAsyncIterable<T>(): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          return { done: true as const, value: undefined as unknown as T };
        },
      };
    },
  };
}

const sampleMessages: XmtpDecodedMessage[] = [
  {
    messageId: "msg-aaa",
    groupId: "g1",
    senderInboxId: "inbox-a",
    contentType: "text",
    content: "Hello",
    sentAt: "2026-03-30T10:00:00.000Z",
    threadId: null,
  },
  {
    messageId: "msg-bbb",
    groupId: "g1",
    senderInboxId: "inbox-b",
    contentType: "text",
    content: "World",
    sentAt: "2026-03-30T10:01:00.000Z",
    threadId: null,
  },
];

describe("message actions", () => {
  let identityStore: SqliteIdentityStore;
  let idMappings: IdMappingStore;
  let mappingDb: Database;
  let managedClients: Map<string, ManagedClient>;
  let deps: MessageActionDeps;

  beforeEach(async () => {
    identityStore = new SqliteIdentityStore(":memory:");
    mappingDb = new Database(":memory:");
    idMappings = createSqliteIdMappingStore(mappingDb);
    managedClients = new Map();
  });

  afterEach(() => {
    identityStore.close();
    mappingDb.close();
  });

  function setupDeps(): void {
    deps = {
      identityStore,
      getManagedClient: (id) => managedClients.get(id),
      idMappings,
    };
  }

  /** Seed an identity and a managed client in the test harness. */
  async function seedIdentity(
    label: string,
    clientOpts?: Parameters<typeof createMockClient>[0],
  ): Promise<ManagedClient & { client: ReturnType<typeof createMockClient> }> {
    const identityResult = await identityStore.create(null, label);
    expect(identityResult.isOk()).toBe(true);
    const identity = identityResult.value;

    const client = createMockClient({
      inboxId: `inbox-${identity.id}`,
      ...clientOpts,
    });
    const managed = {
      identityId: identity.id,
      inboxId: client.inboxId,
      client,
      groupIds: new Set<string>(),
    };
    await identityStore.setInboxId(identity.id, client.inboxId);
    managedClients.set(identity.id, managed);
    return managed;
  }

  test("declares HTTP admin auth on all actions", () => {
    setupDeps();
    const actions = createMessageActions(deps);

    for (const action of actions) {
      expect(action.http?.auth).toBe("admin");
    }
  });

  describe("message.send", () => {
    test("sends text and returns messageId", async () => {
      await seedIdentity("sender", { sentMessageId: "msg-sent-1" });
      setupDeps();

      const actions = createMessageActions(deps);
      const sendAction = actions.find((a) => a.id === "message.send");
      expect(sendAction).toBeDefined();

      const result = await sendAction!.handler(
        { chatId: "g1", text: "Hello world", identityLabel: "sender" },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const val = result.value as { messageId: string; chatId: string };
        expect(val.messageId).toBe("msg-sent-1");
        expect(val.chatId).toBe("g1");
      }
    });

    test("resolves the acting identity from inbox ID", async () => {
      const managed = await seedIdentity("sender", {
        sentMessageId: "msg-sent-2",
      });
      setupDeps();

      const actions = createMessageActions(deps);
      const sendAction = actions.find((a) => a.id === "message.send");
      expect(sendAction).toBeDefined();

      const result = await sendAction!.handler(
        {
          chatId: "g1",
          text: "Hello from inbox",
          identityLabel: managed.inboxId,
        },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const val = result.value as { messageId: string; chatId: string };
        expect(val.messageId).toBe("msg-sent-2");
        expect(val.chatId).toBe("g1");
      }
    });

    test("returns NotFoundError for unknown identity", async () => {
      setupDeps();

      const actions = createMessageActions(deps);
      const sendAction = actions.find((a) => a.id === "message.send");

      const result = await sendAction!.handler(
        { chatId: "g1", text: "Hello", identityLabel: "nonexistent" },
        stubCtx(),
      );

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error.category).toBe("not_found");
      }
    });
  });

  describe("message.list", () => {
    test("lists messages with pagination options", async () => {
      await seedIdentity("lister", { messages: sampleMessages });
      setupDeps();

      const actions = createMessageActions(deps);
      const listAction = actions.find((a) => a.id === "message.list");
      expect(listAction).toBeDefined();
      expect(listAction!.idempotent).toBe(true);

      const parsed = listAction!.input.parse({
        chatId: "g1",
        limit: "5",
        identityLabel: "lister",
      }) as {
        chatId: string;
        limit?: number;
        identityLabel?: string;
      };
      expect(parsed.limit).toBe(5);

      const result = await listAction!.handler(
        { chatId: "g1", identityLabel: "lister" },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const val = result.value as {
          chatId: string;
          messages: readonly XmtpDecodedMessage[];
        };
        expect(val.chatId).toBe("g1");
        expect(val.messages).toHaveLength(2);
        expect(val.messages[0]!.messageId).toBe("msg-aaa");
      }
    });

    test("returns not_found when credential lacks chat scope", async () => {
      await seedIdentity("unscoped-lister", { messages: sampleMessages });
      idMappings.set("g1", "conv_0123456789abcdef", "conversation");

      deps = {
        identityStore,
        getManagedClient: (id) => managedClients.get(id),
        idMappings,
        credentialLookup: async () =>
          Result.ok({
            id: "cred_1234567890abcdef",
            config: {
              operatorId: "op_1234567890abcdef",
              chatIds: ["conv_ffff456789abcdef"], // different chat
              allow: ["read-messages"],
            },
            inboxIds: [],
            status: "active",
            issuedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            issuedBy: "owner",
          } as never),
      };

      const actions = createMessageActions(deps);
      const listAction = actions.find((a) => a.id === "message.list")!;

      const result = await listAction.handler(
        { chatId: "conv_0123456789abcdef", identityLabel: "unscoped-lister" },
        {
          requestId: "test",
          signal: AbortSignal.timeout(5000),
          credentialId: "cred_1234567890abcdef",
        },
      );

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error.category).toBe("not_found");
      }
    });

    test("returns not_found when credential lacks read-messages scope", async () => {
      await seedIdentity("no-read-lister", { messages: sampleMessages });
      idMappings.set("g1", "conv_0123456789abcdef", "conversation");

      deps = {
        identityStore,
        getManagedClient: (id) => managedClients.get(id),
        idMappings,
        credentialLookup: async () =>
          Result.ok({
            id: "cred_1234567890abcdef",
            config: {
              operatorId: "op_1234567890abcdef",
              chatIds: ["conv_0123456789abcdef"],
              allow: ["send"], // no read-messages
            },
            inboxIds: [],
            status: "active",
            issuedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            issuedBy: "owner",
          } as never),
      };

      const actions = createMessageActions(deps);
      const listAction = actions.find((a) => a.id === "message.list")!;

      const result = await listAction.handler(
        { chatId: "conv_0123456789abcdef", identityLabel: "no-read-lister" },
        {
          requestId: "test",
          signal: AbortSignal.timeout(5000),
          credentialId: "cred_1234567890abcdef",
        },
      );

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error.category).toBe("not_found");
      }
    });

    test("allows admin reads when owner-approved elevation covers the chat", async () => {
      await seedIdentity("elevated-lister", { messages: sampleMessages });
      idMappings.set("g1", "conv_0123456789abcdef", "conversation");
      setupDeps();

      const actions = createMessageActions(deps);
      const listAction = actions.find((a) => a.id === "message.list")!;

      const result = await listAction.handler(
        { chatId: "conv_0123456789abcdef", identityLabel: "elevated-lister" },
        stubAdminReadCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        expect(result.value.messages).toHaveLength(2);
      }
    });

    test("rejects expired admin read elevation", async () => {
      await seedIdentity("expired-elevation-lister", {
        messages: sampleMessages,
      });
      idMappings.set("g1", "conv_0123456789abcdef", "conversation");
      setupDeps();

      const actions = createMessageActions(deps);
      const listAction = actions.find((a) => a.id === "message.list")!;

      const result = await listAction.handler(
        {
          chatId: "conv_0123456789abcdef",
          identityLabel: "expired-elevation-lister",
        },
        stubAdminReadCtx({
          expiresAt: "2026-04-13T15:59:00.000Z",
        }),
      );

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error.category).toBe("permission");
        expect(result.error.message).toContain("expired");
      }
    });

    test("rejects plain admin reads without explicit elevation", async () => {
      await seedIdentity("plain-admin-lister", { messages: sampleMessages });
      idMappings.set("g1", "conv_0123456789abcdef", "conversation");
      setupDeps();

      const actions = createMessageActions(deps);
      const listAction = actions.find((a) => a.id === "message.list")!;

      const result = await listAction.handler(
        {
          chatId: "conv_0123456789abcdef",
          identityLabel: "plain-admin-lister",
        },
        {
          requestId: "test-admin-no-elevation",
          signal: AbortSignal.timeout(5000),
          adminAuth: { adminKeyFingerprint: "admin-fingerprint-1" },
        },
      );

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error.category).toBe("permission");
        expect(result.error.message).toContain(
          "require owner-approved elevation",
        );
      }
    });
  });

  describe("message.info", () => {
    test("finds a specific message by ID", async () => {
      await seedIdentity("viewer", { messages: sampleMessages });
      setupDeps();

      const actions = createMessageActions(deps);
      const infoAction = actions.find((a) => a.id === "message.info");
      expect(infoAction).toBeDefined();
      expect(infoAction!.idempotent).toBe(true);

      const result = await infoAction!.handler(
        { chatId: "g1", messageId: "msg-bbb", identityLabel: "viewer" },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const val = result.value as XmtpDecodedMessage;
        expect(val.messageId).toBe("msg-bbb");
        expect(val.content).toBe("World");
      }
    });

    test("returns NotFoundError for unknown messageId", async () => {
      await seedIdentity("viewer", { messages: sampleMessages });
      setupDeps();

      const actions = createMessageActions(deps);
      const infoAction = actions.find((a) => a.id === "message.info");

      const result = await infoAction!.handler(
        { chatId: "g1", messageId: "msg-unknown", identityLabel: "viewer" },
        stubCtx(),
      );

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error.category).toBe("not_found");
      }
    });

    test("resolves msg_ local ID to XMTP network ID via mapping", async () => {
      await seedIdentity("viewer", { messages: sampleMessages });
      // Map XMTP network ID "msg-bbb" to local ID "msg_0123456789abcdef"
      idMappings.set("msg-bbb", "msg_0123456789abcdef", "message");
      setupDeps();

      const actions = createMessageActions(deps);
      const infoAction = actions.find((a) => a.id === "message.info");

      const result = await infoAction!.handler(
        {
          chatId: "g1",
          messageId: "msg_0123456789abcdef",
          identityLabel: "viewer",
        },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const val = result.value as XmtpDecodedMessage;
        expect(val.messageId).toBe("msg-bbb");
        expect(val.content).toBe("World");
      }
    });

    test("returns NotFoundError when message belongs to a different chat", async () => {
      await seedIdentity("viewer", { messages: sampleMessages });
      setupDeps();

      const actions = createMessageActions(deps);
      const infoAction = actions.find((a) => a.id === "message.info");

      // msg-aaa belongs to groupId "g1", but we pass chatId "other-group"
      const result = await infoAction!.handler(
        {
          chatId: "other-group",
          messageId: "msg-aaa",
          identityLabel: "viewer",
        },
        stubCtx(),
      );

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error.category).toBe("not_found");
      }
    });

    test("returns message when credential has chat in scope with read-messages", async () => {
      await seedIdentity("scoped-viewer", { messages: sampleMessages });
      idMappings.set("g1", "conv_0123456789abcdef", "conversation");

      deps = {
        identityStore,
        getManagedClient: (id) => managedClients.get(id),
        idMappings,
        credentialLookup: async () =>
          Result.ok({
            id: "cred_1234567890abcdef",
            config: {
              operatorId: "op_1234567890abcdef",
              chatIds: ["conv_0123456789abcdef"],
              allow: ["read-messages"],
            },
            inboxIds: [],
            status: "active",
            issuedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            issuedBy: "owner",
          } as never),
      };

      const actions = createMessageActions(deps);
      const infoAction = actions.find((a) => a.id === "message.info")!;

      const result = await infoAction.handler(
        {
          chatId: "conv_0123456789abcdef",
          messageId: "msg-aaa",
          identityLabel: "scoped-viewer",
        },
        {
          requestId: "test",
          signal: AbortSignal.timeout(5000),
          credentialId: "cred_1234567890abcdef",
        },
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const val = result.value as XmtpDecodedMessage;
        expect(val.messageId).toBe("msg-aaa");
      }
    });

    test("returns not_found when credential lacks chat scope (no info leakage)", async () => {
      await seedIdentity("unscoped-viewer", { messages: sampleMessages });
      idMappings.set("g1", "conv_0123456789abcdef", "conversation");
      idMappings.set("g2", "conv_ffff456789abcdef", "conversation");

      deps = {
        identityStore,
        getManagedClient: (id) => managedClients.get(id),
        idMappings,
        credentialLookup: async () =>
          Result.ok({
            id: "cred_1234567890abcdef",
            config: {
              operatorId: "op_1234567890abcdef",
              chatIds: ["conv_ffff456789abcdef"], // different chat
              allow: ["read-messages"],
            },
            inboxIds: [],
            status: "active",
            issuedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            issuedBy: "owner",
          } as never),
      };

      const actions = createMessageActions(deps);
      const infoAction = actions.find((a) => a.id === "message.info")!;

      const result = await infoAction.handler(
        {
          chatId: "conv_0123456789abcdef",
          messageId: "msg-aaa",
          identityLabel: "unscoped-viewer",
        },
        {
          requestId: "test",
          signal: AbortSignal.timeout(5000),
          credentialId: "cred_1234567890abcdef",
        },
      );

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error.category).toBe("not_found");
      }
    });

    test("returns not_found when credential lacks read-messages scope", async () => {
      await seedIdentity("no-read-viewer", { messages: sampleMessages });
      idMappings.set("g1", "conv_0123456789abcdef", "conversation");

      deps = {
        identityStore,
        getManagedClient: (id) => managedClients.get(id),
        idMappings,
        credentialLookup: async () =>
          Result.ok({
            id: "cred_1234567890abcdef",
            config: {
              operatorId: "op_1234567890abcdef",
              chatIds: ["conv_0123456789abcdef"],
              allow: ["send", "reply"], // no read-messages
            },
            inboxIds: [],
            status: "active",
            issuedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            issuedBy: "owner",
          } as never),
      };

      const actions = createMessageActions(deps);
      const infoAction = actions.find((a) => a.id === "message.info")!;

      const result = await infoAction.handler(
        {
          chatId: "conv_0123456789abcdef",
          messageId: "msg-aaa",
          identityLabel: "no-read-viewer",
        },
        {
          requestId: "test",
          signal: AbortSignal.timeout(5000),
          credentialId: "cred_1234567890abcdef",
        },
      );

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error.category).toBe("not_found");
      }
    });

    test("allows admin info reads when owner-approved elevation covers the chat", async () => {
      await seedIdentity("elevated-viewer", { messages: sampleMessages });
      idMappings.set("g1", "conv_0123456789abcdef", "conversation");
      setupDeps();

      const actions = createMessageActions(deps);
      const infoAction = actions.find((a) => a.id === "message.info")!;

      const result = await infoAction.handler(
        {
          chatId: "conv_0123456789abcdef",
          messageId: "msg-aaa",
          identityLabel: "elevated-viewer",
        },
        stubAdminReadCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        expect(result.value.messageId).toBe("msg-aaa");
      }
    });

    test("rejects admin info reads when elevation does not cover the chat", async () => {
      await seedIdentity("wrong-chat-viewer", { messages: sampleMessages });
      idMappings.set("g1", "conv_0123456789abcdef", "conversation");
      idMappings.set("g2", "conv_ffff456789abcdef", "conversation");
      setupDeps();

      const actions = createMessageActions(deps);
      const infoAction = actions.find((a) => a.id === "message.info")!;

      const result = await infoAction.handler(
        {
          chatId: "conv_0123456789abcdef",
          messageId: "msg-aaa",
          identityLabel: "wrong-chat-viewer",
        },
        stubAdminReadCtx({
          scope: {
            chatIds: ["conv_ffff456789abcdef"],
          },
        }),
      );

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error.category).toBe("permission");
        expect(result.error.message).toContain("does not cover");
      }
    });

    test("rejects plain admin info reads without explicit elevation", async () => {
      await seedIdentity("plain-admin-viewer", { messages: sampleMessages });
      idMappings.set("g1", "conv_0123456789abcdef", "conversation");
      setupDeps();

      const actions = createMessageActions(deps);
      const infoAction = actions.find((a) => a.id === "message.info")!;

      const result = await infoAction.handler(
        {
          chatId: "conv_0123456789abcdef",
          messageId: "msg-aaa",
          identityLabel: "plain-admin-viewer",
        },
        {
          requestId: "test-admin-no-elevation",
          signal: AbortSignal.timeout(5000),
          adminAuth: { adminKeyFingerprint: "admin-fingerprint-1" },
        },
      );

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error.category).toBe("permission");
        expect(result.error.message).toContain(
          "require owner-approved elevation",
        );
      }
    });
  });

  describe("message.reply", () => {
    test("sends reply content type with reference", async () => {
      const managed = await seedIdentity("replier", {
        sentMessageId: "msg-reply-1",
        messages: sampleMessages,
      });
      setupDeps();

      const actions = createMessageActions(deps);
      const replyAction = actions.find((a) => a.id === "message.reply");
      expect(replyAction).toBeDefined();

      const result = await replyAction!.handler(
        {
          chatId: "g1",
          messageId: "msg-aaa",
          text: "Reply text",
          identityLabel: "replier",
        },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const val = result.value as {
          messageId: string;
          chatId: string;
          inReplyTo: string;
        };
        expect(val.messageId).toBe("msg-reply-1");
        expect(val.chatId).toBe("g1");
        expect(val.inReplyTo).toBe("msg-aaa");
      }

      // Verify the content type was sent correctly
      const sendCalls = (
        managed.client as unknown as {
          _sendCalls: {
            groupId: string;
            content: unknown;
            contentType?: string;
          }[];
        }
      )._sendCalls;
      expect(sendCalls).toHaveLength(1);
      expect(sendCalls[0]!.contentType).toBe("reply");
      expect(sendCalls[0]!.content).toEqual({
        text: "Reply text",
        reference: "msg-aaa",
        referenceInboxId: "inbox-a",
      });
    });

    test("resolves msg_ local ID to network ID in reference", async () => {
      const managed = await seedIdentity("replier", {
        sentMessageId: "msg-reply-2",
        messages: sampleMessages,
      });
      idMappings.set("msg-aaa", "msg_0123456789abcdef", "message");
      setupDeps();

      const actions = createMessageActions(deps);
      const replyAction = actions.find((a) => a.id === "message.reply");

      const result = await replyAction!.handler(
        {
          chatId: "g1",
          messageId: "msg_0123456789abcdef",
          text: "Reply text",
          identityLabel: "replier",
        },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const val = result.value as {
          messageId: string;
          inReplyTo: string;
        };
        expect(val.inReplyTo).toBe("msg_0123456789abcdef");
      }

      const sendCalls = (
        managed.client as unknown as {
          _sendCalls: {
            groupId: string;
            content: unknown;
            contentType?: string;
          }[];
        }
      )._sendCalls;
      expect(sendCalls[0]!.content).toEqual({
        text: "Reply text",
        reference: "msg-aaa",
        referenceInboxId: "inbox-a",
      });
    });
  });

  describe("message.react", () => {
    test("sends reaction content type with reference", async () => {
      const managed = await seedIdentity("reactor", {
        sentMessageId: "msg-react-1",
        messages: sampleMessages,
      });
      setupDeps();

      const actions = createMessageActions(deps);
      const reactAction = actions.find((a) => a.id === "message.react");
      expect(reactAction).toBeDefined();

      const result = await reactAction!.handler(
        {
          chatId: "g1",
          messageId: "msg-aaa",
          reaction: "👍",
          identityLabel: "reactor",
        },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const val = result.value as {
          messageId: string;
          chatId: string;
          reactedTo: string;
        };
        expect(val.messageId).toBe("msg-react-1");
        expect(val.chatId).toBe("g1");
        expect(val.reactedTo).toBe("msg-aaa");
      }

      // Verify the content type was sent correctly
      const sendCalls = (
        managed.client as unknown as {
          _sendCalls: {
            groupId: string;
            content: unknown;
            contentType?: string;
          }[];
        }
      )._sendCalls;
      expect(sendCalls).toHaveLength(1);
      expect(sendCalls[0]!.contentType).toBe("reaction");
      expect(sendCalls[0]!.content).toEqual({
        reference: "msg-aaa",
        referenceInboxId: "inbox-a",
        action: "added",
        content: "👍",
        schema: "unicode",
      });
    });

    test("resolves msg_ local ID to network ID in reference", async () => {
      const managed = await seedIdentity("reactor", {
        sentMessageId: "msg-react-2",
        messages: sampleMessages,
      });
      idMappings.set("msg-aaa", "msg_0123456789abcdef", "message");
      setupDeps();

      const actions = createMessageActions(deps);
      const reactAction = actions.find((a) => a.id === "message.react");

      await reactAction!.handler(
        {
          chatId: "g1",
          messageId: "msg_0123456789abcdef",
          reaction: "🎉",
          identityLabel: "reactor",
        },
        stubCtx(),
      );

      const sendCalls = (
        managed.client as unknown as {
          _sendCalls: {
            groupId: string;
            content: unknown;
            contentType?: string;
          }[];
        }
      )._sendCalls;
      expect(sendCalls[0]!.content).toEqual({
        reference: "msg-aaa",
        referenceInboxId: "inbox-a",
        action: "added",
        content: "🎉",
        schema: "unicode",
      });
    });
  });

  describe("message.read", () => {
    test("sends read receipt content type", async () => {
      const managed = await seedIdentity("reader", {
        sentMessageId: "msg-receipt-1",
      });
      setupDeps();

      const actions = createMessageActions(deps);
      const readAction = actions.find((a) => a.id === "message.read");
      expect(readAction).toBeDefined();

      const result = await readAction!.handler(
        { chatId: "g1", identityLabel: "reader" },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const val = result.value as { chatId: string; markedRead: boolean };
        expect(val.chatId).toBe("g1");
        expect(val.markedRead).toBe(true);
      }

      // Verify the content type was sent correctly
      const sendCalls = (
        managed.client as unknown as {
          _sendCalls: {
            groupId: string;
            content: unknown;
            contentType?: string;
          }[];
        }
      )._sendCalls;
      expect(sendCalls).toHaveLength(1);
      expect(sendCalls[0]!.contentType).toBe("readReceipt");
      expect(sendCalls[0]!.content).toEqual({});
    });
  });

  describe("conv_ ID resolution", () => {
    test("resolves conv_ chatId to groupId via mapping", async () => {
      await seedIdentity("mapper", {
        messages: sampleMessages,
        sentMessageId: "msg-mapped-1",
      });
      // Pre-store a mapping: g1 <-> conv_0123456789abcdef
      idMappings.set("g1", "conv_0123456789abcdef", "conversation");
      setupDeps();

      const actions = createMessageActions(deps);
      const sendAction = actions.find((a) => a.id === "message.send");

      const result = await sendAction!.handler(
        {
          chatId: "conv_0123456789abcdef",
          text: "Mapped send",
          identityLabel: "mapper",
        },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const val = result.value as { messageId: string; chatId: string };
        expect(val.messageId).toBe("msg-mapped-1");
        // chatId in output should be the conv_ ID, not the groupId
        expect(val.chatId).toBe("conv_0123456789abcdef");
      }

      // Verify the underlying send used the network groupId
      const managed = managedClients.values().next().value;
      const sendCalls = (
        managed!.client as unknown as {
          _sendCalls: {
            groupId: string;
            content: unknown;
            contentType?: string;
          }[];
        }
      )._sendCalls;
      expect(sendCalls[0]!.groupId).toBe("g1");
    });
  });

  describe("first identity fallback", () => {
    test("uses first identity when no label is provided", async () => {
      await seedIdentity("default-agent", { sentMessageId: "msg-default-1" });
      setupDeps();

      const actions = createMessageActions(deps);
      const sendAction = actions.find((a) => a.id === "message.send");

      const result = await sendAction!.handler(
        { chatId: "g1", text: "Fallback" },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const val = result.value as { messageId: string };
        expect(val.messageId).toBe("msg-default-1");
      }
    });
  });
});
