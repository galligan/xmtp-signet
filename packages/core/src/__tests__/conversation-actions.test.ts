import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { Result } from "better-result";
import { NotFoundError } from "@xmtp/signet-schemas";
import type { SignetError, IdMappingStore } from "@xmtp/signet-schemas";
import type { HandlerContext } from "@xmtp/signet-contracts";
import { SqliteIdentityStore } from "../identity-store.js";
import { createSqliteIdMappingStore } from "../id-mapping-store.js";
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
          NotFoundError.create("group", groupId) as SignetError,
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
  let idMappings: IdMappingStore;
  let mappingDb: Database;
  let managedClients: Map<string, ManagedClient>;
  let deps: ConversationActionDeps;

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

  function setupDeps(
    getGroupInfoFn?: (
      groupId: string,
    ) => Promise<Result<XmtpGroupInfo, SignetError>>,
  ): void {
    deps = {
      identityStore,
      getManagedClient: (id) => managedClients.get(id),
      getGroupInfo:
        getGroupInfoFn ??
        (async (groupId) =>
          Result.err(NotFoundError.create("group", groupId) as SignetError)),
      idMappings,
    };
  }

  test("declares top-level semantics and curated HTTP auth for surfaced actions", () => {
    setupDeps();

    const actions = createConversationActions(deps);
    const createAction = actions.find((a) => a.id === "chat.create");
    const listAction = actions.find((a) => a.id === "chat.list");
    const inviteAction = actions.find((a) => a.id === "chat.invite");
    const membersAction = actions.find((a) => a.id === "chat.members");

    expect(createAction?.description).toBe("Create a new group conversation");
    expect(createAction?.intent).toBe("write");
    expect(createAction?.http?.auth).toBe("admin");

    expect(listAction?.intent).toBe("read");
    expect(listAction?.idempotent).toBe(true);
    expect(listAction?.http?.auth).toBe("admin");

    expect(inviteAction?.intent).toBe("write");
    expect(inviteAction?.http?.auth).toBe("admin");

    expect(membersAction?.intent).toBe("read");
    expect(membersAction?.idempotent).toBe(true);
    expect(membersAction?.http?.auth).toBe("admin");
  });

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

  describe("chat.create", () => {
    test("creates a group with members and returns metadata", async () => {
      const managed = await seedIdentity("agent-1");
      setupDeps();

      const actions = createConversationActions(deps);
      const createAction = actions.find((a) => a.id === "chat.create");
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
          chatId: string;
          groupId: string;
          name: string;
          creatorInboxId: string;
          memberCount: number;
        };
        expect(val.groupId).toBe("new-group-1");
        expect(val.chatId).toStartWith("conv_");
        expect(val.creatorInboxId).toBe(managed.inboxId);
        expect(val.memberCount).toBe(3); // creator + 2 peers
        // Verify mapping was stored
        expect(idMappings.getLocal("new-group-1")).toBe(val.chatId);
        expect(idMappings.getNetwork(val.chatId)).toBe("new-group-1");
      }
    });

    test("creates a group with empty members (creator-only)", async () => {
      await seedIdentity("solo");
      setupDeps();

      const actions = createConversationActions(deps);
      const createAction = actions.find((a) => a.id === "chat.create");

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
      const createAction = actions.find((a) => a.id === "chat.create");

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
      const createAction = actions.find((a) => a.id === "chat.create");

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

  describe("chat.list", () => {
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
      const listAction = actions.find((a) => a.id === "chat.list");
      expect(listAction).toBeDefined();

      const result = await listAction!.handler(
        { identityLabel: "lister" },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const val = result.value as {
          groups: readonly (XmtpGroupInfo & { chatId?: string })[];
        };
        expect(val.groups).toHaveLength(1);
        expect(val.groups[0]!.groupId).toBe("g1");
        expect(val.groups[0]!.chatId).toStartWith("conv_");
        // Verify mapping was stored
        expect(idMappings.getLocal("g1")).toBe(val.groups[0]!.chatId);
      }
    });
  });

  describe("chat.info", () => {
    test("returns group details via deps.getGroupInfo with raw groupId", async () => {
      const groupInfo: XmtpGroupInfo = {
        groupId: "g-info",
        name: "Test Group",
        description: "A test group",
        memberInboxIds: ["inbox-a", "inbox-b"],
        createdAt: new Date().toISOString(),
      };
      setupDeps(async () => Result.ok(groupInfo));

      const actions = createConversationActions(deps);
      const infoAction = actions.find((a) => a.id === "chat.info");
      expect(infoAction).toBeDefined();

      const result = await infoAction!.handler({ chatId: "g-info" }, stubCtx());

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const val = result.value as XmtpGroupInfo & { chatId: string };
        expect(val.groupId).toBe("g-info");
        expect(val.chatId).toBe("g-info");
        expect(val.name).toBe("Test Group");
        expect(val.memberInboxIds).toHaveLength(2);
      }
    });

    test("resolves conv_ ID to groupId via mapping", async () => {
      const groupInfo: XmtpGroupInfo = {
        groupId: "g-mapped",
        name: "Mapped Group",
        description: "A mapped group",
        memberInboxIds: ["inbox-x"],
        createdAt: new Date().toISOString(),
      };
      // Pre-store a mapping
      idMappings.set("g-mapped", "conv_0123456789abcdef", "conversation");
      setupDeps(async (groupId) => {
        if (groupId === "g-mapped") return Result.ok(groupInfo);
        return Result.err(
          NotFoundError.create("group", groupId) as SignetError,
        );
      });

      const actions = createConversationActions(deps);
      const infoAction = actions.find((a) => a.id === "chat.info");

      const result = await infoAction!.handler(
        { chatId: "conv_0123456789abcdef" },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const val = result.value as XmtpGroupInfo & { chatId: string };
        expect(val.groupId).toBe("g-mapped");
        expect(val.chatId).toBe("conv_0123456789abcdef");
      }
    });
  });

  describe("chat.add-member", () => {
    test("adds a member to a group and returns updated member count", async () => {
      const testGroup: XmtpGroupInfo = {
        groupId: "g-add",
        name: "Add Test",
        description: "",
        memberInboxIds: ["inbox-owner"],
        createdAt: new Date().toISOString(),
      };
      const managed = await seedIdentity("adder");
      // Replace client with one that has the group and tracks addMembers
      const addedMembers: string[] = [];
      const client = createMockClient({
        inboxId: managed.inboxId,
        groups: [testGroup],
      });
      // Override addMembers to track calls and simulate adding
      const trackedClient: XmtpClient = {
        ...client,
        addMembers: async (_groupId, inboxIds) => {
          addedMembers.push(...inboxIds);
          return Result.ok();
        },
        getGroupInfo: async (groupId) => {
          if (groupId === "g-add") {
            return Result.ok({
              ...testGroup,
              memberInboxIds: [...testGroup.memberInboxIds, ...addedMembers],
            });
          }
          return Result.err(
            NotFoundError.create("group", groupId) as SignetError,
          );
        },
      };
      managedClients.set(managed.identityId, {
        ...managed,
        client: trackedClient,
      });
      setupDeps(async (groupId) => trackedClient.getGroupInfo(groupId));

      const actions = createConversationActions(deps);
      const addMemberAction = actions.find((a) => a.id === "chat.add-member");
      expect(addMemberAction).toBeDefined();

      const result = await addMemberAction!.handler(
        { chatId: "g-add", inboxId: "inbox-new-member" },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const val = result.value as {
          chatId: string;
          groupId: string;
          memberCount: number;
        };
        expect(val.groupId).toBe("g-add");
        expect(val.chatId).toBe("g-add");
        expect(val.memberCount).toBe(2); // original + new
      }
      expect(addedMembers).toEqual(["inbox-new-member"]);
    });

    test("returns NotFoundError for unknown identity label", async () => {
      setupDeps();

      const actions = createConversationActions(deps);
      const addMemberAction = actions.find((a) => a.id === "chat.add-member");
      expect(addMemberAction).toBeDefined();

      const result = await addMemberAction!.handler(
        {
          chatId: "g1",
          inboxId: "inbox-1",
          identityLabel: "nonexistent",
        },
        stubCtx(),
      );

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error.category).toBe("not_found");
      }
    });
  });

  describe("chat.members", () => {
    test("returns member list for a group", async () => {
      const testGroup: XmtpGroupInfo = {
        groupId: "g-members",
        name: "Members Test",
        description: "",
        memberInboxIds: ["inbox-a", "inbox-b", "inbox-c"],
        createdAt: new Date().toISOString(),
      };
      setupDeps(async () => Result.ok(testGroup));

      const actions = createConversationActions(deps);
      const membersAction = actions.find((a) => a.id === "chat.members");
      expect(membersAction).toBeDefined();

      const result = await membersAction!.handler(
        { chatId: "g-members" },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const val = result.value as {
          chatId: string;
          groupId: string;
          members: readonly string[];
          memberCount: number;
        };
        expect(val.groupId).toBe("g-members");
        expect(val.chatId).toBe("g-members");
        expect(val.members).toEqual(["inbox-a", "inbox-b", "inbox-c"]);
        expect(val.memberCount).toBe(3);
      }
    });

    test("returns NotFoundError for unknown group", async () => {
      setupDeps(); // default returns NotFoundError

      const actions = createConversationActions(deps);
      const membersAction = actions.find((a) => a.id === "chat.members");

      const result = await membersAction!.handler(
        { chatId: "nonexistent" },
        stubCtx(),
      );

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error.category).toBe("not_found");
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
      const listAction = actions.find((a) => a.id === "chat.list");

      const result = await listAction!.handler({}, stubCtx());

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const val = result.value as {
          groups: readonly (XmtpGroupInfo & { chatId?: string })[];
        };
        expect(val.groups).toHaveLength(1);
        expect(val.groups[0]!.chatId).toStartWith("conv_");
      }
    });
  });
});
