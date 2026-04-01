import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { Result } from "better-result";
import { NotFoundError } from "@xmtp/signet-schemas";
import type { SignetError, IdMappingStore } from "@xmtp/signet-schemas";
import type { HandlerContext } from "@xmtp/signet-contracts";
import { SqliteIdentityStore } from "../identity-store.js";
import { createSqliteIdMappingStore } from "../id-mapping-store.js";
import type { ManagedClient } from "../client-registry.js";
import type {
  XmtpClient,
  XmtpDecodedMessage,
  XmtpGroupInfo,
} from "../xmtp-client-factory.js";
import {
  createSearchActions,
  type SearchActionDeps,
} from "../search-actions.js";

/** Minimal handler context for tests. */
function stubCtx(): HandlerContext {
  return {
    requestId: "test-req-1",
    signal: AbortSignal.timeout(5_000),
  };
}

/** Create a mock XmtpClient with configurable messages and groups. */
function createMockClient(options?: {
  inboxId?: string;
  messages?: Record<string, XmtpDecodedMessage[]>;
  groups?: XmtpGroupInfo[];
}): XmtpClient {
  const inboxId = options?.inboxId ?? "mock-inbox-1";
  const messagesByGroup = options?.messages ?? {};
  const groups = options?.groups ?? [];

  return {
    inboxId,
    sendMessage: async () => Result.ok("msg-1"),
    createDm: async (peerInboxId) => Result.ok({ dmId: "dm-1", peerInboxId }),
    sendDmMessage: async () => Result.ok("dm-msg-1"),
    syncAll: async () => Result.ok(),
    syncGroup: async () => Result.ok(),
    getGroupInfo: async (groupId) => {
      const group = groups.find((g) => g.groupId === groupId);
      if (!group) {
        return Result.err(
          NotFoundError.create("group", groupId) as SignetError,
        );
      }
      return Result.ok(group);
    },
    listGroups: async () => Result.ok(groups),
    addMembers: async () => Result.ok(),
    removeMembers: async () => Result.ok(),
    createGroup: async (memberInboxIds, opts) =>
      Result.ok({
        groupId: "new-group-1",
        name: opts?.name ?? "",
        description: "",
        memberInboxIds: [inboxId, ...memberInboxIds],
        createdAt: new Date().toISOString(),
      }),
    listMessages: async (groupId) => Result.ok(messagesByGroup[groupId] ?? []),
    streamAllMessages: async () =>
      Result.ok({ messages: emptyAsyncIterable(), abort: () => {} }),
    streamGroups: async () =>
      Result.ok({ groups: emptyAsyncIterable(), abort: () => {} }),
    getConsentState: async () => Result.ok("unknown" as const),
    setConsentState: async () => Result.ok(undefined),
  };
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

function makeMessage(
  groupId: string,
  content: string,
  msgId?: string,
): XmtpDecodedMessage {
  return {
    messageId: msgId ?? `msg-${Math.random().toString(36).slice(2, 8)}`,
    groupId,
    senderInboxId: "sender-inbox-1",
    contentType: "text",
    content,
    sentAt: "2026-03-30T12:00:00.000Z",
    threadId: null,
  };
}

function makeGroup(groupId: string, name: string): XmtpGroupInfo {
  return {
    groupId,
    name,
    description: "",
    memberInboxIds: ["mock-inbox-1"],
    createdAt: "2026-03-30T12:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("createSearchActions", () => {
  let identityStore: SqliteIdentityStore;
  let idMappings: IdMappingStore;

  beforeEach(() => {
    identityStore = new SqliteIdentityStore(":memory:");
    idMappings = createSqliteIdMappingStore(new Database(":memory:"));
  });

  /** Create an identity in the store and return its ID. */
  async function seedIdentity(): Promise<string> {
    const createResult = await identityStore.create(null, "test");
    expect(createResult.isOk()).toBe(true);
    const identity = createResult.value;
    await identityStore.setInboxId(identity.id, "mock-inbox-1");
    return identity.id;
  }

  function buildDeps(
    client: XmtpClient,
    extra?: Partial<SearchActionDeps>,
  ): SearchActionDeps {
    const managedClient: ManagedClient = {
      identityId: "identity-1",
      inboxId: "mock-inbox-1",
      client,
    };
    return {
      identityStore,
      getManagedClient: () => managedClient,
      idMappings,
      ...extra,
    };
  }

  // -----------------------------------------------------------------------
  // search.messages
  // -----------------------------------------------------------------------

  describe("search.messages", () => {
    test("returns matching messages from a single conversation", async () => {
      await seedIdentity();

      const msgs: Record<string, XmtpDecodedMessage[]> = {
        "group-1": [
          makeMessage("group-1", "Hello world"),
          makeMessage("group-1", "Goodbye world"),
          makeMessage("group-1", "No match here"),
        ],
      };
      const groups = [makeGroup("group-1", "Test Group")];
      const client = createMockClient({ messages: msgs, groups });
      const deps = buildDeps(client);
      const actions = createSearchActions(deps);

      const spec = actions.find((a) => a.id === "search.messages");
      expect(spec).toBeDefined();

      const result = await spec!.handler!(
        { query: "world", chatId: "group-1" },
        stubCtx(),
      );
      expect(Result.isOk(result)).toBe(true);
      const value = (result as { value: { matches: unknown[]; total: number } })
        .value;
      expect(value.matches).toHaveLength(2);
      expect(value.total).toBe(2);
    });

    test("searches across all conversations when no chatId", async () => {
      await seedIdentity();

      const msgs: Record<string, XmtpDecodedMessage[]> = {
        "group-1": [makeMessage("group-1", "alpha match")],
        "group-2": [
          makeMessage("group-2", "beta match"),
          makeMessage("group-2", "no hit"),
        ],
      };
      const groups = [
        makeGroup("group-1", "Group A"),
        makeGroup("group-2", "Group B"),
      ];
      const client = createMockClient({ messages: msgs, groups });
      const deps = buildDeps(client);
      const actions = createSearchActions(deps);

      const spec = actions.find((a) => a.id === "search.messages");
      const result = await spec!.handler!({ query: "match" }, stubCtx());
      expect(Result.isOk(result)).toBe(true);
      const value = (result as { value: { matches: unknown[]; total: number } })
        .value;
      expect(value.matches).toHaveLength(2);
    });

    test("respects limit parameter", async () => {
      await seedIdentity();

      const msgs: Record<string, XmtpDecodedMessage[]> = {
        "group-1": [
          makeMessage("group-1", "match 1"),
          makeMessage("group-1", "match 2"),
          makeMessage("group-1", "match 3"),
        ],
      };
      const groups = [makeGroup("group-1", "G1")];
      const client = createMockClient({ messages: msgs, groups });
      const deps = buildDeps(client);
      const actions = createSearchActions(deps);

      const spec = actions.find((a) => a.id === "search.messages");
      const result = await spec!.handler!(
        { query: "match", chatId: "group-1", limit: 2 },
        stubCtx(),
      );
      expect(Result.isOk(result)).toBe(true);
      const value = (result as { value: { matches: unknown[]; total: number } })
        .value;
      expect(value.matches).toHaveLength(2);
    });

    test("case-insensitive matching", async () => {
      await seedIdentity();

      const msgs: Record<string, XmtpDecodedMessage[]> = {
        "group-1": [makeMessage("group-1", "Hello World")],
      };
      const groups = [makeGroup("group-1", "G1")];
      const client = createMockClient({ messages: msgs, groups });
      const deps = buildDeps(client);
      const actions = createSearchActions(deps);

      const spec = actions.find((a) => a.id === "search.messages");
      const result = await spec!.handler!(
        { query: "hello", chatId: "group-1" },
        stubCtx(),
      );
      expect(Result.isOk(result)).toBe(true);
      const value = (result as { value: { matches: unknown[]; total: number } })
        .value;
      expect(value.matches).toHaveLength(1);
    });

    test("returns empty when no matches", async () => {
      await seedIdentity();

      const msgs: Record<string, XmtpDecodedMessage[]> = {
        "group-1": [makeMessage("group-1", "nothing here")],
      };
      const groups = [makeGroup("group-1", "G1")];
      const client = createMockClient({ messages: msgs, groups });
      const deps = buildDeps(client);
      const actions = createSearchActions(deps);

      const spec = actions.find((a) => a.id === "search.messages");
      const result = await spec!.handler!(
        { query: "zzzzz", chatId: "group-1" },
        stubCtx(),
      );
      expect(Result.isOk(result)).toBe(true);
      const value = (result as { value: { matches: unknown[]; total: number } })
        .value;
      expect(value.matches).toHaveLength(0);
    });

    test("errors when no identity exists", async () => {
      const client = createMockClient();
      const deps = buildDeps(client);
      const actions = createSearchActions(deps);

      const spec = actions.find((a) => a.id === "search.messages");
      const result = await spec!.handler!({ query: "test" }, stubCtx());
      expect(Result.isError(result)).toBe(true);
    });

    test("skips non-string message content", async () => {
      await seedIdentity();

      const msgs: Record<string, XmtpDecodedMessage[]> = {
        "group-1": [
          {
            messageId: "msg-obj",
            groupId: "group-1",
            senderInboxId: "sender-1",
            contentType: "custom",
            content: { foo: "bar" },
            sentAt: "2026-03-30T12:00:00.000Z",
            threadId: null,
          },
          makeMessage("group-1", "text match"),
        ],
      };
      const groups = [makeGroup("group-1", "G1")];
      const client = createMockClient({ messages: msgs, groups });
      const deps = buildDeps(client);
      const actions = createSearchActions(deps);

      const spec = actions.find((a) => a.id === "search.messages");
      const result = await spec!.handler!(
        { query: "match", chatId: "group-1" },
        stubCtx(),
      );
      expect(Result.isOk(result)).toBe(true);
      const value = (result as { value: { matches: unknown[]; total: number } })
        .value;
      expect(value.matches).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // search.resources
  // -----------------------------------------------------------------------

  describe("search.resources", () => {
    test("searches operators by label", async () => {
      const mockOperatorManager = {
        list: async () =>
          Result.ok([
            {
              id: "op_1234567890abcdef",
              config: { label: "My Bot", role: "agent", scopeMode: "scoped" },
              createdAt: "2026-03-30T00:00:00Z",
              createdBy: "owner",
              status: "active",
            },
            {
              id: "op_fedcba0987654321",
              config: {
                label: "Other Agent",
                role: "agent",
                scopeMode: "scoped",
              },
              createdAt: "2026-03-30T00:00:00Z",
              createdBy: "owner",
              status: "active",
            },
          ]),
        lookup: async () => Result.err(NotFoundError.create("operator", "x")),
        create: async () => Result.err(NotFoundError.create("operator", "x")),
        update: async () => Result.err(NotFoundError.create("operator", "x")),
        remove: async () => Result.err(NotFoundError.create("operator", "x")),
      };

      const client = createMockClient();
      const deps = buildDeps(client, {
        operatorManager: mockOperatorManager as never,
      });
      const actions = createSearchActions(deps);

      const spec = actions.find((a) => a.id === "search.resources");
      const result = await spec!.handler!(
        { query: "bot", type: "operator" },
        stubCtx(),
      );
      expect(Result.isOk(result)).toBe(true);
      const value = (result as { value: { matches: unknown[] } }).value;
      expect(value.matches).toHaveLength(1);
    });

    test("searches policies by label", async () => {
      const mockPolicyManager = {
        list: async () =>
          Result.ok([
            {
              id: "policy_1234567890abcdef",
              config: { label: "Read Only", allow: [], deny: [] },
              createdAt: "2026-03-30T00:00:00Z",
            },
          ]),
        lookup: async () => Result.err(NotFoundError.create("policy", "x")),
        create: async () => Result.err(NotFoundError.create("policy", "x")),
        update: async () => Result.err(NotFoundError.create("policy", "x")),
        remove: async () => Result.err(NotFoundError.create("policy", "x")),
      };

      const client = createMockClient();
      const deps = buildDeps(client, {
        policyManager: mockPolicyManager as never,
      });
      const actions = createSearchActions(deps);

      const spec = actions.find((a) => a.id === "search.resources");
      const result = await spec!.handler!(
        { query: "read", type: "policy" },
        stubCtx(),
      );
      expect(Result.isOk(result)).toBe(true);
      const value = (result as { value: { matches: unknown[] } }).value;
      expect(value.matches).toHaveLength(1);
    });

    test("searches conversations by name", async () => {
      await seedIdentity();

      const groups = [
        makeGroup("group-1", "Project Alpha"),
        makeGroup("group-2", "Project Beta"),
      ];
      const client = createMockClient({ groups });
      const deps = buildDeps(client);
      const actions = createSearchActions(deps);

      const spec = actions.find((a) => a.id === "search.resources");
      const result = await spec!.handler!(
        { query: "alpha", type: "conversation" },
        stubCtx(),
      );
      expect(Result.isOk(result)).toBe(true);
      const value = (result as { value: { matches: unknown[] } }).value;
      expect(value.matches).toHaveLength(1);
    });

    test("searches across all resource types when no type filter", async () => {
      await seedIdentity();

      const mockOperatorManager = {
        list: async () =>
          Result.ok([
            {
              id: "op_1234567890abcdef",
              config: {
                label: "test-agent",
                role: "agent",
                scopeMode: "scoped",
              },
              createdAt: "2026-03-30T00:00:00Z",
              createdBy: "owner",
              status: "active",
            },
          ]),
        lookup: async () => Result.err(NotFoundError.create("operator", "x")),
        create: async () => Result.err(NotFoundError.create("operator", "x")),
        update: async () => Result.err(NotFoundError.create("operator", "x")),
        remove: async () => Result.err(NotFoundError.create("operator", "x")),
      };

      const groups = [makeGroup("group-1", "test-group")];
      const client = createMockClient({ groups });
      const deps = buildDeps(client, {
        operatorManager: mockOperatorManager as never,
      });
      const actions = createSearchActions(deps);

      const spec = actions.find((a) => a.id === "search.resources");
      const result = await spec!.handler!({ query: "test" }, stubCtx());
      expect(Result.isOk(result)).toBe(true);
      const value = (
        result as {
          value: { matches: { type: string }[] };
        }
      ).value;
      // Should find both the operator and the conversation
      const types = value.matches.map((m) => m.type);
      expect(types).toContain("operator");
      expect(types).toContain("conversation");
    });

    test("respects limit", async () => {
      const mockOperatorManager = {
        list: async () =>
          Result.ok([
            {
              id: "op_aaaa567890abcdef",
              config: {
                label: "match-a",
                role: "agent",
                scopeMode: "scoped",
              },
              createdAt: "2026-03-30T00:00:00Z",
              createdBy: "owner",
              status: "active",
            },
            {
              id: "op_bbbb567890abcdef",
              config: {
                label: "match-b",
                role: "agent",
                scopeMode: "scoped",
              },
              createdAt: "2026-03-30T00:00:00Z",
              createdBy: "owner",
              status: "active",
            },
            {
              id: "op_cccc567890abcdef",
              config: {
                label: "match-c",
                role: "agent",
                scopeMode: "scoped",
              },
              createdAt: "2026-03-30T00:00:00Z",
              createdBy: "owner",
              status: "active",
            },
          ]),
        lookup: async () => Result.err(NotFoundError.create("operator", "x")),
        create: async () => Result.err(NotFoundError.create("operator", "x")),
        update: async () => Result.err(NotFoundError.create("operator", "x")),
        remove: async () => Result.err(NotFoundError.create("operator", "x")),
      };

      const client = createMockClient();
      const deps = buildDeps(client, {
        operatorManager: mockOperatorManager as never,
      });
      const actions = createSearchActions(deps);

      const spec = actions.find((a) => a.id === "search.resources");
      const result = await spec!.handler!(
        { query: "match", type: "operator", limit: 2 },
        stubCtx(),
      );
      expect(Result.isOk(result)).toBe(true);
      const value = (result as { value: { matches: unknown[] } }).value;
      expect(value.matches).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Action metadata
  // -----------------------------------------------------------------------

  describe("action metadata", () => {
    test("exposes two actions with correct IDs", () => {
      const client = createMockClient();
      const deps = buildDeps(client);
      const actions = createSearchActions(deps);
      expect(actions).toHaveLength(2);
      expect(actions.map((a) => a.id).sort()).toEqual([
        "search.messages",
        "search.resources",
      ]);
    });

    test("both actions are idempotent reads", () => {
      const client = createMockClient();
      const deps = buildDeps(client);
      const actions = createSearchActions(deps);
      for (const action of actions) {
        expect(action.intent).toBe("read");
        expect(action.idempotent).toBe(true);
      }
    });
  });
});
