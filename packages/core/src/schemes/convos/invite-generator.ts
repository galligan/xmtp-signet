import { Result } from "better-result";
import protobuf from "protobufjs";
import { InternalError } from "@xmtp/signet-schemas";
import type { SignetError } from "@xmtp/signet-schemas";
import { createInviteCrypto } from "../invite-crypto.js";

// --- Protobuf schema definitions (must match invite-parser.ts) ---

const InvitePayloadType = new protobuf.Type("InvitePayload")
  .add(new protobuf.Field("conversationToken", 1, "bytes"))
  .add(new protobuf.Field("creatorInboxId", 2, "bytes"))
  .add(new protobuf.Field("tag", 3, "string"))
  .add(new protobuf.Field("name", 4, "string", "optional"))
  .add(new protobuf.Field("description_p", 5, "string", "optional"))
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

// --- Constants ---

const SEPARATOR_INTERVAL = 300;

const convosInviteCrypto = createInviteCrypto({
  salt: "ConvosInviteV1",
});

// --- Types ---

/** Preferred packing strategy for a conversation ID in a Convos invite. */
export type ConversationIdFormat = "uuid" | "string";

/** Options for generating a Convos invite slug. */
export interface GenerateInviteSlugOptions {
  /** The conversation/group ID to encrypt into the invite. */
  readonly conversationId: string;
  /**
   * Optional packing hint for UUID-shaped IDs that should still be encoded
   * as plain strings.
   */
  readonly conversationIdFormat?: ConversationIdFormat;
  /** Hex-encoded creator inbox ID. */
  readonly creatorInboxId: string;
  /** Hex-encoded secp256k1 private key (without 0x prefix). */
  readonly walletPrivateKeyHex: string;
  /** Unique invite tag for verification. */
  readonly inviteTag: string;
  /** Optional group name. */
  readonly name?: string;
  /** Optional group description. */
  readonly description?: string;
  /** Optional image URL. */
  readonly imageUrl?: string;
  /** Optional invite expiration time. */
  readonly expiresAt?: Date;
  /** Whether the invite expires after first use. */
  readonly expiresAfterUse?: boolean;
}

/** Options for generating a full Convos invite URL. */
export interface GenerateInviteUrlOptions extends GenerateInviteSlugOptions {
  /** XMTP environment: "production" or "dev". Defaults to "production". */
  readonly env?: "production" | "dev" | "local";
}

// --- Conversation ID packing ---

function packConversationId(
  conversationId: string,
  format?: ConversationIdFormat,
): Uint8Array {
  const uuidMatch = conversationId.match(
    /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i,
  );
  const shouldUseUuidEncoding =
    format === "uuid" ? true : format === "string" ? false : uuidMatch !== null;

  if (shouldUseUuidEncoding) {
    if (!uuidMatch) {
      throw new Error(
        `Conversation ID format "uuid" requires a canonical UUID: ${conversationId}`,
      );
    }

    const hex = uuidMatch.slice(1).join("");
    const uuidBytes = hexToBytes(hex);
    const result = new Uint8Array(1 + uuidBytes.length);
    result[0] = 0x01;
    result.set(uuidBytes, 1);
    return result;
  }
  const strBytes = new TextEncoder().encode(conversationId);
  if (strBytes.length <= 255) {
    const result = new Uint8Array(2 + strBytes.length);
    result[0] = 0x02;
    result[1] = strBytes.length;
    result.set(strBytes, 2);
    return result;
  }
  const result = new Uint8Array(4 + strBytes.length);
  result[0] = 0x02;
  result[1] = 0x00;
  result[2] = (strBytes.length >> 8) & 0xff;
  result[3] = strBytes.length & 0xff;
  result.set(strBytes, 4);
  return result;
}

/**
 * Unpack a conversation ID from the binary format.
 * Used on the creator side when processing join requests.
 */
export function unpackConversationId(data: Uint8Array): string {
  const tag = data[0];
  if (tag === 0x01) {
    const hexBytes = data.slice(1, 17);
    const hex = bytesToHex(hexBytes);
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
  }
  if (tag === 0x02) {
    let offset = 1;
    let length = data[offset];
    if (length === undefined) {
      throw new Error("Invalid packed conversation ID");
    }
    offset++;
    if (length === 0) {
      const high = data[offset];
      const low = data[offset + 1];
      if (high === undefined || low === undefined) {
        throw new Error("Invalid packed conversation ID length");
      }
      length = (high << 8) | low;
      offset += 2;
    }
    return new TextDecoder().decode(data.slice(offset, offset + length));
  }
  throw new Error(`Unknown conversation ID tag: ${tag}`);
}

// --- ChaCha20-Poly1305 encryption ---

