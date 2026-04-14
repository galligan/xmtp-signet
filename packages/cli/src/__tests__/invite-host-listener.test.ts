import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { generateConvosInviteSlug, type CoreRawEvent } from "@xmtp/signet-core";
import type { SignetError } from "@xmtp/signet-schemas";
import { startManagedInviteHostListener } from "../invite-host-listener.js";

const WRONG_PRIVATE_KEY_HEX =
  "0000000000000000000000000000000000000000000000000000000000000002";
const RIGHT_PRIVATE_KEY_HEX =
  "0000000000000000000000000000000000000000000000000000000000000001";

const WRONG_CREATOR_INBOX_ID =
  "bbbbccddee1122334455667788990011aabbccddee1122334455667788990011";
const RIGHT_CREATOR_INBOX_ID =
  "aabbccddee1122334455667788990011aabbccddee1122334455667788990011";

const TEST_CONVERSATION_ID = "550e8400-e29b-41d4-a716-446655440000";
const TEST_REQUESTER_INBOX_ID = "requester-inbox-id-abc123";

function makeRawMessageEvent(content: unknown): CoreRawEvent {
  return {
    type: "raw.message",
    messageId: "msg-1",
    groupId: "group-1",
    senderInboxId: TEST_REQUESTER_INBOX_ID,
    contentType: "text",
    content,
    sentAt: new Date().toISOString(),
    threadId: null,
    isHistorical: false,
  };
}

function makeRawGroupJoinedEvent(groupId: string): CoreRawEvent {
  return {
    type: "raw.group.joined",
    groupId,
    groupName: "",
  };
}

async function buildValidSlug(): Promise<string> {
  const result = await generateConvosInviteSlug({
    conversationId: TEST_CONVERSATION_ID,
    creatorInboxId: RIGHT_CREATOR_INBOX_ID,
    walletPrivateKeyHex: RIGHT_PRIVATE_KEY_HEX,
    inviteTag: "host-test-tag",
  });
  if (!result.isOk()) {
    throw new Error("Failed to generate test invite slug");
  }
  return result.value;
}

