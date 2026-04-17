import { describe, expect, test } from "bun:test";
import {
  generateConvosInviteSlug,
  generateConvosInviteUrl,
} from "../invite-generator.js";
import { parseConvosInviteUrl, verifyConvosInvite } from "../invite-parser.js";

// --- Test key material ---

/** 32-byte secp256k1 private key (hex, no 0x prefix). */
const TEST_PRIVATE_KEY_HEX =
  "0000000000000000000000000000000000000000000000000000000000000001";

const TEST_CREATOR_INBOX_ID =
  "aabbccddee1122334455667788990011aabbccddee1122334455667788990011";

const TEST_CONVERSATION_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("generateConvosInviteSlug", () => {
  test("generates a valid slug that can be roundtripped through the parser", async () => {
    const slugResult = await generateConvosInviteSlug({
      conversationId: TEST_CONVERSATION_ID,
      creatorInboxId: TEST_CREATOR_INBOX_ID,
      walletPrivateKeyHex: TEST_PRIVATE_KEY_HEX,
      inviteTag: "test-tag-001",
    });

    expect(slugResult.isOk()).toBe(true);
    if (!slugResult.isOk()) return;

    const slug = slugResult.value;
    expect(typeof slug).toBe("string");
    expect(slug.length).toBeGreaterThan(0);

    // Roundtrip through parser
    const parseResult = parseConvosInviteUrl(slug);
    expect(parseResult.isOk()).toBe(true);
    if (!parseResult.isOk()) return;

    const parsed = parseResult.value;
    expect(parsed.tag).toBe("test-tag-001");
    expect(parsed.creatorInboxId).toBe(TEST_CREATOR_INBOX_ID);
    expect(parsed.isExpired).toBe(false);
  });

  test("roundtrip preserves optional name and description", async () => {
    const slugResult = await generateConvosInviteSlug({
      conversationId: TEST_CONVERSATION_ID,
      creatorInboxId: TEST_CREATOR_INBOX_ID,
      walletPrivateKeyHex: TEST_PRIVATE_KEY_HEX,
      inviteTag: "named-group",
      name: "My Group Chat",
      description: "A group for testing invites",
    });

    expect(slugResult.isOk()).toBe(true);
    if (!slugResult.isOk()) return;

    const parseResult = parseConvosInviteUrl(slugResult.value);
    expect(parseResult.isOk()).toBe(true);
    if (!parseResult.isOk()) return;

    expect(parseResult.value.name).toBe("My Group Chat");
    expect(parseResult.value.description).toBe("A group for testing invites");
  });

  test("roundtrip preserves expiration time", async () => {
    const futureTime = new Date(Date.now() + 86_400_000); // +24h

    const slugResult = await generateConvosInviteSlug({
      conversationId: TEST_CONVERSATION_ID,
      creatorInboxId: TEST_CREATOR_INBOX_ID,
      walletPrivateKeyHex: TEST_PRIVATE_KEY_HEX,
      inviteTag: "expiring-invite",
      expiresAt: futureTime,
    });

    expect(slugResult.isOk()).toBe(true);
    if (!slugResult.isOk()) return;

    const parseResult = parseConvosInviteUrl(slugResult.value);
    expect(parseResult.isOk()).toBe(true);
    if (!parseResult.isOk()) return;

    expect(parseResult.value.isExpired).toBe(false);
  });

  test("generated slug passes signature verification", async () => {
    const slugResult = await generateConvosInviteSlug({
      conversationId: TEST_CONVERSATION_ID,
      creatorInboxId: TEST_CREATOR_INBOX_ID,
      walletPrivateKeyHex: TEST_PRIVATE_KEY_HEX,
      inviteTag: "verified-tag",
    });

    expect(slugResult.isOk()).toBe(true);
    if (!slugResult.isOk()) return;

    const parseResult = parseConvosInviteUrl(slugResult.value);
    expect(parseResult.isOk()).toBe(true);
    if (!parseResult.isOk()) return;

    const verifyResult = verifyConvosInvite(parseResult.value);
    expect(verifyResult.isOk()).toBe(true);
  });

  test("inserts * separators for long slugs", async () => {
    // Large description forces a long slug
    const slugResult = await generateConvosInviteSlug({
      conversationId: TEST_CONVERSATION_ID,
      creatorInboxId: TEST_CREATOR_INBOX_ID,
      walletPrivateKeyHex: TEST_PRIVATE_KEY_HEX,
      inviteTag: "long-slug-tag",
      description: "A".repeat(500),
    });

    expect(slugResult.isOk()).toBe(true);
    if (!slugResult.isOk()) return;

    const slug = slugResult.value;
    // If slug > 300 chars, separators should be inserted
    if (slug.replace(/\*/g, "").length > 300) {
      expect(slug).toContain("*");
    }

    // Still parseable
    const parseResult = parseConvosInviteUrl(slug);
    expect(parseResult.isOk()).toBe(true);
  });

  test("compresses large payloads", async () => {
    // Uncompressed slug with large description
    const slugResult = await generateConvosInviteSlug({
      conversationId: TEST_CONVERSATION_ID,
      creatorInboxId: TEST_CREATOR_INBOX_ID,
      walletPrivateKeyHex: TEST_PRIVATE_KEY_HEX,
      inviteTag: "compress-tag",
      description: "B".repeat(500),
    });

    expect(slugResult.isOk()).toBe(true);
    if (!slugResult.isOk()) return;

    // The slug should still parse correctly (compression is transparent)
    const parseResult = parseConvosInviteUrl(slugResult.value);
    expect(parseResult.isOk()).toBe(true);
    if (!parseResult.isOk()) return;

    expect(parseResult.value.description).toBe("B".repeat(500));
  });
});

