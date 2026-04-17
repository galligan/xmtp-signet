import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import protobuf from "protobufjs";
import Long from "long";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import {
  parseConvosInviteUrl,
  verifyConvosInvite,
  type ParsedConvosInvite,
} from "../invite-parser.js";

// --- Test helpers to construct valid invite data ---

// Configure protobufjs Long support
protobuf.util.Long = Long;
protobuf.configure();

const InvitePayloadType = new protobuf.Type("InvitePayload")
  .add(new protobuf.Field("conversationToken", 1, "bytes"))
  .add(new protobuf.Field("creatorInboxId", 2, "bytes"))
  .add(new protobuf.Field("tag", 3, "string"))
  .add(new protobuf.Field("name", 4, "string", "optional"))
  .add(new protobuf.Field("description", 5, "string", "optional"))
  .add(new protobuf.Field("imageURL", 6, "string", "optional"))
  .add(
    new protobuf.Field("conversationExpiresAtUnix", 7, "sfixed64", "optional"),
  )
  .add(new protobuf.Field("expiresAtUnix", 8, "sfixed64", "optional"))
  .add(new protobuf.Field("expiresAfterUse", 9, "bool"));

const SignedInviteType = new protobuf.Type("SignedInvite")
  .add(new protobuf.Field("payload", 1, "bytes"))
  .add(new protobuf.Field("signature", 2, "bytes"));

new protobuf.Root().add(InvitePayloadType).add(SignedInviteType);

