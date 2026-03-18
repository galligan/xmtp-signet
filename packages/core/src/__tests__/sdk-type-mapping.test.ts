import { describe, expect, test } from "bun:test";
import { toGroupInfo, toDecodedMessage } from "../sdk/type-mapping.js";
import { createMockGroup, createMockDecodedMessage } from "./sdk-fixtures.js";

describe("toGroupInfo", () => {
  test("maps group fields to XmtpGroupInfo", async () => {
    const group = createMockGroup({
      id: "group-abc",
      name: "My Group",
      description: "A fine group",
      members: [
        {
          inboxId: "inbox-1",
          accountIdentifiers: [],
          installationIds: [],
          permissionLevel: "member",
        },
        {
          inboxId: "inbox-2",
          accountIdentifiers: [],
          installationIds: [],
          permissionLevel: "admin",
        },
      ],
    });

    const members = await group.members();
    const info = toGroupInfo(group, members);

    expect(info.groupId).toBe("group-abc");
    expect(info.name).toBe("My Group");
    expect(info.description).toBe("A fine group");
    expect(info.memberInboxIds).toEqual(["inbox-1", "inbox-2"]);
    expect(typeof info.createdAt).toBe("string");
  });

  test("handles empty name and description", async () => {
    const group = createMockGroup({
      name: "",
      description: "",
    });
    const members = await group.members();
    const info = toGroupInfo(group, members);

    expect(info.name).toBe("");
    expect(info.description).toBe("");
  });

  test("converts createdAtNs to ISO string", async () => {
    const knownTime = 1700000000000n * 1_000_000n; // nanoseconds
    const group = createMockGroup({ createdAtNs: knownTime });
    const members = await group.members();
    const info = toGroupInfo(group, members);

    const parsed = new Date(info.createdAt);
    expect(parsed.getTime()).toBe(1700000000000);
  });
});

describe("toDecodedMessage", () => {
  test("maps decoded message fields to XmtpDecodedMessage", () => {
    const sentAt = new Date("2024-01-15T12:00:00Z");
    const msg = createMockDecodedMessage({
      id: "msg-123",
      conversationId: "group-abc",
      senderInboxId: "sender-1",
      content: { text: "hello" },
      sentAt,
      sentAtNs: BigInt(sentAt.getTime()) * 1_000_000n,
    });

    const mapped = toDecodedMessage(msg);

    expect(mapped.messageId).toBe("msg-123");
    expect(mapped.groupId).toBe("group-abc");
    expect(mapped.senderInboxId).toBe("sender-1");
    expect(mapped.content).toEqual({ text: "hello" });
    expect(mapped.contentType).toBe("text");
    expect(typeof mapped.sentAt).toBe("string");
  });

  test("uses 'unknown' for missing content type", () => {
    const msg = {
      ...createMockDecodedMessage(),
      contentType: undefined,
    };

    const mapped = toDecodedMessage(msg);
    expect(mapped.contentType).toBe("unknown");
  });

  test("preserves null content", () => {
    const msg = {
      ...createMockDecodedMessage(),
      content: null,
    };
    const mapped = toDecodedMessage(msg);
    expect(mapped.content).toBeNull();
  });

  test("extracts threadId from Reply content with reference", () => {
    const msg = createMockDecodedMessage({
      content: { reference: "root-msg-42", content: "reply text" },
    });
    const mapped = toDecodedMessage(msg);
    expect(mapped.threadId).toBe("root-msg-42");
  });

  test("threadId is null for non-reply content", () => {
    const msg = createMockDecodedMessage({
      content: { text: "hello" },
    });
    const mapped = toDecodedMessage(msg);
    expect(mapped.threadId).toBeNull();
  });

  test("threadId is null for null content", () => {
    const msg = { ...createMockDecodedMessage(), content: null };
    const mapped = toDecodedMessage(msg);
    expect(mapped.threadId).toBeNull();
  });

  test("threadId is null for string content", () => {
    const msg = createMockDecodedMessage({ content: "plain text" });
    const mapped = toDecodedMessage(msg);
    expect(mapped.threadId).toBeNull();
  });
});
