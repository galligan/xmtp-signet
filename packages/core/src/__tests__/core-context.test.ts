import { describe, expect, test, beforeEach } from "bun:test";
import { SignetCoreContext } from "../core-context.js";
import { ClientRegistry } from "../client-registry.js";
import { SqliteIdentityStore } from "../identity-store.js";
import type { ManagedClient } from "../client-registry.js";
import { createMockXmtpClient } from "./fixtures.js";
import type { XmtpGroupInfo } from "../xmtp-client-factory.js";

const testGroup: XmtpGroupInfo = {
  groupId: "group-1",
  name: "Test Group",
  description: "A test group",
  memberInboxIds: ["inbox-a", "inbox-b"],
  createdAt: "2024-01-01T00:00:00.000Z",
};

let registry: ClientRegistry;
let identityStore: SqliteIdentityStore;
let ctx: SignetCoreContext;

beforeEach(() => {
  registry = new ClientRegistry();
  identityStore = new SqliteIdentityStore(":memory:");
  ctx = new SignetCoreContext(registry, identityStore);
});

function registerClientForGroup(
  identityId: string,
  groupId: string,
  groups?: XmtpGroupInfo[],
): ManagedClient {
  const client = createMockXmtpClient({
    inboxId: `inbox-${identityId}`,
    groups: groups ?? [testGroup],
  });
  const managed: ManagedClient = {
    identityId,
    inboxId: client.inboxId,
    client,
    groupIds: new Set([groupId]),
  };
  registry.register(managed);
  return managed;
}

describe("SignetCoreContext", () => {
  describe("sendMessage", () => {
    test("sends through the correct client", async () => {
      registerClientForGroup("id-1", "group-1");

      const result = await ctx.sendMessage("group-1", "text", "hello");
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.messageId).toBeTruthy();
      }
    });

    test("returns NotFoundError for unknown group", async () => {
      const result = await ctx.sendMessage("unknown", "text", "hello");
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error._tag).toBe("NotFoundError");
      }
    });
  });

  describe("getGroupInfo", () => {
    test("returns group info from client", async () => {
      registerClientForGroup("id-1", "group-1");

      const result = await ctx.getGroupInfo("group-1");
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.groupId).toBe("group-1");
        expect(result.value.name).toBe("Test Group");
        expect(result.value.memberInboxIds).toEqual(["inbox-a", "inbox-b"]);
      }
    });

    test("returns NotFoundError for unknown group", async () => {
      const result = await ctx.getGroupInfo("unknown");
      expect(result.isErr()).toBe(true);
    });
  });

  describe("listGroups", () => {
    test("aggregates groups from all clients", async () => {
      const group2: XmtpGroupInfo = {
        ...testGroup,
        groupId: "group-2",
        name: "Group 2",
      };

      registerClientForGroup("id-1", "group-1", [testGroup]);
      registerClientForGroup("id-2", "group-2", [group2]);

      const result = await ctx.listGroups();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
      }
    });

    test("returns empty when no clients", async () => {
      const result = await ctx.listGroups();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });
  });

  describe("addMembers", () => {
    test("delegates to correct client", async () => {
      registerClientForGroup("id-1", "group-1");

      const result = await ctx.addMembers("group-1", ["inbox-new"]);
      expect(result.isOk()).toBe(true);
    });

    test("returns NotFoundError for unknown group", async () => {
      const result = await ctx.addMembers("unknown", ["inbox-1"]);
      expect(result.isErr()).toBe(true);
    });
  });

  describe("removeMembers", () => {
    test("delegates to correct client", async () => {
      registerClientForGroup("id-1", "group-1");

      const result = await ctx.removeMembers("group-1", ["inbox-b"]);
      expect(result.isOk()).toBe(true);
    });

    test("returns NotFoundError for unknown group", async () => {
      const result = await ctx.removeMembers("unknown", ["inbox-1"]);
      expect(result.isErr()).toBe(true);
    });
  });

  describe("getInboxId", () => {
    test("returns inbox ID from registry for hydrated shared group", async () => {
      // Shared identity: no per-group identity in the store,
      // but the group is hydrated in the runtime registry.
      const managed: ManagedClient = {
        identityId: "shared-id",
        inboxId: "shared-inbox-42",
        client: createMockXmtpClient({ inboxId: "shared-inbox-42" }),
        groupIds: new Set(["shared-group-1"]),
      };
      registry.register(managed);

      const result = await ctx.getInboxId("shared-group-1");
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe("shared-inbox-42");
      }
    });

    test("falls back to identity store for per-group identities", async () => {
      const created = await identityStore.create("group-1");
      if (!created.isOk()) return;
      await identityStore.setInboxId(created.value.id, "inbox-123");

      const result = await ctx.getInboxId("group-1");
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe("inbox-123");
      }
    });

    test("returns NotFoundError when no identity for group", async () => {
      const result = await ctx.getInboxId("unknown-group");
      expect(result.isErr()).toBe(true);
    });

    test("returns NotFoundError when identity has no inboxId", async () => {
      await identityStore.create("group-1");

      const result = await ctx.getInboxId("group-1");
      expect(result.isErr()).toBe(true);
    });
  });

  describe("syncGroup", () => {
    test("delegates to correct client", async () => {
      registerClientForGroup("id-1", "group-1");

      const result = await ctx.syncGroup("group-1");
      expect(result.isOk()).toBe(true);
    });

    test("returns NotFoundError for unknown group", async () => {
      const result = await ctx.syncGroup("unknown");
      expect(result.isErr()).toBe(true);
    });
  });
});
