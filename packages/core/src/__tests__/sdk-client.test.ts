import { describe, expect, test } from "bun:test";
import { createSdkClient } from "../sdk/sdk-client.js";
import {
  createMockSdkNativeClient,
  createMockGroup,
  createMockDecodedMessage,
  createMockAsyncStreamProxy,
} from "./sdk-fixtures.js";

describe("createSdkClient", () => {
  test("exposes inboxId from underlying client", () => {
    const native = createMockSdkNativeClient({ inboxId: "inbox-42" });
    const client = createSdkClient({ client: native, syncTimeoutMs: 5000 });
    expect(client.inboxId).toBe("inbox-42");
  });

  describe("sendMessage", () => {
    test("sends text to the correct group", async () => {
      let capturedText = "";
      const group = createMockGroup({ id: "g1" });
      group.sendText = async (text: string) => {
        capturedText = text;
        return "msg-id-1";
      };
      const native = createMockSdkNativeClient({ groups: [group] });
      const client = createSdkClient({ client: native, syncTimeoutMs: 5000 });

      const result = await client.sendMessage("g1", "hello world");
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe("msg-id-1");
      }
      expect(capturedText).toBe("hello world");
    });

    test("returns NotFoundError for unknown group", async () => {
      const native = createMockSdkNativeClient({ groups: [] });
      const client = createSdkClient({ client: native, syncTimeoutMs: 5000 });

      const result = await client.sendMessage("nonexistent", "hello");
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error._tag).toBe("NotFoundError");
      }
    });
  });

  describe("syncAll", () => {
    test("calls conversations.sync then syncAll", async () => {
      const calls: string[] = [];
      const native = createMockSdkNativeClient();
      native.conversations.sync = async () => {
        calls.push("sync");
      };
      native.conversations.syncAll = async () => {
        calls.push("syncAll");
        return { numConversations: 0 };
      };
      const client = createSdkClient({ client: native, syncTimeoutMs: 5000 });

      const result = await client.syncAll();
      expect(result.isOk()).toBe(true);
      expect(calls).toEqual(["sync", "syncAll"]);
    });

    test("returns error when sync throws", async () => {
      const native = createMockSdkNativeClient();
      native.conversations.sync = async () => {
        throw new Error("network down");
      };
      const client = createSdkClient({ client: native, syncTimeoutMs: 5000 });

      const result = await client.syncAll();
      expect(result.isErr()).toBe(true);
    });
  });

  describe("syncGroup", () => {
    test("syncs a specific group", async () => {
      let synced = false;
      const group = createMockGroup({ id: "g1" });
      group.sync = async () => {
        synced = true;
      };
      const native = createMockSdkNativeClient({ groups: [group] });
      const client = createSdkClient({ client: native, syncTimeoutMs: 5000 });

      const result = await client.syncGroup("g1");
      expect(result.isOk()).toBe(true);
      expect(synced).toBe(true);
    });

    test("returns NotFoundError for unknown group", async () => {
      const native = createMockSdkNativeClient({ groups: [] });
      const client = createSdkClient({ client: native, syncTimeoutMs: 5000 });

      const result = await client.syncGroup("nonexistent");
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error._tag).toBe("NotFoundError");
      }
    });
  });

  describe("getGroupInfo", () => {
    test("returns mapped group info with members", async () => {
      const group = createMockGroup({
        id: "g1",
        name: "Test",
        description: "Desc",
        members: [
          {
            inboxId: "m1",
            accountIdentifiers: [],
            installationIds: [],
            permissionLevel: "member",
          },
        ],
      });
      const native = createMockSdkNativeClient({ groups: [group] });
      const client = createSdkClient({ client: native, syncTimeoutMs: 5000 });

      const result = await client.getGroupInfo("g1");
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.groupId).toBe("g1");
        expect(result.value.name).toBe("Test");
        expect(result.value.memberInboxIds).toEqual(["m1"]);
      }
    });

    test("returns NotFoundError for unknown group", async () => {
      const native = createMockSdkNativeClient({ groups: [] });
      const client = createSdkClient({ client: native, syncTimeoutMs: 5000 });

      const result = await client.getGroupInfo("nonexistent");
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error._tag).toBe("NotFoundError");
      }
    });
  });

  describe("listGroups", () => {
    test("returns all groups", async () => {
      const groups = [
        createMockGroup({ id: "g1", name: "One" }),
        createMockGroup({ id: "g2", name: "Two" }),
      ];
      const native = createMockSdkNativeClient({ groups });
      const client = createSdkClient({ client: native, syncTimeoutMs: 5000 });

      const result = await client.listGroups();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
      }
    });
  });

  describe("addMembers", () => {
    test("delegates to group.addMembers", async () => {
      let addedIds: string[] = [];
      const group = createMockGroup({ id: "g1" });
      group.addMembers = async (ids: string[]) => {
        addedIds = ids;
      };
      const native = createMockSdkNativeClient({ groups: [group] });
      const client = createSdkClient({ client: native, syncTimeoutMs: 5000 });

      const result = await client.addMembers("g1", ["inbox-a", "inbox-b"]);
      expect(result.isOk()).toBe(true);
      expect(addedIds).toEqual(["inbox-a", "inbox-b"]);
    });
  });

  describe("removeMembers", () => {
    test("delegates to group.removeMembers", async () => {
      let removedIds: string[] = [];
      const group = createMockGroup({ id: "g1" });
      group.removeMembers = async (ids: string[]) => {
        removedIds = ids;
      };
      const native = createMockSdkNativeClient({ groups: [group] });
      const client = createSdkClient({ client: native, syncTimeoutMs: 5000 });

      const result = await client.removeMembers("g1", ["inbox-a"]);
      expect(result.isOk()).toBe(true);
      expect(removedIds).toEqual(["inbox-a"]);
    });
  });

  describe("streamAllMessages", () => {
    test("returns a message stream", async () => {
      const msgs = [
        createMockDecodedMessage({ id: "m1" }),
        createMockDecodedMessage({ id: "m2" }),
      ];
      const native = createMockSdkNativeClient();
      native.conversations.streamAllGroupMessages = async () =>
        createMockAsyncStreamProxy(msgs);
      const client = createSdkClient({ client: native, syncTimeoutMs: 5000 });

      const result = await client.streamAllMessages();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const collected = [];
        for await (const msg of result.value.messages) {
          collected.push(msg);
        }
        expect(collected).toHaveLength(2);
      }
    });
  });

  describe("streamGroups", () => {
    test("returns a group stream", async () => {
      const groups = [createMockGroup({ id: "g1", name: "New Group" })];
      const native = createMockSdkNativeClient();
      native.conversations.streamGroups = async () =>
        createMockAsyncStreamProxy(groups);
      const client = createSdkClient({ client: native, syncTimeoutMs: 5000 });

      const result = await client.streamGroups();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const collected = [];
        for await (const event of result.value.groups) {
          collected.push(event);
        }
        expect(collected).toHaveLength(1);
        expect(collected[0]!.groupId).toBe("g1");
      }
    });
  });
});