describe("generateConvosInviteUrl", () => {
  test("generates production URL with popup.convos.org", async () => {
    const urlResult = await generateConvosInviteUrl({
      conversationId: TEST_CONVERSATION_ID,
      creatorInboxId: TEST_CREATOR_INBOX_ID,
      walletPrivateKeyHex: TEST_PRIVATE_KEY_HEX,
      inviteTag: "prod-tag",
      env: "production",
    });

    expect(urlResult.isOk()).toBe(true);
    if (!urlResult.isOk()) return;

    const url = urlResult.value;
    expect(url).toMatch(/^https:\/\/popup\.convos\.org\/v2\?i=/);

    // Parseable
    const parseResult = parseConvosInviteUrl(url);
    expect(parseResult.isOk()).toBe(true);
  });

  test("generates dev URL with dev.convos.org", async () => {
    const urlResult = await generateConvosInviteUrl({
      conversationId: TEST_CONVERSATION_ID,
      creatorInboxId: TEST_CREATOR_INBOX_ID,
      walletPrivateKeyHex: TEST_PRIVATE_KEY_HEX,
      inviteTag: "dev-tag",
      env: "dev",
    });

    expect(urlResult.isOk()).toBe(true);
    if (!urlResult.isOk()) return;

    const url = urlResult.value;
    expect(url).toMatch(/^https:\/\/dev\.convos\.org\/v2\?i=/);

    // Parseable
    const parseResult = parseConvosInviteUrl(url);
    expect(parseResult.isOk()).toBe(true);
  });

  test("defaults to production URL", async () => {
    const urlResult = await generateConvosInviteUrl({
      conversationId: TEST_CONVERSATION_ID,
      creatorInboxId: TEST_CREATOR_INBOX_ID,
      walletPrivateKeyHex: TEST_PRIVATE_KEY_HEX,
      inviteTag: "default-tag",
    });

    expect(urlResult.isOk()).toBe(true);
    if (!urlResult.isOk()) return;

    expect(urlResult.value).toMatch(/^https:\/\/popup\.convos\.org\/v2\?i=/);
  });
});
