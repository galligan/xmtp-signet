import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { Result } from "better-result";
import { InternalError, NotFoundError } from "@xmtp/signet-schemas";
import type { SignetError, IdMappingStore } from "@xmtp/signet-schemas";
import type { HandlerContext, OperatorManager } from "@xmtp/signet-contracts";
import { SqliteIdentityStore } from "../identity-store.js";
import { createSqliteIdMappingStore } from "../id-mapping-store.js";
import type { ManagedClient } from "../client-registry.js";
import type {
  SignerProviderLike,
  XmtpClient,
  XmtpClientFactory,
  XmtpGroupInfo,
} from "../xmtp-client-factory.js";
import {
  createConversationActions,
  type ConversationActionDeps,
} from "../conversation-actions.js";
import { generateConvosInviteUrl } from "../schemes/convos/invite-generator.js";
import { createConvosOnboardingScheme } from "../schemes/convos/onboarding-scheme.js";
import { extractProfileUpdateContent } from "../schemes/convos/profile-state.js";

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
    updateGroupMetadata: async (groupId, changes) => {
      const g = groups.find((x) => x.groupId === groupId);
      if (!g) {
        return Result.err(
          NotFoundError.create("group", groupId) as SignetError,
        );
      }
      return Result.ok({
        ...g,
        name: changes.name ?? g.name,
        description: changes.description ?? g.description,
        imageUrl: changes.imageUrl ?? g.imageUrl,
      });
    },
    leaveGroup: async () => Result.ok(),
    addAdmin: async () => Result.ok(),
    removeAdmin: async () => Result.ok(),
    addSuperAdmin: async () => Result.ok(),
    removeSuperAdmin: async () => Result.ok(),
    createGroup: async (memberInboxIds, opts) => {
      if (createdGroup) return Result.ok(createdGroup);
      return Result.ok({
        groupId: "new-group-1",
        name: opts?.name ?? "",
        description: "",
        imageUrl: undefined,
        memberInboxIds: [inboxId, ...memberInboxIds],
        createdAt: new Date().toISOString(),
      });
    },
    getMessageById: () => Result.ok(undefined),
    streamAllMessages: async () =>
      Result.ok({ messages: emptyAsyncIterable(), abort: () => {} }),
    streamGroups: async () =>
      Result.ok({ groups: emptyAsyncIterable(), abort: () => {} }),
    streamDms: async () =>
      Result.ok({ dms: emptyAsyncIterable(), abort: () => {} }),
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

const JOIN_TEST_PRIVATE_KEY_HEX =
  "0000000000000000000000000000000000000000000000000000000000000001";
const JOIN_TEST_CREATOR_INBOX_ID =
  "aabbccddee1122334455667788990011aabbccddee1122334455667788990011";

async function buildJoinInviteUrl(): Promise<string> {
  const inviteUrl = await generateConvosInviteUrl({
    conversationId: "joined-group-1",
    creatorInboxId: JOIN_TEST_CREATOR_INBOX_ID,
    walletPrivateKeyHex: JOIN_TEST_PRIVATE_KEY_HEX,
    inviteTag: "join-action-tag",
    name: "Joined Group",
    env: "dev",
  });
  if (!inviteUrl.isOk()) {
    throw new Error("Failed to generate join test invite URL");
  }
  return inviteUrl.value;
}

function createJoinMockSignerProvider(): SignerProviderLike {
  const dbKey = new Uint8Array(32).fill(0xab);
  const signerKey =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

  return {
    sign: () => Promise.resolve(Result.ok(new Uint8Array(64))),
    getPublicKey: () => Promise.resolve(Result.ok(new Uint8Array(32))),
    getFingerprint: () => Promise.resolve(Result.ok("join-test-fingerprint")),
    getDbEncryptionKey: () => Promise.resolve(Result.ok(dbKey)),
    getXmtpIdentityKey: () => Promise.resolve(Result.ok(signerKey)),
  };
}

