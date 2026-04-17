import { describe, expect, test } from "bun:test";
import { encodeProfileSnapshot } from "../convos/profile-messages.js";
import { createConvosOnboardingScheme } from "../convos/onboarding-scheme.js";
import type { EncodedOnboardingContent } from "../schemes/onboarding-scheme.js";
import { createSdkClient } from "../sdk/sdk-client.js";
import {
  createMockSdkNativeClient,
  createMockDm,
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

    test("sends encoded convos payloads without JSON re-encoding", async () => {
      let capturedPayload: unknown = null;
      const group = createMockGroup({ id: "g1" });
      group.send = async (encoded: unknown) => {
        capturedPayload = encoded;
        return "msg-id-encoded";
      };
      const native = createMockSdkNativeClient({ groups: [group] });
      const client = createSdkClient({ client: native, syncTimeoutMs: 5000 });
      const snapshot = encodeProfileSnapshot({
        profiles: [{ inboxId: "abcd", name: "Codex" }],
      });

      const result = await client.sendMessage(
        "g1",
        snapshot,
        "convos.org/profile_snapshot:1.0",
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe("msg-id-encoded");
      }
      expect(capturedPayload).toEqual(snapshot);
    });

    test("uses scheme-owned encoded content detection for custom onboarding types", async () => {
      const baseScheme = createConvosOnboardingScheme();
      const customType = "example.org/profile_snapshot:9.9";
      const customEncoded = { custom: true };

      let capturedPayload: unknown = null;
      const group = createMockGroup({ id: "g1" });
      group.send = async (encoded: unknown) => {
        capturedPayload = encoded;
        return "msg-id-custom";
      };

      const native = createMockSdkNativeClient({ groups: [group] });
      const client = createSdkClient({
        client: native,
        syncTimeoutMs: 5000,
        onboardingScheme: {
          ...baseScheme,
          isEncodedContent(value): value is EncodedOnboardingContent {
            return value === customEncoded;
          },
          profileSnapshotContentType() {
            return customType;
          },
        },
      });

      const result = await client.sendMessage("g1", customEncoded, customType);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe("msg-id-custom");
      }
      expect(capturedPayload).toBe(customEncoded);
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

  describe("updateGroupMetadata", () => {
    test("delegates provided metadata fields to the group", async () => {
      const calls: string[] = [];
      const group = createMockGroup({ id: "g1" });
      group.updateName = async (name: string) => {
        calls.push(`name:${name}`);
        group.name = name;
      };
      group.updateDescription = async (description: string) => {
        calls.push(`description:${description}`);
        group.description = description;
      };
      group.updateImageUrl = async (imageUrl: string) => {
        calls.push(`image:${imageUrl}`);
        group.imageUrl = imageUrl;
      };
      const native = createMockSdkNativeClient({ groups: [group] });
      const client = createSdkClient({ client: native, syncTimeoutMs: 5000 });

      const result = await client.updateGroupMetadata("g1", {
        name: "Renamed",
        description: "Updated description",
        imageUrl: "https://example.com/new.png",
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.name).toBe("Renamed");
        expect(result.value.description).toBe("Updated description");
        expect(result.value.imageUrl).toBe("https://example.com/new.png");
      }
      expect(calls).toEqual([
        "name:Renamed",
        "description:Updated description",
        "image:https://example.com/new.png",
      ]);
    });
  });

  describe("leaveGroup", () => {
    test("delegates to group.leaveGroup for a regular member", async () => {
      let left = false;
      const native = createMockSdkNativeClient({ inboxId: "self-inbox" });
      const group = createMockGroup({
        id: "g1",
        members: [
          {
            inboxId: "self-inbox",
            accountIdentifiers: [],
            installationIds: [],
            permissionLevel: "member",
          },
        ],
      });
      group.leaveGroup = async () => {
        left = true;
      };
      native.conversations.getConversationById = async () => group;
      const client = createSdkClient({ client: native, syncTimeoutMs: 5000 });

      const result = await client.leaveGroup("g1");

      expect(result.isOk()).toBe(true);
      expect(left).toBe(true);
    });

    test("returns a permission error when the caller is super admin", async () => {
      let left = false;
      const native = createMockSdkNativeClient({ inboxId: "self-inbox" });
      const group = createMockGroup({
        id: "g1",
        members: [
          {
            inboxId: "self-inbox",
            accountIdentifiers: [],
            installationIds: [],
            permissionLevel: "super_admin",
          },
        ],
      });
      group.leaveGroup = async () => {
        left = true;
      };
      native.conversations.getConversationById = async () => group;
      const client = createSdkClient({ client: native, syncTimeoutMs: 5000 });

      const result = await client.leaveGroup("g1");

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error._tag).toBe("PermissionError");
      }
      expect(left).toBe(false);
    });
  });

  describe("group role management", () => {
    test("delegates addAdmin and removeAdmin", async () => {
      const calls: string[] = [];
      const group = createMockGroup({ id: "g1" });
      group.addAdmin = async (inboxId: string) => {
        calls.push(`add-admin:${inboxId}`);
      };
      group.removeAdmin = async (inboxId: string) => {
        calls.push(`remove-admin:${inboxId}`);
      };
      const native = createMockSdkNativeClient({ groups: [group] });
      const client = createSdkClient({ client: native, syncTimeoutMs: 5000 });

      const promote = await client.addAdmin("g1", "inbox-a");
      const demote = await client.removeAdmin("g1", "inbox-a");

      expect(promote.isOk()).toBe(true);
      expect(demote.isOk()).toBe(true);
      expect(calls).toEqual(["add-admin:inbox-a", "remove-admin:inbox-a"]);
    });

    test("delegates addSuperAdmin and removeSuperAdmin", async () => {
      const calls: string[] = [];
      const group = createMockGroup({ id: "g1" });
      group.addSuperAdmin = async (inboxId: string) => {
        calls.push(`add-super-admin:${inboxId}`);
      };
      group.removeSuperAdmin = async (inboxId: string) => {
        calls.push(`remove-super-admin:${inboxId}`);
      };
      const native = createMockSdkNativeClient({ groups: [group] });
      const client = createSdkClient({ client: native, syncTimeoutMs: 5000 });

      const promote = await client.addSuperAdmin("g1", "inbox-a");
      const demote = await client.removeSuperAdmin("g1", "inbox-a");

      expect(promote.isOk()).toBe(true);
      expect(demote.isOk()).toBe(true);
      expect(calls).toEqual([
        "add-super-admin:inbox-a",
        "remove-super-admin:inbox-a",
      ]);
    });
  });

  describe("streamAllMessages", () => {
    test("returns a message stream from the all-messages XMTP stream", async () => {
      const msgs = [
        createMockDecodedMessage({ id: "m1" }),
        createMockDecodedMessage({ id: "m2" }),
      ];
      const native = createMockSdkNativeClient();
      native.conversations.streamAllMessages = async () =>
        createMockAsyncStreamProxy(msgs);
      native.conversations.streamAllGroupMessages = async () => {
        throw new Error("streamAllGroupMessages should not be used here");
      };
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
    test("returns a group stream from the group XMTP stream", async () => {
      const groups = [createMockGroup({ id: "g1", name: "New Group" })];
      const native = createMockSdkNativeClient();
      native.conversations.streamGroups = async () =>
        createMockAsyncStreamProxy(groups);
      native.conversations.stream = async () => {
        throw new Error("generic stream should not be used here");
      };
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

  describe("streamDms", () => {
    test("returns a DM stream from the DM XMTP stream", async () => {
      const dms = [createMockDm({ id: "dm-1", peerInboxId: "peer-1" })];
      const native = createMockSdkNativeClient();
      native.conversations.streamDms = async () =>
        createMockAsyncStreamProxy(dms);
      native.conversations.stream = async () => {
        throw new Error("generic stream should not be used here");
      };
      const client = createSdkClient({ client: native, syncTimeoutMs: 5000 });

      const result = await client.streamDms();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const collected = [];
        for await (const event of result.value.dms) {
          collected.push(event);
        }
        expect(collected).toEqual([{ dmId: "dm-1", peerInboxId: "peer-1" }]);
      }
    });
  });
});