function encryptConversationToken(
  conversationId: string,
  conversationIdFormat: ConversationIdFormat | undefined,
  creatorInboxId: string,
  privateKeyBytes: Uint8Array,
): Uint8Array {
  return convosInviteCrypto.encryptToken(
    packConversationId(conversationId, conversationIdFormat),
    creatorInboxId,
    privateKeyBytes,
  );
}

/**
 * Decrypt a conversation token to recover the conversation ID.
 * Used on the creator side when processing join requests.
 */
export function decryptConversationToken(
  tokenBytes: Uint8Array,
  creatorInboxId: string,
  privateKeyBytes: Uint8Array,
): string {
  return unpackConversationId(
    convosInviteCrypto.decryptToken(
      tokenBytes,
      creatorInboxId,
      privateKeyBytes,
    ),
  );
}

// --- Hex helpers ---

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// --- Base64URL ---

function base64UrlEncode(data: Uint8Array): string {
  return Buffer.from(data).toString("base64url");
}

// --- iMessage compatibility ---

function insertSeparators(str: string, sep: string, every: number): string {
  if (str.length <= every) return str;
  const parts: string[] = [];
  for (let i = 0; i < str.length; i += every) {
    parts.push(str.slice(i, i + every));
  }
  return parts.join(sep);
}

// --- Public API ---

/**
 * Generate a Convos-compatible invite slug.
 *
 * Steps:
 * 1. Encrypt conversation ID with ChaCha20-Poly1305
 * 2. Build InvitePayload protobuf
 * 3. Sign SHA256(payload) with secp256k1 ECDSA (recoverable)
 * 4. Wrap in SignedInvite, optionally compress, base64url encode
 * 5. Insert `*` separators every 300 chars (iMessage compat)
 */
export async function generateConvosInviteSlug(
  opts: GenerateInviteSlugOptions,
): Promise<Result<string, SignetError>> {
  try {
    const privateKeyBytes = hexToBytes(opts.walletPrivateKeyHex);

    // Step 1: Encrypt conversation ID
    const conversationToken = encryptConversationToken(
      opts.conversationId,
      opts.conversationIdFormat,
      opts.creatorInboxId,
      privateKeyBytes,
    );

    // Step 2: Build InvitePayload
    const creatorInboxIdBytes = hexToBytes(opts.creatorInboxId);

    const payloadObj: Record<string, unknown> = {
      conversationToken,
      creatorInboxId: creatorInboxIdBytes,
      tag: opts.inviteTag,
      expiresAfterUse: opts.expiresAfterUse ?? false,
    };
    if (opts.name !== undefined) payloadObj["name"] = opts.name;
    if (opts.description !== undefined)
      payloadObj["description_p"] = opts.description;
    if (opts.imageUrl !== undefined) payloadObj["imageURL"] = opts.imageUrl;
    if (opts.expiresAt !== undefined) {
      payloadObj["expiresAtUnix"] = Math.floor(opts.expiresAt.getTime() / 1000);
    }

    const errMsg = InvitePayloadType.verify(payloadObj);
    if (errMsg) {
      return Result.err(
        InternalError.create(`Invalid invite payload: ${errMsg}`),
      );
    }

    const payloadBytes = InvitePayloadType.encode(
      InvitePayloadType.create(payloadObj),
    ).finish();

    // Step 3: Sign SHA256(payload) with secp256k1
    const signature = convosInviteCrypto.sign(payloadBytes, privateKeyBytes);

    // Step 4: Wrap in SignedInvite
    const signedInviteBytes = SignedInviteType.encode(
      SignedInviteType.create({
        payload: payloadBytes,
        signature,
      }),
    ).finish();

    // Compress if beneficial
    const compressed = convosInviteCrypto.compress(signedInviteBytes);

    // Step 5: Base64url encode and insert separators
    const encoded = base64UrlEncode(compressed);
    return Result.ok(insertSeparators(encoded, "*", SEPARATOR_INTERVAL));
  } catch (cause) {
    return Result.err(
      InternalError.create(
        `Failed to generate invite slug: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
    );
  }
}

/**
 * Generate a full Convos-compatible invite URL.
 *
 * Production: `https://popup.convos.org/v2?i=<slug>`
 * Dev: `https://dev.convos.org/v2?i=<slug>`
 */
export async function generateConvosInviteUrl(
  opts: GenerateInviteUrlOptions,
): Promise<Result<string, SignetError>> {
  const slugResult = await generateConvosInviteSlug(opts);
  if (!slugResult.isOk()) return slugResult;

  const baseUrl =
    opts.env === "dev" || opts.env === "local"
      ? "https://dev.convos.org/v2"
      : "https://popup.convos.org/v2";

  return Result.ok(`${baseUrl}?i=${encodeURIComponent(slugResult.value)}`);
}
