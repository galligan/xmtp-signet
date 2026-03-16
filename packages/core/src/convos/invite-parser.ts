import { inflateSync } from "node:zlib";
import { Result } from "better-result";
import { ValidationError } from "@xmtp-broker/schemas";
import type { BrokerError } from "@xmtp-broker/schemas";
import protobuf from "protobufjs";
import Long from "long";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";

// --- Protobuf schema definitions (programmatic, matching Convos format) ---

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

// --- Constants ---

/**
 * Compression marker byte used by Convos slug encoding.
 * Format: [0x1f marker][4-byte BE original size][zlib deflate data]
 * Matches the iOS and CLI implementations.
 */
const COMPRESSION_MARKER = 0x1f;

/** Maximum decompressed size (1 MB) to prevent decompression bombs. */
const MAX_DECOMPRESSED_SIZE = 1024 * 1024;

// --- Types ---

/** Parsed and decoded Convos invite with all payload fields. */
export interface ParsedConvosInvite {
  /** Raw payload bytes from the SignedInvite (for signature verification). */
  readonly signedInvitePayloadBytes: Uint8Array;
  /** Raw signature bytes from the SignedInvite (for signature verification). */
  readonly signedInviteSignature: Uint8Array;
  /** Encrypted conversation token (only creator can decrypt). */
  readonly conversationToken: Uint8Array;
  /** Hex-encoded creator inbox ID. */
  readonly creatorInboxId: string;
  /** Unique invite tag for verification. */
  readonly tag: string;
  /** Optional group name. */
  readonly name: string | undefined;
  /** Optional group description. */
  readonly description: string | undefined;
  /** Optional image URL. */
  readonly imageUrl: string | undefined;
  /** Whether the invite has expired. */
  readonly isExpired: boolean;
  /** Whether the conversation has expired. */
  readonly isConversationExpired: boolean;
  /** Whether the invite expires after first use. */
  readonly expiresAfterUse: boolean;
}

// --- Decoded protobuf message shape ---

interface DecodedInvitePayload {
  conversationToken: Uint8Array;
  creatorInboxId: Uint8Array;
  tag: string;
  name?: string;
  description?: string;
  imageURL?: string;
  conversationExpiresAtUnix?: protobuf.Long;
  expiresAtUnix?: protobuf.Long;
  expiresAfterUse: boolean;
}

interface DecodedSignedInvite {
  payload: Uint8Array;
  signature: Uint8Array;
}

// --- Helpers ---

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (base64.length % 4)) % 4;
  base64 += "=".repeat(padLength);
  return new Uint8Array(Buffer.from(base64, "base64"));
}

function decompress(
  data: Uint8Array,
): Result<Uint8Array, BrokerError> {
  if (data.length === 0 || data[0] !== COMPRESSION_MARKER) {
    return Result.ok(data);
  }

  // Skip 5-byte header: [marker][4-byte BE original size]
  const compressed = data.slice(5);
  const decompressed = inflateSync(compressed);

  if (decompressed.length > MAX_DECOMPRESSED_SIZE) {
    return Result.err(
      ValidationError.create(
        "inviteUrl",
        `Decompressed size exceeds maximum: ${decompressed.length}`,
      ),
    );
  }

  return Result.ok(new Uint8Array(decompressed));
}

/**
 * Extract the invite slug from a URL or return it as-is if it's a raw slug.
 *
 * Handles:
 * - `https://popup.convos.org/v2?i=<slug>`
 * - `https://dev.convos.org/v2?i=<slug>`
 * - Legacy `?code=` format
 * - Raw slug string
 */
function extractSlug(input: string): string {
  const trimmed = input.trim();

  try {
    const url = new URL(trimmed);

    const iParam = url.searchParams.get("i");
    if (iParam) return iParam;

    const codeParam = url.searchParams.get("code");
    if (codeParam) return codeParam;

    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length > 0) {
      const last = pathParts[pathParts.length - 1];
      if (last !== undefined) return last;
    }
  } catch {
    // Not a URL, treat as raw slug
  }

  return trimmed;
}

function longToBigInt(value: protobuf.Long): bigint {
  return BigInt(value.toString());
}

/**
 * Parse a Convos invite URL or slug into a structured invite object.
 *
 * Steps:
 * 1. Extract slug from URL (or use raw slug)
 * 2. Remove `*` separators (iMessage compatibility)
 * 3. Base64url decode
 * 4. Decompress if compressed (0x78 marker)
 * 5. Decode protobuf SignedInvite
 * 6. Decode protobuf InvitePayload
 * 7. Check expiration
 */