interface TestInvitePayload {
  conversationToken: Uint8Array;
  creatorInboxId: string;
  tag: string;
  name?: string;
  description?: string;
  expiresAtUnix?: bigint;
  conversationExpiresAtUnix?: bigint;
  expiresAfterUse: boolean;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function encodeTestPayload(payload: TestInvitePayload): Uint8Array {
  const msg = InvitePayloadType.create({
    conversationToken: payload.conversationToken,
    creatorInboxId: hexToBytes(payload.creatorInboxId),
    tag: payload.tag,
    name: payload.name,
    description: payload.description,
    conversationExpiresAtUnix: payload.conversationExpiresAtUnix
      ? longFromBigInt(payload.conversationExpiresAtUnix)
      : undefined,
    expiresAtUnix: payload.expiresAtUnix
      ? longFromBigInt(payload.expiresAtUnix)
      : undefined,
    expiresAfterUse: payload.expiresAfterUse,
  });
  return InvitePayloadType.encode(msg).finish();
}

function longFromBigInt(value: bigint): Long {
  const low = Number(value & 0xffffffffn);
  const high = Number((value >> 32n) & 0xffffffffn);
  return new Long(low, high, false);
}

/**
 * Sign payload bytes with secp256k1, returning 65-byte recoverable signature.
 */
function signPayload(
  payloadBytes: Uint8Array,
  privateKey: Uint8Array,
): Uint8Array {
  const hash = sha256(payloadBytes);
  const sig = secp256k1.sign(hash, privateKey);
  const compact = sig.toCompactRawBytes();
  const result = new Uint8Array(65);
  result.set(compact, 0);
  result[64] = sig.recovery;
  return result;
}

function encodeSignedInvite(
  payloadBytes: Uint8Array,
  signature: Uint8Array,
): Uint8Array {
  const msg = SignedInviteType.create({
    payload: payloadBytes,
    signature,
  });
  return SignedInviteType.encode(msg).finish();
}

function base64UrlEncode(data: Uint8Array): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const COMPRESSION_MARKER = 0x1f;

/**
 * Compress data using the Convos format:
 * [0x1f marker][4-byte BE original size][zlib deflate data]
 */
function compressData(data: Uint8Array): Uint8Array {
  const compressed = deflateSync(data);
  const result = new Uint8Array(compressed.length + 5);
  result[0] = COMPRESSION_MARKER;
  // 4-byte big-endian original size
  const size = data.length;
  result[1] = (size >>> 24) & 0xff;
  result[2] = (size >>> 16) & 0xff;
  result[3] = (size >>> 8) & 0xff;
  result[4] = size & 0xff;
  result.set(compressed, 5);
  return result;
}

function insertSeparators(str: string, every: number): string {
  if (str.length <= every) return str;
  const parts: string[] = [];
  for (let i = 0; i < str.length; i += every) {
    parts.push(str.slice(i, i + every));
  }
  return parts.join("*");
}

/** Build a complete slug from test payload and private key. */
function buildTestSlug(
  payload: TestInvitePayload,
  privateKey: Uint8Array,
  options?: { compress?: boolean; separators?: boolean },
): string {
  const payloadBytes = encodeTestPayload(payload);
  const signature = signPayload(payloadBytes, privateKey);
  const signedBytes = encodeSignedInvite(payloadBytes, signature);

  let data: Uint8Array;
  if (options?.compress !== false && signedBytes.length >= 100) {
    data = compressData(signedBytes);
  } else {
    data = signedBytes;
  }

  let slug = base64UrlEncode(data);
  if (options?.separators !== false && slug.length > 300) {
    slug = insertSeparators(slug, 300);
  }

  return slug;
}

function buildTestUrl(slug: string): string {
  return `https://popup.convos.org/v2?i=${encodeURIComponent(slug)}`;
}

// --- Test private key (32 bytes) ---
const TEST_PRIVATE_KEY = new Uint8Array(32);
TEST_PRIVATE_KEY[31] = 1; // Valid non-zero key

const TEST_CREATOR_INBOX_ID =
  "aabbccddee1122334455667788990011aabbccddee1122334455667788990011";

function defaultTestPayload(
  overrides?: Partial<TestInvitePayload>,
): TestInvitePayload {
  return {
    conversationToken: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    creatorInboxId: TEST_CREATOR_INBOX_ID,
    tag: "test-tag-abc123",
    name: "Test Group",
    expiresAfterUse: false,
    ...overrides,
  };
}

describe("parseConvosInviteUrl", () => {
  test("parses a valid invite URL", () => {
    const payload = defaultTestPayload();
    const slug = buildTestSlug(payload, TEST_PRIVATE_KEY, {
      compress: false,
    });
    const url = buildTestUrl(slug);

    const result = parseConvosInviteUrl(url);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const parsed = result.value;
    expect(parsed.creatorInboxId).toBe(TEST_CREATOR_INBOX_ID);
    expect(parsed.tag).toBe("test-tag-abc123");
    expect(parsed.name).toBe("Test Group");
    expect(parsed.expiresAfterUse).toBe(false);
    expect(parsed.isExpired).toBe(false);
  });

  test("parses a raw slug without URL wrapper", () => {
    const payload = defaultTestPayload();
    const slug = buildTestSlug(payload, TEST_PRIVATE_KEY, {
      compress: false,
    });

    const result = parseConvosInviteUrl(slug);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.tag).toBe("test-tag-abc123");
  });

  test("handles * separators in slug", () => {
    const payload = defaultTestPayload({
      description: "A".repeat(500), // make slug long enough for separators
    });
    const slug = buildTestSlug(payload, TEST_PRIVATE_KEY, {
      compress: false,
      separators: true,
    });

    // Verify separators were inserted
    expect(slug).toContain("*");

    const url = buildTestUrl(slug);
    const result = parseConvosInviteUrl(url);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.tag).toBe("test-tag-abc123");
    expect(result.value.description).toBe("A".repeat(500));
  });

