import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Result } from "better-result";
import { NotFoundError } from "@xmtp/signet-schemas";
import type { SignetError } from "@xmtp/signet-schemas";
import type { HandlerContext } from "@xmtp/signet-contracts";
import { SqliteIdentityStore } from "../identity-store.js";
import type { ManagedClient } from "../client-registry.js";
import type {
  XmtpClient,
  XmtpGroupInfo,
  ConsentEntityType,
  ConsentState,
} from "../xmtp-client-factory.js";
import {
  createConsentActions,
  type ConsentActionDeps,
} from "../consent-actions.js";

/** Minimal handler context for tests. */
function stubCtx(): HandlerContext {
  return {
    requestId: "test-req-1",
    signal: AbortSignal.timeout(5_000),
  };
}

/** Create a mock XmtpClient with consent support. */
function createMockClient(options?: {
  inboxId?: string;
  consentStates?: Map<string, ConsentState>;
}): XmtpClient {
  const inboxId = options?.inboxId ?? "mock-inbox-1";
  const consentStates =
    options?.consentStates ?? new Map<string, ConsentState>();

  return {
    inboxId,
    sendMessage: async () => Result.ok("msg-1"),
    createDm: async (peerInboxId) => Result.ok({ dmId: "dm-1", peerInboxId }),
    sendDmMessage: async () => Result.ok("dm-msg-1"),
    syncAll: async () => Result.ok(),
    syncGroup: async () => Result.ok(),
    getGroupInfo: async (groupId) =>
      Result.err(NotFoundError.create("group", groupId) as SignetError),
    listGroups: async () => Result.ok([] as readonly XmtpGroupInfo[]),
    addMembers: async () => Result.ok(),
    removeMembers: async () => Result.ok(),
    updateGroupMetadata: async (groupId) =>
      Result.err(NotFoundError.create("group", groupId) as SignetError),
    leaveGroup: async () => Result.ok(),
    addAdmin: async () => Result.ok(),
    removeAdmin: async () => Result.ok(),
    addSuperAdmin: async () => Result.ok(),
    removeSuperAdmin: async () => Result.ok(),
    createGroup: async (memberInboxIds, opts) =>
      Result.ok({
        groupId: "new-group-1",
        name: opts?.name ?? "",
        description: "",
        imageUrl: undefined,
        memberInboxIds: [inboxId, ...memberInboxIds],
        createdAt: new Date().toISOString(),
      }),
    getMessageById: () => Result.ok(undefined),
    listMessages: async () => Result.ok([]),
    streamAllMessages: async () =>
      Result.ok({ messages: emptyAsyncIterable(), abort: () => {} }),
    streamGroups: async () =>
      Result.ok({ groups: emptyAsyncIterable(), abort: () => {} }),
    streamDms: async () =>
      Result.ok({ dms: emptyAsyncIterable(), abort: () => {} }),
    getConsentState: async (_entityType: ConsentEntityType, entity: string) => {
      const state = consentStates.get(entity) ?? "unknown";
      return Result.ok(state);
    },
    setConsentState: async (
      _entityType: ConsentEntityType,
      entity: string,
      state: "allowed" | "denied",
    ) => {
      consentStates.set(entity, state);
      return Result.ok(undefined);
    },
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

describe("consent actions", () => {
  let identityStore: SqliteIdentityStore;
  let managedClients: Map<string, ManagedClient>;
  let deps: ConsentActionDeps;

  beforeEach(async () => {
    identityStore = new SqliteIdentityStore(":memory:");
    managedClients = new Map();
  });

  afterEach(() => {
    identityStore.close();
  });

  function setupDeps(): void {
    deps = {
      identityStore,
      getManagedClient: (id) => managedClients.get(id),
    };
  }

  async function registerIdentity(
    label: string,
    consentStates?: Map<string, ConsentState>,
  ): Promise<string> {
    const createResult = await identityStore.create(null, label);
    if (Result.isError(createResult))
      throw new Error("Failed to create identity");
    const identity = createResult.value;
    const identityId = identity.id;
    const inboxId = `inbox-for-${label}`;
    await identityStore.setInboxId(identityId, inboxId);
    const client = createMockClient({
      inboxId,
      consentStates,
    });
    managedClients.set(identityId, {
      identityId,
      inboxId,
      client,
      groupIds: new Set(),
    });
    return identityId;
  }

  test("declares top-level semantics for consent actions", () => {
    setupDeps();
    const actions = createConsentActions(deps);

    const checkAction = actions.find((a) => a.id === "consent.check");
    const allowAction = actions.find((a) => a.id === "consent.allow");
    const denyAction = actions.find((a) => a.id === "consent.deny");

    expect(checkAction).toBeDefined();
    expect(checkAction?.description).toBe("Check consent state for an entity");
    expect(checkAction?.intent).toBe("read");
    expect(checkAction?.idempotent).toBe(true);
    expect(checkAction?.http?.auth).toBe("admin");

    expect(allowAction).toBeDefined();
    expect(allowAction?.description).toBe("Allow messages from an entity");
    expect(allowAction?.intent).toBe("write");
    expect(allowAction?.http?.auth).toBe("admin");

    expect(denyAction).toBeDefined();
    expect(denyAction?.description).toBe("Deny messages from an entity");
    expect(denyAction?.intent).toBe("write");
    expect(denyAction?.http?.auth).toBe("admin");
  });

  test("consent.check returns unknown for new entity", async () => {
    setupDeps();
    await registerIdentity("test-identity");
    const actions = createConsentActions(deps);
    const check = actions.find((a) => a.id === "consent.check")!;

    const result = await check.handler(
      { entity: "some-inbox-id", entityType: "inbox_id" },
      stubCtx(),
    );

    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value).toEqual({
        entity: "some-inbox-id",
        entityType: "inbox_id",
        state: "unknown",
      });
    }
  });

  test("consent.allow sets state to allowed", async () => {
    setupDeps();
    const consentStates = new Map<string, ConsentState>();
    await registerIdentity("test-identity", consentStates);
    const actions = createConsentActions(deps);
    const allow = actions.find((a) => a.id === "consent.allow")!;

    const result = await allow.handler(
      { entity: "peer-inbox", entityType: "inbox_id" },
      stubCtx(),
    );

    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value).toEqual({
        entity: "peer-inbox",
        entityType: "inbox_id",
        state: "allowed",
      });
    }
    expect(consentStates.get("peer-inbox")).toBe("allowed");
  });

  test("consent.deny sets state to denied", async () => {
    setupDeps();
    const consentStates = new Map<string, ConsentState>();
    await registerIdentity("test-identity", consentStates);
    const actions = createConsentActions(deps);
    const deny = actions.find((a) => a.id === "consent.deny")!;

    const result = await deny.handler(
      { entity: "peer-inbox", entityType: "inbox_id" },
      stubCtx(),
    );

    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value).toEqual({
        entity: "peer-inbox",
        entityType: "inbox_id",
        state: "denied",
      });
    }
    expect(consentStates.get("peer-inbox")).toBe("denied");
  });

  test("consent.check reflects previously set state", async () => {
    setupDeps();
    const consentStates = new Map<string, ConsentState>();
    consentStates.set("known-inbox", "allowed");
    await registerIdentity("test-identity", consentStates);
    const actions = createConsentActions(deps);
    const check = actions.find((a) => a.id === "consent.check")!;

    const result = await check.handler(
      { entity: "known-inbox", entityType: "inbox_id" },
      stubCtx(),
    );

    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value.state).toBe("allowed");
    }
  });

  test("consent.check defaults entityType to inbox_id", async () => {
    setupDeps();
    await registerIdentity("test-identity");
    const actions = createConsentActions(deps);
    const check = actions.find((a) => a.id === "consent.check")!;

    const result = await check.handler({ entity: "some-entity" }, stubCtx());

    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value.entityType).toBe("inbox_id");
    }
  });

  test("consent.allow with group_id entity type", async () => {
    setupDeps();
    const consentStates = new Map<string, ConsentState>();
    await registerIdentity("test-identity", consentStates);
    const actions = createConsentActions(deps);
    const allow = actions.find((a) => a.id === "consent.allow")!;

    const result = await allow.handler(
      { entity: "group-abc", entityType: "group_id" },
      stubCtx(),
    );

    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value.entityType).toBe("group_id");
      expect(result.value.state).toBe("allowed");
    }
  });

  test("consent actions return error when no identity exists", async () => {
    setupDeps();
    const actions = createConsentActions(deps);
    const check = actions.find((a) => a.id === "consent.check")!;

    const result = await check.handler({ entity: "some-inbox" }, stubCtx());

    expect(Result.isError(result)).toBe(true);
  });

  test("consent.check with identityLabel resolves specific identity", async () => {
    setupDeps();
    const consentStates = new Map<string, ConsentState>();
    consentStates.set("target-inbox", "denied");
    await registerIdentity("primary");
    await registerIdentity("secondary", consentStates);
    const actions = createConsentActions(deps);
    const check = actions.find((a) => a.id === "consent.check")!;

    const result = await check.handler(
      { entity: "target-inbox", identityLabel: "secondary" },
      stubCtx(),
    );

    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value.state).toBe("denied");
    }
  });

  test("has examples for consent.check", () => {
    setupDeps();
    const actions = createConsentActions(deps);
    const check = actions.find((a) => a.id === "consent.check")!;

    expect(check.examples).toBeDefined();
    expect(check.examples!.length).toBeGreaterThan(0);
    expect(check.examples![0]!.name).toBe("check inbox consent");
  });
});