export function parseConvosInviteUrl(
  input: string,
): Result<ParsedConvosInvite, BrokerError> {
  try {
    // Step 1: Extract slug
    const slug = extractSlug(input);

    // Step 2: Remove * separators
    const cleanSlug = slug.replace(/\*/g, "");

    // Step 3: Base64url decode
    const decoded = base64UrlDecode(cleanSlug);
    if (decoded.length === 0) {
      return Result.err(
        ValidationError.create("inviteUrl", "Empty invite data"),
      );
    }

    // Step 4: Decompress
    const decompressResult = decompress(decoded);
    if (decompressResult.isErr()) return decompressResult;
    const decompressed = decompressResult.value;

    // Step 5: Decode SignedInvite protobuf
    const signedInvite = SignedInviteType.decode(
      decompressed,
    ) as unknown as DecodedSignedInvite;

    if (
      !signedInvite.payload ||
      signedInvite.payload.length === 0 ||
      !signedInvite.signature ||
      signedInvite.signature.length === 0
    ) {
      return Result.err(
        ValidationError.create(
          "inviteUrl",
          "Invalid SignedInvite: missing payload or signature",
        ),
      );
    }

    const payloadBytes = new Uint8Array(signedInvite.payload);
    const signatureBytes = new Uint8Array(signedInvite.signature);

    // Step 6: Decode InvitePayload protobuf
    const payload = InvitePayloadType.decode(
      payloadBytes,
    ) as unknown as DecodedInvitePayload;

    if (!payload.creatorInboxId || payload.creatorInboxId.length === 0) {
      return Result.err(
        ValidationError.create(
          "inviteUrl",
          "Invalid InvitePayload: missing creatorInboxId",
        ),
      );
    }

    if (!payload.tag) {
      return Result.err(
        ValidationError.create(
          "inviteUrl",
          "Invalid InvitePayload: missing tag",
        ),
      );
    }

    // Step 7: Check expiration
    const nowUnix = BigInt(Math.floor(Date.now() / 1000));

    const expiresAtUnix =
      payload.expiresAtUnix && payload.expiresAtUnix.toString() !== "0"
        ? longToBigInt(payload.expiresAtUnix)
        : undefined;

    const conversationExpiresAtUnix =
      payload.conversationExpiresAtUnix &&
      payload.conversationExpiresAtUnix.toString() !== "0"
        ? longToBigInt(payload.conversationExpiresAtUnix)
        : undefined;

    const isExpired = expiresAtUnix !== undefined && expiresAtUnix < nowUnix;
    const isConversationExpired =
      conversationExpiresAtUnix !== undefined &&
      conversationExpiresAtUnix < nowUnix;

    return Result.ok({
      signedInvitePayloadBytes: payloadBytes,
      signedInviteSignature: signatureBytes,
      conversationToken: new Uint8Array(payload.conversationToken),
      creatorInboxId: bytesToHex(new Uint8Array(payload.creatorInboxId)),
      tag: payload.tag,
      name: payload.name || undefined,
      description: payload.description || undefined,
      imageUrl: payload.imageURL || undefined,
      isExpired,
      isConversationExpired,
      expiresAfterUse: payload.expiresAfterUse ?? false,
    });
  } catch (cause) {
    return Result.err(
      ValidationError.create(
        "inviteUrl",
        `Failed to parse invite: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
    );
  }
}

/**
 * Verify a parsed Convos invite's signature.
 *
 * Recovers the secp256k1 public key from the signature and verifies
 * the signature is valid. This does NOT verify the signer is who
 * they claim to be (that would require comparing against a known key).
 * It only verifies structural integrity: that the signature was produced
 * by some valid private key over the given payload.
 */
export function verifyConvosInvite(
  invite: ParsedConvosInvite,
): Result<void, BrokerError> {
  try {
    const { signedInvitePayloadBytes, signedInviteSignature } = invite;

    if (signedInviteSignature.length !== 65) {
      return Result.err(
        ValidationError.create(
          "inviteSignature",
          `Invalid signature length: expected 65 bytes, got ${signedInviteSignature.length}`,
        ),
      );
    }

    const messageHash = sha256(signedInvitePayloadBytes);
    const compactSig = signedInviteSignature.slice(0, 64);
    const recoveryBit = signedInviteSignature[64];

    if (recoveryBit === undefined || recoveryBit > 3) {
      return Result.err(
        ValidationError.create(
          "inviteSignature",
          `Invalid recovery bit: ${recoveryBit}`,
        ),
      );
    }

    // Attempt to recover public key -- will throw if signature is invalid
    const sig =
      secp256k1.Signature.fromCompact(compactSig).addRecoveryBit(recoveryBit);
    sig.recoverPublicKey(messageHash);

    return Result.ok();
  } catch (cause) {
    return Result.err(
      ValidationError.create(
        "inviteSignature",
        `Signature verification failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
    );
  }
}
