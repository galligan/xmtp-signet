import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Result } from "better-result";
import { NotFoundError } from "@xmtp-broker/schemas";
import type { BrokerError } from "@xmtp-broker/schemas";
import type { HandlerContext } from "@xmtp-broker/contracts";
import { SqliteIdentityStore } from "../identity-store.js";
import type { ManagedClient } from "../client-registry.js";
import type { XmtpClient, XmtpGroupInfo } from "../xmtp-client-factory.js";
import {
  createConversationActions,
  type ConversationActionDeps,
} from "../conversation-actions.js";

/** Minimal handler context for tests. */
function stubCtx(): HandlerContext {
  return {
    requestId: "test-req-1",
    signal: AbortSignal.timeout(5_000),
  };
}

/** Create a mock XmtpClient with group support. */
function createMockClient(options?: {
  inboxId?: string;
  groups?: XmtpGroupInfo[];
  createdGroup?: XmtpGroupInfo;
}): XmtpClient {
  const inboxId = options?.inboxId ?? "mock-inbox-1";
  const groups = options?.groups ?? [];
  const createdGroup = options?.createdGroup;

  return {
    inboxId,
    sendMessage: async () => Result.ok("msg-1"),
    createDm: async (peerInboxId) => Result.ok({ dmId: `dm-1`, peerInboxId }),
    sendDmMessage: async () => Result.ok("dm-msg-1"),
    syncAll: async () => Result.ok(),
    syncGroup: async () => Result.ok(),
    getGroupInfo: async (groupId) => {
      const g = groups.find((x) => x.groupId === groupId);
      if (!g) {
        return Result.err(
          NotFoundError.create("group", groupId) as BrokerError,
        );
      }
      return Result.ok(g);
    },
    listGroups: async () => Result.ok(groups),
    addMembers: async () => Result.ok(),
    removeMembers: async () => Result.ok(),
    createGroup: async (memberInboxIds, opts) => {
      if (createdGroup) return Result.ok(createdGroup);
      return Result.ok({
        groupId: "new-group-1",
        name: opts?.name ?? "",
        description: "",
        memberInboxIds: [inboxId, ...memberInboxIds],
        createdAt: new Date().toISOString(),
      });
    },
    streamAllMessages: async () =>
      Result.ok({ messages: emptyAsyncIterable(), abort: () => {} }),
    streamGroups: async () =>
      Result.ok({ groups: emptyAsyncIterable(), abort: () => {} }),
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

describe("conversation actions", () => {
  let identityStore: SqliteIdentityStore;
  let managedClients: Map<string, ManagedClient>;
  let deps: ConversationActionDeps;

  beforeEach(async () => {
    identityStore = new SqliteIdentityStore(":memory:");
    managedClients = new Map();
  });

  afterEach(() => {
    identityStore.close();
  });

  function setupDeps(
    getGroupInfoFn?: (
      groupId: string,
    ) => Promise<Result<XmtpGroupInfo, BrokerError>>,
  ): void {
    deps = {
      identityStore,
      getManagedClient: (id) => managedClients.get(id),
      getGroupInfo:
        getGroupInfoFn ??
        (async (groupId) =>
          Result.err(NotFoundError.create("group", groupId) as BrokerError)),
    };
  }

  /** Seed an identity and a managed client in the test harness. */
  async function seedIdentity(label: string): Promise<ManagedClient> {
    const identityResult = await identityStore.create(null, label);
    expect(identityResult.isOk()).toBe(true);
    const identity = identityResult.value;

    const client = createMockClient({ inboxId: `inbox-${identity.id}` });
    const managed: ManagedClient = {
      identityId: identity.id,
      inboxId: client.inboxId,
      client,
      groupIds: new Set(),
    };
    managedClients.set(identity.id, managed);
    return managed;
  }

  describe("conversation.create", () => {
    test("creates a group with members and returns metadata", async () => {
      const managed = await seedIdentity("agent-1");
      setupDeps();

      const actions = createConversationActions(deps);
      const createAction = actions.find((a) => a.id === "conversation.create");
      expect(createAction).toBeDefined();

      const result = await createAction!.handler(
        {
          memberInboxIds: ["inbox-peer-1", "inbox-peer-2"],
          creatorIdentityLabel: "agent-1",
        },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const val = result.value as {
          groupId: string;
          name: string;
          creatorInboxId: string;
          memberCount: number;
        };
        expect(val.groupId).toBe("new-group-1");
        expect(val.creatorInboxId).toBe(managed.inboxId);
        expect(val.memberCount).toBe(3); // creator + 2 peers
      }
    });

    test("creates a group with empty members (creator-only)", async () => {
      await seedIdentity("solo");
      setupDeps();

      const actions = createConversationActions(deps);
      const createAction = actions.find((a) => a.id === "conversation.create");

      const result = await createAction!.handler(
        {
          memberInboxIds: [],
          creatorIdentityLabel: "solo",
        },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const val = result.value as { memberCount: number };
        expect(val.memberCount).toBe(1);
      }
    });

    test("returns NotFoundError for unknown identity label", async () => {
      setupDeps();

      const actions = createConversationActions(deps);
      const createAction = actions.find((a) => a.id === "conversation.create");

      const result = await createAction!.handler(
        {
          memberInboxIds: ["inbox-1"],
          creatorIdentityLabel: "nonexistent",
        },
        stubCtx(),
      );

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error.category).toBe("not_found");
      }
    });

    test("returns NotFoundError when managed client is missing", async () => {
      // Create identity but don't register a managed client
      const identityResult = await identityStore.create(null, "orphan");
      expect(identityResult.isOk()).toBe(true);
      setupDeps();

      const actions = createConversationActions(deps);
      const createAction = actions.find((a) => a.id === "conversation.create");

      const result = await createAction!.handler(
        {
          memberInboxIds: ["inbox-1"],
          creatorIdentityLabel: "orphan",
        },
        stubCtx(),
      );

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error.category).toBe("not_found");
      }
    });
  });

  describe("conversation.list", () => {
    test("delegates to SDK client listGroups", async () => {
      const testGroups: XmtpGroupInfo[] = [
        {
          groupId: "g1",
          name: "Group 1",
          description: "",
          memberInboxIds: ["inbox-a"],
          createdAt: new Date().toISOString(),
        },
      ];
      const managed = await seedIdentity("lister");
      // Replace the client with one that has groups
      const clientWithGroups = createMockClient({
        inboxId: managed.inboxId,
        groups: testGroups,
      });
      managedClients.set(managed.identityId, {
        ...managed,
        client: clientWithGroups,
      });
      setupDeps();

      const actions = createConversationActions(deps);
      const listAction = actions.find((a) => a.id === "conversation.list");
      expect(listAction).toBeDefined();

      const result = await listAction!.handler(
        { identityLabel: "lister" },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const val = result.value as { groups: readonly XmtpGroupInfo[] };
        expect(val.groups).toHaveLength(1);
        expect(val.groups[0]!.groupId).toBe("g1");
      }
    });
  });

  describe("conversation.info", () => {
    test("returns group details via deps.getGroupInfo", async () => {
      const groupInfo: XmtpGroupInfo = {
        groupId: "g-info",
        name: "Test Group",
        description: "A test group",
        memberInboxIds: ["inbox-a", "inbox-b"],
        createdAt: new Date().toISOString(),
      };
      setupDeps(async () => Result.ok(groupInfo));

      const actions = createConversationActions(deps);
      const infoAction = actions.find((a) => a.id === "conversation.info");
      expect(infoAction).toBeDefined();

      const result = await infoAction!.handler(
        { groupId: "g-info" },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const val = result.value as XmtpGroupInfo;
        expect(val.groupId).toBe("g-info");
        expect(val.name).toBe("Test Group");
        expect(val.memberInboxIds).toHaveLength(2);
      }
    });
  });

  describe("conversation.list with first identity fallback", () => {
    test("uses first identity when no label is provided", async () => {
      const testGroups: XmtpGroupInfo[] = [
        {
          groupId: "g-fallback",
          name: "Fallback Group",
          description: "",
          memberInboxIds: ["inbox-first"],
          createdAt: new Date().toISOString(),
        },
      ];
      const managed = await seedIdentity("first-agent");
      const clientWithGroups = createMockClient({
        inboxId: managed.inboxId,
        groups: testGroups,
      });
      managedClients.set(managed.identityId, {
        ...managed,
        client: clientWithGroups,
      });
      setupDeps();

      const actions = createConversationActions(deps);
      const listAction = actions.find((a) => a.id === "conversation.list");

      const result = await listAction!.handler({}, stubCtx());

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const val = result.value as { groups: readonly XmtpGroupInfo[] };
        expect(val.groups).toHaveLength(1);
      }
    });
  });
});
