import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import type { RawMessageEvent, CoreRawEvent } from "../../../raw-events.js";
import { generateConvosInviteSlug } from "../invite-generator.js";
import {
  tryProcessJoinRequest,
  startInviteHostListener,
  type InviteHostDeps,
} from "../invite-host.js";

// --- Test key material (same as process-join-requests tests) ---

const TEST_PRIVATE_KEY_HEX =
  "0000000000000000000000000000000000000000000000000000000000000001";

const TEST_CREATOR_INBOX_ID =
  "aabbccddee1122334455667788990011aabbccddee1122334455667788990011";

const TEST_CONVERSATION_ID = "550e8400-e29b-41d4-a716-446655440000";
const TEST_REQUESTER_INBOX_ID = "requester-inbox-id-abc123";

function makeRawMessageEvent(
  content: unknown,
  overrides?: Partial<RawMessageEvent>,
): RawMessageEvent {
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
    ...overrides,
  };
}

function createHostDeps(overrides?: {
  addMembersResult?: Result<void, SignetError>;
  storedTag?: string | undefined;
}): InviteHostDeps {
  return {
    walletPrivateKeyHex: TEST_PRIVATE_KEY_HEX,
    creatorInboxId: TEST_CREATOR_INBOX_ID,
    addMembersToGroup: async () =>
      overrides?.addMembersResult ?? Result.ok(undefined),
    getGroupInviteTag: async () =>
      Result.ok(overrides?.storedTag ?? "host-test-tag"),
  };
}

async function buildValidSlug(): Promise<string> {
  const result = await generateConvosInviteSlug({
    conversationId: TEST_CONVERSATION_ID,
    creatorInboxId: TEST_CREATOR_INBOX_ID,
    walletPrivateKeyHex: TEST_PRIVATE_KEY_HEX,
    inviteTag: "host-test-tag",
  });
  if (!result.isOk()) throw new Error("Failed to generate slug for test");
  return result.value;
}

describe("tryProcessJoinRequest", () => {
  test("returns null for non-string content", async () => {
    const deps = createHostDeps();
    const event = makeRawMessageEvent({ reaction: "thumbsup" });

    const result = await tryProcessJoinRequest(deps, event);
    expect(result).toBeNull();
  });

  test("returns null for non-URL text", async () => {
    const deps = createHostDeps();
    const event = makeRawMessageEvent("hello world");

    const result = await tryProcessJoinRequest(deps, event);
    expect(result).toBeNull();
  });

  test("returns null for short URL", async () => {
    const deps = createHostDeps();
    const event = makeRawMessageEvent("https://example.com");

    const result = await tryProcessJoinRequest(deps, event);
    expect(result).toBeNull();
  });

  test("returns null for multi-word text", async () => {
    const deps = createHostDeps();
    const event = makeRawMessageEvent(
      "hey check out https://example.com/some-long-path-that-is-over-fifty-chars",
    );

    const result = await tryProcessJoinRequest(deps, event);
    expect(result).toBeNull();
  });

  test("processes a valid invite URL", async () => {
    const slug = await buildValidSlug();
    const deps = createHostDeps();
    const event = makeRawMessageEvent(slug);

    const result = await tryProcessJoinRequest(deps, event);

    expect(result).not.toBeNull();
    expect(result!.isOk()).toBe(true);
    if (!result!.isOk()) return;

    expect(result!.value.groupId).toBe(TEST_CONVERSATION_ID);
    expect(result!.value.requesterInboxId).toBe(TEST_REQUESTER_INBOX_ID);
    expect(result!.value.inviteTag).toBe("host-test-tag");
  });
});

describe("startInviteHostListener", () => {
  test("subscribes to events and returns unsubscribe function", () => {
    let subscriberCount = 0;
    const mockSubscribe = (
      _handler: (event: CoreRawEvent) => void,
    ): (() => void) => {
      subscriberCount++;
      return () => {
        subscriberCount--;
      };
    };

    const deps = createHostDeps();
    const unsub = startInviteHostListener(mockSubscribe, deps);

    expect(subscriberCount).toBe(1);
    unsub();
    expect(subscriberCount).toBe(0);
  });

  test("ignores historical messages", async () => {
    let addMembersCalled = false;
    const slug = await buildValidSlug();

    const deps: InviteHostDeps = {
      ...createHostDeps(),
      addMembersToGroup: async () => {
        addMembersCalled = true;
        return Result.ok(undefined);
      },
    };

    let capturedHandler: ((event: CoreRawEvent) => void) | null = null;
    const mockSubscribe = (
      handler: (event: CoreRawEvent) => void,
    ): (() => void) => {
      capturedHandler = handler;
      return () => {};
    };

    startInviteHostListener(mockSubscribe, deps);

    // Emit a historical message with valid invite content
    capturedHandler!(makeRawMessageEvent(slug, { isHistorical: true }));

    // Wait a tick for any async processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(addMembersCalled).toBe(false);
  });

  test("ignores non-message events", () => {
    let handlerCalled = false;

    const deps: InviteHostDeps = {
      ...createHostDeps(),
      addMembersToGroup: async () => {
        handlerCalled = true;
        return Result.ok(undefined);
      },
    };

    let capturedHandler: ((event: CoreRawEvent) => void) | null = null;
    const mockSubscribe = (
      handler: (event: CoreRawEvent) => void,
    ): (() => void) => {
      capturedHandler = handler;
      return () => {};
    };

    startInviteHostListener(mockSubscribe, deps);

    // Emit a heartbeat event
    capturedHandler!({
      type: "raw.heartbeat",
      timestamp: new Date().toISOString(),
    });

    expect(handlerCalled).toBe(false);
  });

  test("processes valid invite in live message", async () => {
    let addedGroupId = "";
    let addedInboxIds: readonly string[] = [];
    const slug = await buildValidSlug();

    const deps: InviteHostDeps = {
      ...createHostDeps(),
      addMembersToGroup: async (groupId, inboxIds) => {
        addedGroupId = groupId;
        addedInboxIds = inboxIds;
        return Result.ok(undefined);
      },
    };

    let capturedHandler: ((event: CoreRawEvent) => void) | null = null;
    const mockSubscribe = (
      handler: (event: CoreRawEvent) => void,
    ): (() => void) => {
      capturedHandler = handler;
      return () => {};
    };

    startInviteHostListener(mockSubscribe, deps);

    // Emit a live message with a valid invite slug
    capturedHandler!(makeRawMessageEvent(slug));

    // Wait for the async fire-and-forget to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(addedGroupId).toBe(TEST_CONVERSATION_ID);
    expect(addedInboxIds).toEqual([TEST_REQUESTER_INBOX_ID]);
  });
});