describe("startManagedInviteHostListener", () => {
  test("routes a join request through the identity that matches the invite creator", async () => {
    const slug = await buildValidSlug();

    const addedByIdentity: string[] = [];
    const identities = [
      { id: "wrong", inboxId: WRONG_CREATOR_INBOX_ID },
      { id: "right", inboxId: RIGHT_CREATOR_INBOX_ID },
    ];

    const managedClients = new Map<
      string,
      {
        addMembers: (
          groupId: string,
          inboxIds: readonly string[],
        ) => Promise<Result<void, SignetError>>;
      }
    >([
      [
        "wrong",
        {
          addMembers: async () => {
            addedByIdentity.push("wrong");
            return Result.ok(undefined);
          },
        },
      ],
      [
        "right",
        {
          addMembers: async (groupId, inboxIds) => {
            addedByIdentity.push(`right:${groupId}:${inboxIds.join(",")}`);
            return Result.ok(undefined);
          },
        },
      ],
    ]);

    let capturedHandler: ((event: CoreRawEvent) => void) | null = null;
    startManagedInviteHostListener({
      subscribe(handler) {
        capturedHandler = handler;
        return () => {};
      },
      async listIdentities() {
        return identities;
      },
      async getWalletPrivateKeyHex(identityId) {
        return Result.ok(
          identityId === "right"
            ? RIGHT_PRIVATE_KEY_HEX
            : WRONG_PRIVATE_KEY_HEX,
        );
      },
      getManagedClient(identityId) {
        return managedClients.get(identityId);
      },
      async getGroupInviteTag() {
        return Result.ok("host-test-tag");
      },
    });

    capturedHandler?.(makeRawMessageEvent(slug));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(addedByIdentity).toEqual([
      `right:${TEST_CONVERSATION_ID}:${TEST_REQUESTER_INBOX_ID}`,
    ]);
  });

  test("keeps processing join requests after an inbox ID appears later", async () => {
    const slug = await buildValidSlug();

    let addedGroupId = "";
    let addedInboxIds: readonly string[] = [];
    let identities: Array<{ id: string; inboxId: string | null }> = [
      { id: "creator", inboxId: null },
    ];

    let capturedHandler: ((event: CoreRawEvent) => void) | null = null;
    startManagedInviteHostListener({
      subscribe(handler) {
        capturedHandler = handler;
        return () => {};
      },
      async listIdentities() {
        return identities;
      },
      async getWalletPrivateKeyHex() {
        return Result.ok(RIGHT_PRIVATE_KEY_HEX);
      },
      getManagedClient(identityId) {
        if (identityId !== "creator") return undefined;
        return {
          addMembers: async (groupId, inboxIds) => {
            addedGroupId = groupId;
            addedInboxIds = inboxIds;
            return Result.ok(undefined);
          },
        };
      },
      async getGroupInviteTag() {
        return Result.ok("host-test-tag");
      },
    });

    identities = [{ id: "creator", inboxId: RIGHT_CREATOR_INBOX_ID }];

    capturedHandler?.(makeRawMessageEvent(slug));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(addedGroupId).toBe(TEST_CONVERSATION_ID);
    expect(addedInboxIds).toEqual([TEST_REQUESTER_INBOX_ID]);
  });

  test("scans a newly discovered conversation for invite requests", async () => {
    const slug = await buildValidSlug();

    const addedByIdentity: string[] = [];
    let capturedHandler: ((event: CoreRawEvent) => void) | null = null;

    startManagedInviteHostListener({
      subscribe(handler) {
        capturedHandler = handler;
        return () => {};
      },
      async listIdentities() {
        return [
          { id: "wrong", inboxId: WRONG_CREATOR_INBOX_ID },
          { id: "right", inboxId: RIGHT_CREATOR_INBOX_ID },
        ];
      },
      async getWalletPrivateKeyHex(identityId) {
        return Result.ok(
          identityId === "right"
            ? RIGHT_PRIVATE_KEY_HEX
            : WRONG_PRIVATE_KEY_HEX,
        );
      },
      getManagedClient(identityId) {
        return {
          addMembers: async (groupId, inboxIds) => {
            addedByIdentity.push(
              `${identityId}:${groupId}:${inboxIds.join(",")}`,
            );
            return Result.ok(undefined);
          },
          listMessages: async (groupId) =>
            Result.ok([
              {
                messageId: "dm-msg-1",
                groupId,
                senderInboxId: TEST_REQUESTER_INBOX_ID,
                contentType: "text",
                content: slug,
                sentAt: new Date().toISOString(),
                threadId: null,
              },
            ]),
        };
      },
      async getGroupInviteTag() {
        return Result.ok("host-test-tag");
      },
    });

    capturedHandler?.(makeRawGroupJoinedEvent("dm-join-1"));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(addedByIdentity).toEqual([
      `right:${TEST_CONVERSATION_ID}:${TEST_REQUESTER_INBOX_ID}`,
    ]);
  });

  test("does not process the same invite twice when the message stream catches up", async () => {
    const slug = await buildValidSlug();

    let addMemberCalls = 0;
    let capturedHandler: ((event: CoreRawEvent) => void) | null = null;

    startManagedInviteHostListener({
      subscribe(handler) {
        capturedHandler = handler;
        return () => {};
      },
      async listIdentities() {
        return [{ id: "creator", inboxId: RIGHT_CREATOR_INBOX_ID }];
      },
      async getWalletPrivateKeyHex() {
        return Result.ok(RIGHT_PRIVATE_KEY_HEX);
      },
      getManagedClient() {
        return {
          addMembers: async () => {
            addMemberCalls += 1;
            return Result.ok(undefined);
          },
          listMessages: async (groupId) =>
            Result.ok([
              {
                messageId: "dm-msg-2",
                groupId,
                senderInboxId: TEST_REQUESTER_INBOX_ID,
                contentType: "text",
                content: slug,
                sentAt: new Date().toISOString(),
                threadId: null,
              },
            ]),
        };
      },
      async getGroupInviteTag() {
        return Result.ok("host-test-tag");
      },
    });

    capturedHandler?.(makeRawGroupJoinedEvent("dm-join-2"));
    capturedHandler?.({
      ...makeRawMessageEvent(slug),
      messageId: "dm-msg-2",
      groupId: "dm-join-2",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(addMemberCalls).toBe(1);
  });
});