function createJoinMockClient(): XmtpClient {
  let syncCount = 0;
  const joinedGroup: XmtpGroupInfo = {
    groupId: "joined-group-1",
    name: "Joined Group",
    description: "",
    memberInboxIds: ["joiner-inbox-123", JOIN_TEST_CREATOR_INBOX_ID],
    createdAt: new Date().toISOString(),
  };
  const notImplemented = () => {
    throw new Error("Not implemented in join test stub");
  };

  return {
    inboxId: "joiner-inbox-123",
    sendMessage: async () => Result.ok("join-msg-1"),
    createDm: async (peerInboxId) => Result.ok({ dmId: "dm-1", peerInboxId }),
    sendDmMessage: async () => Result.ok("dm-msg-1"),
    syncAll: async () => {
      syncCount += 1;
      return Result.ok();
    },
    syncGroup: notImplemented,
    getGroupInfo: notImplemented,
    listGroups: async () => Result.ok(syncCount > 0 ? [joinedGroup] : []),
    addMembers: notImplemented,
    removeMembers: notImplemented,
    updateGroupMetadata: notImplemented,
    leaveGroup: notImplemented,
    addAdmin: notImplemented,
    removeAdmin: notImplemented,
    addSuperAdmin: notImplemented,
    removeSuperAdmin: notImplemented,
    createGroup: notImplemented,
    getMessageById: notImplemented,
    listMessages: async () => Result.ok([]),
    streamAllMessages: async () =>
      Result.ok({ messages: emptyAsyncIterable(), abort: () => {} }),
    streamGroups: async () =>
      Result.ok({ groups: emptyAsyncIterable(), abort: () => {} }),
    streamDms: async () =>
      Result.ok({ dms: emptyAsyncIterable(), abort: () => {} }),
    getConsentState: async () => Result.ok("unknown" as const),
    setConsentState: async () => Result.ok(undefined),
  };
}

function createOperatorManager(
  labels: Record<string, string>,
): OperatorManager {
  return {
    create: async () => Result.err(InternalError.create("not implemented")),
    list: async () => Result.err(InternalError.create("not implemented")),
    lookup: async (operatorId) => {
      const label = labels[operatorId];
      if (!label) {
        return Result.err(
          NotFoundError.create("operator", operatorId) as SignetError,
        );
      }
      return Result.ok({
        id: operatorId,
        config: {
          label,
          role: "operator",
          scopeMode: "per-chat",
          provider: "internal",
        },
        createdAt: new Date().toISOString(),
        createdBy: "owner",
        status: "active",
      });
    },
    update: async () => Result.err(InternalError.create("not implemented")),
    remove: async () => Result.err(InternalError.create("not implemented")),
  };
}