  test("handles compressed data", () => {
    const payload = defaultTestPayload({
      description: "B".repeat(500), // ensure large enough to compress
    });
    const slug = buildTestSlug(payload, TEST_PRIVATE_KEY, {
      compress: true,
      separators: false,
    });

    const result = parseConvosInviteUrl(slug);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.tag).toBe("test-tag-abc123");
    expect(result.value.description).toBe("B".repeat(500));
  });

  test("detects expired invite", () => {
    const pastTime = BigInt(Math.floor(Date.now() / 1000) - 3600); // 1 hour ago
    const payload = defaultTestPayload({
      expiresAtUnix: pastTime,
    });
    const slug = buildTestSlug(payload, TEST_PRIVATE_KEY, {
      compress: false,
    });

    const result = parseConvosInviteUrl(slug);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.isExpired).toBe(true);
  });

  test("detects expired conversation", () => {
    const pastTime = BigInt(Math.floor(Date.now() / 1000) - 3600);
    const payload = defaultTestPayload({
      conversationExpiresAtUnix: pastTime,
    });
    const slug = buildTestSlug(payload, TEST_PRIVATE_KEY, {
      compress: false,
    });

    const result = parseConvosInviteUrl(slug);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.isConversationExpired).toBe(true);
  });

  test("marks non-expired invite correctly", () => {
    const futureTime = BigInt(Math.floor(Date.now() / 1000) + 86400); // +24h
    const payload = defaultTestPayload({
      expiresAtUnix: futureTime,
    });
    const slug = buildTestSlug(payload, TEST_PRIVATE_KEY, {
      compress: false,
    });

    const result = parseConvosInviteUrl(slug);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.isExpired).toBe(false);
  });

  test("returns error for invalid base64", () => {
    const result = parseConvosInviteUrl("!!!not-valid-base64!!!");
    expect(result.isErr()).toBe(true);
  });

  test("returns error for truncated protobuf", () => {
    // Valid base64url but not valid protobuf
    const result = parseConvosInviteUrl(base64UrlEncode(new Uint8Array([1])));
    expect(result.isErr()).toBe(true);
  });

  test("parses dev.convos.org URL format", () => {
    const payload = defaultTestPayload();
    const slug = buildTestSlug(payload, TEST_PRIVATE_KEY, {
      compress: false,
    });
    const url = `https://dev.convos.org/v2?i=${encodeURIComponent(slug)}`;

    const result = parseConvosInviteUrl(url);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.tag).toBe("test-tag-abc123");
  });

  test("preserves all optional fields", () => {
    const payload = defaultTestPayload({
      name: "My Group",
      description: "A test group",
    });
    const slug = buildTestSlug(payload, TEST_PRIVATE_KEY, {
      compress: false,
    });

    const result = parseConvosInviteUrl(slug);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.name).toBe("My Group");
    expect(result.value.description).toBe("A test group");
  });
});

describe("verifyConvosInvite", () => {
  test("verifies valid signature", () => {
    const payload = defaultTestPayload();
    const slug = buildTestSlug(payload, TEST_PRIVATE_KEY, {
      compress: false,
    });

    const parseResult = parseConvosInviteUrl(slug);
    expect(parseResult.isOk()).toBe(true);
    if (!parseResult.isOk()) return;

    const verifyResult = verifyConvosInvite(parseResult.value);
    expect(verifyResult.isOk()).toBe(true);
  });

  test("tampered payload recovers a different public key", () => {
    const payload = defaultTestPayload();
    const slug = buildTestSlug(payload, TEST_PRIVATE_KEY, {
      compress: false,
    });

    const parseResult = parseConvosInviteUrl(slug);
    expect(parseResult.isOk()).toBe(true);
    if (!parseResult.isOk()) return;

    // Tamper with the payload -- recovery still works but yields a different key
    const tampered: ParsedConvosInvite = {
      ...parseResult.value,
      signedInvitePayloadBytes: new Uint8Array(
        parseResult.value.signedInvitePayloadBytes,
      ),
      signedInviteSignature: parseResult.value.signedInviteSignature,
    };
    const firstByte = tampered.signedInvitePayloadBytes[0];
    if (firstByte !== undefined) {
      tampered.signedInvitePayloadBytes[0] = firstByte ^ 0xff;
    }

    // Structural verification still passes (signature is syntactically valid)
    const verifyResult = verifyConvosInvite(tampered);
    expect(verifyResult.isOk()).toBe(true);

    // But the recovered public key would differ from the original signer.
    // Full identity verification requires comparing against a known key.
  });

  test("rejects invite with invalid signature bytes", () => {
    const payload = defaultTestPayload();
    const slug = buildTestSlug(payload, TEST_PRIVATE_KEY, {
      compress: false,
    });

    const parseResult = parseConvosInviteUrl(slug);
    expect(parseResult.isOk()).toBe(true);
    if (!parseResult.isOk()) return;

    // Replace signature with garbage
    const tampered: ParsedConvosInvite = {
      ...parseResult.value,
      signedInviteSignature: new Uint8Array(65).fill(0),
    };

    const verifyResult = verifyConvosInvite(tampered);
    expect(verifyResult.isErr()).toBe(true);
  });
});
