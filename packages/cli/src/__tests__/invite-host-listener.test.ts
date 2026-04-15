import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { generateConvosInviteSlug, type CoreRawEvent } from "@xmtp/signet-core";
import {
  InternalError,
  NotFoundError,
  type SignetError,
} from "@xmtp/signet-schemas";
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

function makeRawDmJoinedEvent(dmId: string): CoreRawEvent {
  return {
    type: "raw.dm.joined",
    dmId,
    peerInboxId: RIGHT_CREATOR_INBOX_ID,
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

    capturedHandler?.(makeRawDmJoinedEvent("dm-join-1"));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(addedByIdentity).toEqual([
      `right:${TEST_CONVERSATION_ID}:${TEST_REQUESTER_INBOX_ID}`,
    ]);
  });

  test("deduplicates structured join requests and plain slug fallback", async () => {
    const slug = await buildValidSlug();

    const addedByIdentity: string[] = [];
    let capturedHandler: ((event: CoreRawEvent) => void) | null = null;

    startManagedInviteHostListener({
      subscribe(handler) {
        capturedHandler = handler;
        return () => {};
      },
      async listIdentities() {
        return [{ id: "right", inboxId: RIGHT_CREATOR_INBOX_ID }];
      },
      async getWalletPrivateKeyHex() {
        return Result.ok(RIGHT_PRIVATE_KEY_HEX);
      },
      getManagedClient() {
        return {
          addMembers: async (groupId, inboxIds) => {
            addedByIdentity.push(`${groupId}:${inboxIds.join(",")}`);
            return Result.ok(undefined);
          },
          listMessages: async () => Result.ok([]),
        };
      },
      async getGroupInviteTag() {
        return Result.ok("host-test-tag");
      },
    });

    capturedHandler?.({
      ...makeRawMessageEvent({
        inviteSlug: slug,
        profile: { name: "Codex", memberKind: "agent" },
      }),
      messageId: "structured-join-request-1",
      contentType: "join_request",
    });
    capturedHandler?.({
      ...makeRawMessageEvent(slug),
      messageId: "fallback-join-request-1",
      contentType: "text",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(addedByIdentity).toEqual([
      `${TEST_CONVERSATION_ID}:${TEST_REQUESTER_INBOX_ID}`,
    ]);
  });

  test("notifies acceptance callbacks with host identity context", async () => {
    const slug = await buildValidSlug();

    const accepted: Array<{
      hostIdentityId: string;
      hostInboxId: string;
      requesterInboxId: string;
      groupId: string;
      messageId: string;
    }> = [];
    let capturedHandler: ((event: CoreRawEvent) => void) | null = null;

    startManagedInviteHostListener({
      subscribe(handler) {
        capturedHandler = handler;
        return () => {};
      },
      async listIdentities() {
        return [{ id: "right", inboxId: RIGHT_CREATOR_INBOX_ID }];
      },
      async getWalletPrivateKeyHex() {
        return Result.ok(RIGHT_PRIVATE_KEY_HEX);
      },
      getManagedClient() {
        return {
          addMembers: async () => Result.ok(undefined),
          listMessages: async () => Result.ok([]),
        };
      },
      async getGroupInviteTag() {
        return Result.ok("host-test-tag");
      },
      async onJoinAccepted(acceptance) {
        accepted.push({
          hostIdentityId: acceptance.hostIdentityId,
          hostInboxId: acceptance.hostInboxId,
          requesterInboxId: acceptance.join.requesterInboxId,
          groupId: acceptance.join.groupId,
          messageId: acceptance.requestMessage.messageId,
        });
      },
    });

    capturedHandler?.({
      ...makeRawMessageEvent(slug),
      messageId: "accepted-join-msg-1",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(accepted).toEqual([
      {
        hostIdentityId: "right",
        hostInboxId: RIGHT_CREATOR_INBOX_ID,
        requesterInboxId: TEST_REQUESTER_INBOX_ID,
        groupId: TEST_CONVERSATION_ID,
        messageId: "accepted-join-msg-1",
      },
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

    capturedHandler?.(makeRawDmJoinedEvent("dm-join-2"));
    capturedHandler?.({
      ...makeRawMessageEvent(slug),
      messageId: "dm-msg-2",
      groupId: "dm-join-2",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(addMemberCalls).toBe(1);
  });

  test("paginates through DM history so older invite slugs are still discovered", async () => {
    const slug = await buildValidSlug();

    let addMemberCalls = 0;
    let capturedHandler: ((event: CoreRawEvent) => void) | null = null;

    const messages = Array.from({ length: 12 }, (_, index) => {
      const sequence = 12 - index;
      return {
        messageId: `dm-page-${sequence}`,
        groupId: "dm-join-3",
        senderInboxId: TEST_REQUESTER_INBOX_ID,
        contentType: "text",
        content:
          sequence === 1
            ? slug
            : `not-an-invite-${sequence.toString().padStart(2, "0")}`,
        sentAt: new Date(Date.UTC(2026, 3, 13, 12, sequence, 0)).toISOString(),
        threadId: null,
      };
    });

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
          listMessages: async (_groupId, options) => {
            const filtered = messages.filter((message) => {
              if (!options?.before) return true;
              return message.sentAt < options.before;
            });

            const sorted = [...filtered].sort((left, right) =>
              right.sentAt.localeCompare(left.sentAt),
            );

            return Result.ok(sorted.slice(0, options?.limit ?? sorted.length));
          },
        };
      },
      async getGroupInviteTag() {
        return Result.ok("host-test-tag");
      },
    });

    capturedHandler?.(makeRawDmJoinedEvent("dm-join-3"));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(addMemberCalls).toBe(1);
  });

  test("retries an invite after a transient join-processing failure", async () => {
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
            if (addMemberCalls === 1) {
              return Result.err(
                InternalError.create("temporary addMembers failure"),
              );
            }
            return Result.ok(undefined);
          },
        };
      },
      async getGroupInviteTag() {
        return Result.ok("host-test-tag");
      },
    });

    const retryEvent = {
      ...makeRawMessageEvent(slug),
      messageId: "retry-msg-1",
    };

    capturedHandler?.(retryEvent);
    await new Promise((resolve) => setTimeout(resolve, 100));
    capturedHandler?.(retryEvent);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(addMemberCalls).toBe(2);
  });

  test("allows a same-inbox rejoin after the logical dedupe window expires", async () => {
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
        };
      },
      async getGroupInviteTag() {
        return Result.ok("host-test-tag");
      },
      processedInviteKeyTtlMs: 20,
    });

    capturedHandler?.({
      ...makeRawMessageEvent(slug),
      messageId: "rejoin-msg-1",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    capturedHandler?.({
      ...makeRawMessageEvent(slug),
      messageId: "rejoin-msg-2",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(addMemberCalls).toBe(2);
  });

  test("retries DM recovery after a transient history lookup failure", async () => {
    const slug = await buildValidSlug();

    let addMemberCalls = 0;
    let listMessageCalls = 0;
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
          listMessages: async (groupId) => {
            listMessageCalls += 1;
            if (listMessageCalls === 1) {
              return Result.err(
                InternalError.create("temporary history lookup failure"),
              );
            }

            return Result.ok([
              {
                messageId: "dm-retry-msg-1",
                groupId,
                senderInboxId: TEST_REQUESTER_INBOX_ID,
                contentType: "text",
                content: slug,
                sentAt: new Date().toISOString(),
                threadId: null,
              },
            ]);
          },
        };
      },
      async getGroupInviteTag() {
        return Result.ok("host-test-tag");
      },
    });

    capturedHandler?.(makeRawDmJoinedEvent("dm-join-retry"));
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(listMessageCalls).toBeGreaterThanOrEqual(2);
    expect(addMemberCalls).toBe(1);
  });

  test("retries recovered invites after a transient join-processing failure", async () => {
    const slug = await buildValidSlug();

    let addMemberCalls = 0;
    let listMessageCalls = 0;
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
            if (addMemberCalls === 1) {
              return Result.err(
                InternalError.create("temporary addMembers failure"),
              );
            }
            return Result.ok(undefined);
          },
          listMessages: async (groupId) => {
            listMessageCalls += 1;
            return Result.ok([
              {
                messageId: "dm-recovered-retry-msg-1",
                groupId,
                senderInboxId: TEST_REQUESTER_INBOX_ID,
                contentType: "text",
                content: slug,
                sentAt: new Date().toISOString(),
                threadId: null,
              },
            ]);
          },
        };
      },
      async getGroupInviteTag() {
        return Result.ok("host-test-tag");
      },
    });

    capturedHandler?.(makeRawDmJoinedEvent("dm-join-recovered-retry"));
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(listMessageCalls).toBeGreaterThanOrEqual(2);
    expect(addMemberCalls).toBe(2);
  });

  test("retries DM recovery when host key lookup is not ready yet", async () => {
    const slug = await buildValidSlug();

    let addMemberCalls = 0;
    let keyLookupCalls = 0;
    let listMessageCalls = 0;
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
        keyLookupCalls += 1;
        if (keyLookupCalls === 1) {
          return Result.err(
            InternalError.create("identity key not loaded yet"),
          );
        }
        return Result.ok(RIGHT_PRIVATE_KEY_HEX);
      },
      getManagedClient() {
        return {
          addMembers: async () => {
            addMemberCalls += 1;
            return Result.ok(undefined);
          },
          listMessages: async (groupId) => {
            listMessageCalls += 1;
            return Result.ok([
              {
                messageId: "dm-key-retry-msg-1",
                groupId,
                senderInboxId: TEST_REQUESTER_INBOX_ID,
                contentType: "text",
                content: slug,
                sentAt: new Date().toISOString(),
                threadId: null,
              },
            ]);
          },
        };
      },
      async getGroupInviteTag() {
        return Result.ok("host-test-tag");
      },
    });

    capturedHandler?.(makeRawDmJoinedEvent("dm-join-key-retry"));
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(keyLookupCalls).toBeGreaterThanOrEqual(2);
    expect(listMessageCalls).toBeGreaterThanOrEqual(2);
    expect(addMemberCalls).toBe(1);
  });

  test("retries DM recovery when transient identity setup is mixed with validation misses", async () => {
    const slug = await buildValidSlug();

    let addMemberCalls = 0;
    let rightKeyLookupCalls = 0;
    const failures: string[] = [];
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
        if (identityId === "wrong") {
          return Result.ok(WRONG_PRIVATE_KEY_HEX);
        }

        rightKeyLookupCalls += 1;
        if (rightKeyLookupCalls === 1) {
          return Result.err(
            InternalError.create("managed identity still attaching"),
          );
        }
        return Result.ok(RIGHT_PRIVATE_KEY_HEX);
      },
      getManagedClient(identityId) {
        return {
          addMembers: async () => {
            if (identityId === "right") {
              addMemberCalls += 1;
            }
            return Result.ok(undefined);
          },
          listMessages: async (groupId) =>
            Result.ok([
              {
                messageId: "dm-mixed-retry-msg-1",
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
      async onJoinRejected(failure) {
        failures.push(failure.error.category);
      },
    });

    capturedHandler?.(makeRawDmJoinedEvent("dm-join-mixed-retry"));
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(rightKeyLookupCalls).toBeGreaterThanOrEqual(2);
    expect(addMemberCalls).toBe(1);
    expect(failures).toEqual([]);
  });

  test("does not retry recovered invites after a validation failure", async () => {
    const slug = await buildValidSlug();

    let listMessageCalls = 0;
    const failures: string[] = [];
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
          addMembers: async () => Result.ok(undefined),
          listMessages: async (groupId) => {
            listMessageCalls += 1;
            return Result.ok([
              {
                messageId: "dm-validation-failure-msg-1",
                groupId,
                senderInboxId: TEST_REQUESTER_INBOX_ID,
                contentType: "text",
                content: slug,
                sentAt: new Date().toISOString(),
                threadId: null,
              },
            ]);
          },
        };
      },
      async getGroupInviteTag() {
        return Result.ok("wrong-host-tag");
      },
      async onJoinRejected(failure) {
        failures.push(failure.error.category);
      },
    });

    capturedHandler?.(makeRawDmJoinedEvent("dm-validation-failure"));
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(listMessageCalls).toBe(1);
    expect(failures).toEqual(["validation"]);
  });

  test("does not retry DM recovery for identities that do not own the DM", async () => {
    const slug = await buildValidSlug();

    let wrongIdentityListCalls = 0;
    let rightIdentityListCalls = 0;
    let addMemberCalls = 0;
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
        if (identityId === "wrong") {
          return {
            addMembers: async () => Result.ok(undefined),
            listMessages: async () => {
              wrongIdentityListCalls += 1;
              return Result.err(
                NotFoundError.create("Conversation", "dm-owned-by-right"),
              );
            },
          };
        }

        return {
          addMembers: async () => {
            addMemberCalls += 1;
            return Result.ok(undefined);
          },
          listMessages: async (groupId) => {
            rightIdentityListCalls += 1;
            return Result.ok([
              {
                messageId: "dm-owned-by-right-msg-1",
                groupId,
                senderInboxId: TEST_REQUESTER_INBOX_ID,
                contentType: "text",
                content: slug,
                sentAt: new Date().toISOString(),
                threadId: null,
              },
            ]);
          },
        };
      },
      async getGroupInviteTag() {
        return Result.ok("host-test-tag");
      },
    });

    capturedHandler?.(makeRawDmJoinedEvent("dm-owned-by-right"));
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(addMemberCalls).toBe(1);
    expect(rightIdentityListCalls).toBe(1);
    expect(wrongIdentityListCalls).toBe(1);
  });
});