describe("conversation actions", () => {
  const onboardingScheme = createConvosOnboardingScheme();
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
    cleanupLocalState?: ConversationActionDeps["cleanupLocalState"],
    operatorManager?: OperatorManager,
  ): void {
    deps = {
      onboardingScheme,
      identityStore,
      ...(operatorManager ? { operatorManager } : {}),
      getManagedClient: (id) => managedClients.get(id),
      getManagedClientForGroup: (groupId) =>
        [...managedClients.values()].find((managed) =>
          managed.groupIds.has(groupId),
        ),
      getGroupInfo:
        getGroupInfoFn ??
        (async (groupId) =>
          Result.err(NotFoundError.create("group", groupId) as SignetError)),
      idMappings,
      cleanupLocalState,
    };
  }

  test("declares top-level semantics and curated HTTP auth for surfaced actions", () => {
    setupDeps();

    const actions = createConversationActions(deps);
    const createAction = actions.find((a) => a.id === "chat.create");
    const listAction = actions.find((a) => a.id === "chat.list");
    const inviteAction = actions.find((a) => a.id === "chat.invite");
    const membersAction = actions.find((a) => a.id === "chat.members");
    const updateAction = actions.find((a) => a.id === "chat.update");
    const leaveAction = actions.find((a) => a.id === "chat.leave");
    const rmAction = actions.find((a) => a.id === "chat.rm");
    const updateProfileAction = actions.find(
      (a) => a.id === "chat.update-profile",
    );
    const removeMemberAction = actions.find(
      (a) => a.id === "chat.remove-member",
    );
    const promoteAction = actions.find((a) => a.id === "chat.promote-member");
    const demoteAction = actions.find((a) => a.id === "chat.demote-member");

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

    expect(updateAction?.intent).toBe("write");
    expect(updateAction?.http?.auth).toBe("admin");

    expect(updateProfileAction?.intent).toBe("write");
    expect(updateProfileAction?.http?.auth).toBe("admin");

    expect(leaveAction?.intent).toBe("write");
    expect(leaveAction?.http?.auth).toBe("admin");

    expect(rmAction?.intent).toBe("write");
    expect(rmAction?.http?.auth).toBe("admin");

    expect(removeMemberAction?.intent).toBe("write");
    expect(removeMemberAction?.http?.auth).toBe("admin");

    expect(promoteAction?.intent).toBe("write");
    expect(promoteAction?.http?.auth).toBe("admin");

    expect(demoteAction?.intent).toBe("write");
    expect(demoteAction?.http?.auth).toBe("admin");
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

  describe("chat.join", () => {
    test("attaches the joined identity to the live runtime after a successful join", async () => {
      const attachedIdentityIds: string[] = [];
      const inviteUrl = await buildJoinInviteUrl();
      const joinClient = createJoinMockClient();
      const joinClientFactory: XmtpClientFactory = {
        create: async () => Result.ok(joinClient),
      };

      deps = {
        onboardingScheme,
        identityStore,
        getManagedClient: (id) => managedClients.get(id),
        getManagedClientForGroup: (groupId) =>
          [...managedClients.values()].find((managed) =>
            managed.groupIds.has(groupId),
          ),
        getGroupInfo: async (groupId) =>
          Result.err(NotFoundError.create("group", groupId) as SignetError),
        idMappings,
        clientFactory: joinClientFactory,
        signerProviderFactory: () => createJoinMockSignerProvider(),
        attachManagedIdentity: async (identityId) => {
          attachedIdentityIds.push(identityId);
          return Result.ok(undefined);
        },
        config: {
          dataDir: ":memory:",
          env: "dev",
          appVersion: "xmtp-signet/test",
        },
      };

      const actions = createConversationActions(deps);
      const joinAction = actions.find((a) => a.id === "chat.join");
      expect(joinAction).toBeDefined();
      if (!joinAction) return;

      const result = await joinAction.handler(
        {
          inviteUrl,
          label: "joiner",
          timeoutSeconds: 2,
        },
        stubCtx(),
      );

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      expect(result.value.groupId).toBe("joined-group-1");
      expect(result.value.profileApplied).toBe(true);
      expect(attachedIdentityIds).toEqual([result.value.identityId]);
    });

    test("defaults the profile name from the operator label when requested", async () => {
      const inviteUrl = await buildJoinInviteUrl();
      const joinClient = createJoinMockClient();
      const joinClientFactory: XmtpClientFactory = {
        create: async () => Result.ok(joinClient),
      };

      deps = {
        onboardingScheme,
        identityStore,
        operatorManager: createOperatorManager({ op_codex: "Codex" }),
        getManagedClient: (id) => managedClients.get(id),
        getManagedClientForGroup: (groupId) =>
          [...managedClients.values()].find((managed) =>
            managed.groupIds.has(groupId),
          ),
        getGroupInfo: async (groupId) =>
          Result.err(NotFoundError.create("group", groupId) as SignetError),
        idMappings,
        clientFactory: joinClientFactory,
        signerProviderFactory: () => createJoinMockSignerProvider(),
        config: {
          dataDir: ":memory:",
          env: "dev",
          appVersion: "xmtp-signet/test",
        },
      };

      const actions = createConversationActions(deps);
      const joinAction = actions.find((a) => a.id === "chat.join");
      expect(joinAction).toBeDefined();
      if (!joinAction) return;

      const result = await joinAction.handler(
        {
          inviteUrl,
          label: "joiner",
          operatorId: "op_codex",
          timeoutSeconds: 2,
        },
        stubCtx(),
      );

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      expect(result.value.profileName).toBe("Codex");
      expect(result.value.profileSource).toBe("operator-default");
      expect(result.value.profileApplied).toBe(true);
    });

    test("returns success even when live attach fails after the durable join completes", async () => {
      const inviteUrl = await buildJoinInviteUrl();
      const joinClient = createJoinMockClient();
      const joinClientFactory: XmtpClientFactory = {
        create: async () => Result.ok(joinClient),
      };

      deps = {
        onboardingScheme,
        identityStore,
        getManagedClient: (id) => managedClients.get(id),
        getManagedClientForGroup: (groupId) =>
          [...managedClients.values()].find((managed) =>
            managed.groupIds.has(groupId),
          ),
        getGroupInfo: async (groupId) =>
          Result.err(NotFoundError.create("group", groupId) as SignetError),
        idMappings,
        clientFactory: joinClientFactory,
        signerProviderFactory: () => createJoinMockSignerProvider(),
        attachManagedIdentity: async () =>
          Result.err(NotFoundError.create("identity", "attach-failed")),
        config: {
          dataDir: ":memory:",
          env: "dev",
          appVersion: "xmtp-signet/test",
        },
      };

      const actions = createConversationActions(deps);
      const joinAction = actions.find((a) => a.id === "chat.join");
      expect(joinAction).toBeDefined();
      if (!joinAction) return;

      const result = await joinAction.handler(
        {
          inviteUrl,
          label: "joiner",
          timeoutSeconds: 2,
        },
        stubCtx(),
      );

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      expect(result.value.groupId).toBe("joined-group-1");
      expect(result.value.profileApplied).toBe(true);
    });
  });

  describe("chat.update-profile", () => {
    test("publishes a profile update with an explicit name", async () => {
      const managed = await seedIdentity("profile-updater");
      managed.groupIds.add("g-profile");
      const sent: Array<{
        groupId: string;
        content: unknown;
        contentType: string | undefined;
      }> = [];
      const trackedClient: XmtpClient = {
        ...createMockClient({ inboxId: managed.inboxId }),
        sendMessage: async (groupId, content, contentType) => {
          sent.push({ groupId, content, contentType });
          return Result.ok("profile-msg-1");
        },
      };
      managedClients.set(managed.identityId, {
        ...managed,
        client: trackedClient,
      });
      setupDeps();

      const actions = createConversationActions(deps);
      const updateProfileAction = actions.find(
        (a) => a.id === "chat.update-profile",
      );
      expect(updateProfileAction).toBeDefined();
      if (!updateProfileAction) return;

      const result = await updateProfileAction.handler(
        {
          chatId: "g-profile",
          identityLabel: "profile-updater",
          profileName: "Codex",
        },
        stubCtx(),
      );

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      expect(result.value).toEqual({
        chatId: "g-profile",
        groupId: "g-profile",
        profileName: "Codex",
        profileSource: "explicit",
        profileApplied: true,
      });
      expect(sent).toHaveLength(1);
      expect(sent[0]?.groupId).toBe("g-profile");
      expect(sent[0]?.contentType).toBe("convos.org/profile_update:1.0");
      expect(extractProfileUpdateContent(sent[0]?.content)).toEqual({
        name: "Codex",
        memberKind: 1,
      });
    });

    test("defaults the profile name from the operator label", async () => {
      const managed = await seedIdentity("profile-updater");
      managed.groupIds.add("g-profile");
      const sent: Array<{ content: unknown }> = [];
      const trackedClient: XmtpClient = {
        ...createMockClient({ inboxId: managed.inboxId }),
        sendMessage: async (_groupId, content) => {
          sent.push({ content });
          return Result.ok("profile-msg-2");
        },
      };
      managedClients.set(managed.identityId, {
        ...managed,
        client: trackedClient,
      });
      setupDeps(
        undefined,
        undefined,
        createOperatorManager({ op_codex: "Codex" }),
      );

      const actions = createConversationActions(deps);
      const updateProfileAction = actions.find(
        (a) => a.id === "chat.update-profile",
      );
      expect(updateProfileAction).toBeDefined();
      if (!updateProfileAction) return;

      const result = await updateProfileAction.handler(
        {
          chatId: "g-profile",
          operatorId: "op_codex",
        },
        stubCtx(),
      );

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      expect(result.value.profileName).toBe("Codex");
      expect(result.value.profileSource).toBe("operator-default");
      expect(sent).toHaveLength(1);
      expect(extractProfileUpdateContent(sent[0]?.content)).toEqual({
        name: "Codex",
        memberKind: 1,
      });
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
      managed.groupIds.add("g-add");
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

  describe("chat.update", () => {
    test("updates group metadata and returns refreshed group info", async () => {
      const managed = await seedIdentity("updater");
      managed.groupIds.add("g-update");
      const updates: Array<Record<string, string>> = [];
      const trackedClient: XmtpClient = {
        ...createMockClient({
          inboxId: managed.inboxId,
          groups: [
            {
              groupId: "g-update",
              name: "Old Name",
              description: "Old Description",
              imageUrl: undefined,
              memberInboxIds: [managed.inboxId],
              createdAt: new Date().toISOString(),
            },
          ],
        }),
        updateGroupMetadata: async (_groupId, changes) => {
          updates.push({
            ...(changes.name ? { name: changes.name } : {}),
            ...(changes.description
              ? { description: changes.description }
              : {}),
            ...(changes.imageUrl ? { imageUrl: changes.imageUrl } : {}),
          });
          return Result.ok({
            groupId: "g-update",
            name: changes.name ?? "Old Name",
            description: changes.description ?? "Old Description",
            imageUrl: changes.imageUrl,
            memberInboxIds: [managed.inboxId],
            createdAt: new Date().toISOString(),
          });
        },
      };
      managedClients.set(managed.identityId, {
        ...managed,
        client: trackedClient,
      });
      setupDeps(async () =>
        Result.ok({
          groupId: "g-update",
          name: "New Name",
          description: "New Description",
          imageUrl: "https://example.com/group.png",
          memberInboxIds: [managed.inboxId],
          createdAt: new Date().toISOString(),
        }),
      );

      const actions = createConversationActions(deps);
      const updateAction = actions.find((a) => a.id === "chat.update");
      expect(updateAction).toBeDefined();

      const result = await updateAction!.handler(
        {
          chatId: "g-update",
          name: "New Name",
          description: "New Description",
          imageUrl: "https://example.com/group.png",
        },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        const value = result.value as XmtpGroupInfo & { chatId: string };
        expect(value.chatId).toBe("g-update");
        expect(value.name).toBe("New Name");
        expect(value.description).toBe("New Description");
        expect(value.imageUrl).toBe("https://example.com/group.png");
      }
      expect(updates).toEqual([
        {
          name: "New Name",
          description: "New Description",
          imageUrl: "https://example.com/group.png",
        },
      ]);
    });
  });

  describe("chat.leave", () => {
    test("leaves a group without purge by default", async () => {
      const managed = await seedIdentity("leaver");
      managed.groupIds.add("g-leave");
      let left = false;
      const trackedClient: XmtpClient = {
        ...createMockClient({ inboxId: managed.inboxId }),
        leaveGroup: async () => {
          left = true;
          return Result.ok();
        },
      };
      managedClients.set(managed.identityId, {
        ...managed,
        client: trackedClient,
      });
      setupDeps();

      const actions = createConversationActions(deps);
      const leaveAction = actions.find((a) => a.id === "chat.leave");
      expect(leaveAction).toBeDefined();

      const result = await leaveAction!.handler(
        { chatId: "g-leave" },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        expect(result.value).toEqual({
          chatId: "g-leave",
          groupId: "g-leave",
          leftGroup: true,
          purged: false,
        });
      }
      expect(left).toBe(true);
    });

    test("runs local cleanup when purge is requested", async () => {
      const managed = await seedIdentity("purger");
      managed.groupIds.add("g-purge");
      let left = false;
      const cleanupCalls: Array<{
        chatId?: string;
        groupId: string;
        execute: boolean;
        reason: "rm" | "leave-purge";
      }> = [];
      const trackedClient: XmtpClient = {
        ...createMockClient({ inboxId: managed.inboxId }),
        leaveGroup: async () => {
          left = true;
          return Result.ok();
        },
      };
      managedClients.set(managed.identityId, {
        ...managed,
        client: trackedClient,
      });
      setupDeps(undefined, async (input) => {
        cleanupCalls.push(input);
        return Result.ok({
          executed: input.execute,
          actions: ["removed local identity", "revoked scoped credentials"],
        });
      });

      const actions = createConversationActions(deps);
      const leaveAction = actions.find((a) => a.id === "chat.leave");

      const result = await leaveAction!.handler(
        { chatId: "g-purge", purge: true },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        expect(result.value).toEqual({
          chatId: "g-purge",
          groupId: "g-purge",
          leftGroup: true,
          purged: true,
          cleanup: {
            executed: true,
            actions: ["removed local identity", "revoked scoped credentials"],
          },
        });
      }
      expect(left).toBe(true);
      expect(cleanupCalls).toEqual([
        {
          chatId: "g-purge",
          groupId: "g-purge",
          execute: true,
          reason: "leave-purge",
        },
      ]);
    });
  });

  describe("chat.rm", () => {
    test("returns a dry-run preview by default", async () => {
      const cleanupCalls: Array<{
        chatId?: string;
        groupId: string;
        execute: boolean;
        reason: "rm" | "leave-purge";
      }> = [];
      setupDeps(undefined, async (input) => {
        cleanupCalls.push(input);
        return Result.ok({
          executed: input.execute,
          actions: ["remove conv_ mapping", "revoke scoped credentials"],
        });
      });

      const actions = createConversationActions(deps);
      const rmAction = actions.find((a) => a.id === "chat.rm");
      expect(rmAction).toBeDefined();

      const result = await rmAction!.handler(
        { chatId: "g-local-only" },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        expect(result.value).toEqual({
          chatId: "g-local-only",
          groupId: "g-local-only",
          removed: false,
          cleanup: {
            executed: false,
            actions: ["remove conv_ mapping", "revoke scoped credentials"],
          },
        });
      }
      expect(cleanupCalls).toEqual([
        {
          chatId: "g-local-only",
          groupId: "g-local-only",
          execute: false,
          reason: "rm",
        },
      ]);
    });

    test("executes cleanup when force is true", async () => {
      const cleanupCalls: Array<{
        chatId?: string;
        groupId: string;
        execute: boolean;
        reason: "rm" | "leave-purge";
      }> = [];
      setupDeps(undefined, async (input) => {
        cleanupCalls.push(input);
        return Result.ok({
          executed: input.execute,
          actions: ["remove conv_ mapping", "revoke scoped credentials"],
        });
      });

      const actions = createConversationActions(deps);
      const rmAction = actions.find((a) => a.id === "chat.rm");

      const result = await rmAction!.handler(
        { chatId: "g-local-only", force: true },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        expect(result.value).toEqual({
          chatId: "g-local-only",
          groupId: "g-local-only",
          removed: true,
          cleanup: {
            executed: true,
            actions: ["remove conv_ mapping", "revoke scoped credentials"],
          },
        });
      }
      expect(cleanupCalls).toEqual([
        {
          chatId: "g-local-only",
          groupId: "g-local-only",
          execute: true,
          reason: "rm",
        },
      ]);
    });
  });

  describe("chat.remove-member", () => {
    test("removes a member from a group and returns updated member count", async () => {
      const managed = await seedIdentity("member-remover");
      managed.groupIds.add("g-remove-member");
      const removedMembers: string[] = [];
      const trackedClient: XmtpClient = {
        ...createMockClient({
          inboxId: managed.inboxId,
          groups: [
            {
              groupId: "g-remove-member",
              name: "Remove Test",
              description: "",
              imageUrl: undefined,
              memberInboxIds: [managed.inboxId, "inbox-remove-me"],
              createdAt: new Date().toISOString(),
            },
          ],
        }),
        removeMembers: async (_groupId, inboxIds) => {
          removedMembers.push(...inboxIds);
          return Result.ok();
        },
        getGroupInfo: async () =>
          Result.ok({
            groupId: "g-remove-member",
            name: "Remove Test",
            description: "",
            imageUrl: undefined,
            memberInboxIds: [managed.inboxId],
            createdAt: new Date().toISOString(),
          }),
      };
      managedClients.set(managed.identityId, {
        ...managed,
        client: trackedClient,
      });
      setupDeps(async () => trackedClient.getGroupInfo("g-remove-member"));

      const actions = createConversationActions(deps);
      const removeMemberAction = actions.find(
        (a) => a.id === "chat.remove-member",
      );
      expect(removeMemberAction).toBeDefined();

      const result = await removeMemberAction!.handler(
        { chatId: "g-remove-member", inboxId: "inbox-remove-me" },
        stubCtx(),
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        expect(result.value).toEqual({
          chatId: "g-remove-member",
          groupId: "g-remove-member",
          memberCount: 1,
        });
      }
      expect(removedMembers).toEqual(["inbox-remove-me"]);
    });
  });

  describe("chat role changes", () => {
    test("promotes and demotes a member via admin role methods", async () => {
      const managed = await seedIdentity("moderator");
      managed.groupIds.add("g-admin");
      const calls: string[] = [];
      const trackedClient: XmtpClient = {
        ...createMockClient({ inboxId: managed.inboxId }),
        addAdmin: async (_groupId, inboxId) => {
          calls.push(`promote:${inboxId}`);
          return Result.ok();
        },
        removeAdmin: async (_groupId, inboxId) => {
          calls.push(`demote:${inboxId}`);
          return Result.ok();
        },
      };
      managedClients.set(managed.identityId, {
        ...managed,
        client: trackedClient,
      });
      setupDeps();

      const actions = createConversationActions(deps);
      const promoteAction = actions.find((a) => a.id === "chat.promote-member");
      const demoteAction = actions.find((a) => a.id === "chat.demote-member");
      expect(promoteAction).toBeDefined();
      expect(demoteAction).toBeDefined();

      const promoteResult = await promoteAction!.handler(
        { chatId: "g-admin", inboxId: "inbox-a" },
        stubCtx(),
      );
      const demoteResult = await demoteAction!.handler(
        { chatId: "g-admin", inboxId: "inbox-a" },
        stubCtx(),
      );

      expect(Result.isOk(promoteResult)).toBe(true);
      expect(Result.isOk(demoteResult)).toBe(true);
      if (Result.isOk(promoteResult)) {
        expect(promoteResult.value).toEqual({
          chatId: "g-admin",
          groupId: "g-admin",
          inboxId: "inbox-a",
          role: "admin",
        });
      }
      if (Result.isOk(demoteResult)) {
        expect(demoteResult.value).toEqual({
          chatId: "g-admin",
          groupId: "g-admin",
          inboxId: "inbox-a",
          role: "member",
        });
      }
      expect(calls).toEqual(["promote:inbox-a", "demote:inbox-a"]);
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
