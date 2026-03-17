import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import { generateConvosInviteSlug } from "../invite-generator.js";
import {
  processJoinRequest,
  type ProcessJoinRequestDeps,
} from "../process-join-requests.js";

// --- Test key material ---

const TEST_PRIVATE_KEY_HEX =
  "0000000000000000000000000000000000000000000000000000000000000001";

const TEST_CREATOR_INBOX_ID =
  "aabbccddee1122334455667788990011aabbccddee1122334455667788990011";

const TEST_CONVERSATION_ID = "550e8400-e29b-41d4-a716-446655440000";
const TEST_REQUESTER_INBOX_ID = "requester-inbox-id-abc123";

/** Build a valid slug for testing. */
async function buildValidSlug(overrides?: {
  expiresAt?: Date;
}): Promise<string> {
  const result = await generateConvosInviteSlug({
    conversationId: TEST_CONVERSATION_ID,
    creatorInboxId: TEST_CREATOR_INBOX_ID,
    walletPrivateKeyHex: TEST_PRIVATE_KEY_HEX,
    inviteTag: "join-test-tag",
    ...overrides,
  });
  if (!result.isOk()) throw new Error("Failed to generate slug for test");
  return result.value;
}

function createMockDeps(overrides?: {
  addMembersResult?: Result<void, SignetError>;
  getGroupTagResult?: Result<string | undefined, SignetError>;
}): ProcessJoinRequestDeps {
  return {
    walletPrivateKeyHex: TEST_PRIVATE_KEY_HEX,
    creatorInboxId: TEST_CREATOR_INBOX_ID,
    addMembersToGroup: async (_groupId, _inboxIds) =>
      overrides?.addMembersResult ?? Result.ok(undefined),
    getGroupInviteTag: async (_groupId) =>
      overrides?.getGroupTagResult ?? Result.ok("join-test-tag"),
  };
}

describe("processJoinRequest", () => {
  test("processes a valid join request and adds member", async () => {
    const slug = await buildValidSlug();
    const deps = createMockDeps();

    const result = await processJoinRequest(deps, {
      senderInboxId: TEST_REQUESTER_INBOX_ID,
      messageText: slug,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.groupId).toBe(TEST_CONVERSATION_ID);
    expect(result.value.requesterInboxId).toBe(TEST_REQUESTER_INBOX_ID);
    expect(result.value.inviteTag).toBe("join-test-tag");
  });

  test("rejects expired invite", async () => {
    const pastDate = new Date(Date.now() - 3_600_000); // 1 hour ago
    const slug = await buildValidSlug({ expiresAt: pastDate });
    const deps = createMockDeps();

    const result = await processJoinRequest(deps, {
      senderInboxId: TEST_REQUESTER_INBOX_ID,
      messageText: slug,
    });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;

    expect(result.error.message).toContain("expired");
  });

  test("rejects invite signed by different key", async () => {
    // Generate with a different key
    const differentKeyHex =
      "0000000000000000000000000000000000000000000000000000000000000002";

    const slugResult = await generateConvosInviteSlug({
      conversationId: TEST_CONVERSATION_ID,
      creatorInboxId: TEST_CREATOR_INBOX_ID,
      walletPrivateKeyHex: differentKeyHex,
      inviteTag: "wrong-key-tag",
    });

    expect(slugResult.isOk()).toBe(true);
    if (!slugResult.isOk()) return;

    // Process with the original key -- should reject
    const deps = createMockDeps();
    const result = await processJoinRequest(deps, {
      senderInboxId: TEST_REQUESTER_INBOX_ID,
      messageText: slugResult.value,
    });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;

    expect(result.error.message).toContain("signature");
  });

  test("rejects message that is not a valid invite slug", async () => {
    const deps = createMockDeps();
    const result = await processJoinRequest(deps, {
      senderInboxId: TEST_REQUESTER_INBOX_ID,
      messageText: "hello, I would like to join!",
    });

    expect(result.isErr()).toBe(true);
  });
});
