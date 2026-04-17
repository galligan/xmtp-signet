import { deflateSync, inflateSync } from "node:zlib";
import type { Result } from "better-result";
import { Result as BetterResult } from "better-result";
import { ValidationError } from "@xmtp/signet-schemas";
import type { SignetError } from "@xmtp/signet-schemas";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { secp256k1 } from "@noble/curves/secp256k1";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";

const DEFAULT_FORMAT_VERSION = 1;
const DEFAULT_COMPRESSION_MARKER = 0x1f;
const DEFAULT_COMPRESSION_THRESHOLD_BYTES = 100;
const DEFAULT_MAX_DECOMPRESSED_SIZE = 1024 * 1024;

/** Configuration for a concrete onboarding scheme's invite crypto behavior. */
export interface InviteCryptoConfig {
  /** HKDF salt string used for token key derivation. */
  readonly salt: string;
  /** Token format version byte. Defaults to `1`. */
  readonly formatVersion?: number;
  /** Compression marker byte. Defaults to `0x1f`. */
  readonly compressionMarker?: number;
  /** Minimum payload size before compression is attempted. Defaults to `100`. */
  readonly compressionThresholdBytes?: number;
  /**
   * Maximum allowed decompressed size to prevent decompression bombs.
   * Defaults to `1 MiB`.
   */
  readonly maxDecompressedSize?: number;
}

/** Shared invite crypto primitives used by onboarding schemes. */
export interface InviteCrypto {
  /** Encrypt an opaque token payload for transport inside an invite. */
  encryptToken(
    plaintext: Uint8Array,
    inboxId: string,
    privateKeyBytes: Uint8Array,
  ): Uint8Array;

  /** Decrypt an opaque token payload carried inside an invite. */
  decryptToken(
    tokenBytes: Uint8Array,
    inboxId: string,
    privateKeyBytes: Uint8Array,
  ): Uint8Array;

  /** Sign payload bytes with a recoverable secp256k1 signature. */
  sign(payloadBytes: Uint8Array, privateKeyBytes: Uint8Array): Uint8Array;

  /** Recover the signer's public key from a recoverable invite signature. */
  recoverPublicKey(
    payloadBytes: Uint8Array,
    signatureBytes: Uint8Array,
  ): Uint8Array;

  /** Conditionally compress payload bytes when it materially helps. */
  compress(data: Uint8Array): Uint8Array;

  /** Decompress payload bytes when the configured marker is present. */
  decompress(
    data: Uint8Array,
    options?: { readonly errorField?: string },
  ): Result<Uint8Array, SignetError>;
}

function createDeriveTokenKey(saltBytes: Uint8Array) {
  return function deriveTokenKey(
    privateKeyBytes: Uint8Array,
    inboxId: string,
  ): Uint8Array {
    const info = new TextEncoder().encode(`inbox:${inboxId}`);
    return hkdf(sha256, privateKeyBytes, saltBytes, info, 32);
  };
}

/** Create the shared invite crypto implementation for one scheme. */
export function createInviteCrypto(config: InviteCryptoConfig): InviteCrypto {
  const saltBytes = new TextEncoder().encode(config.salt);
  const deriveTokenKey = createDeriveTokenKey(saltBytes);
  const formatVersion = config.formatVersion ?? DEFAULT_FORMAT_VERSION;
  const compressionMarker =
    config.compressionMarker ?? DEFAULT_COMPRESSION_MARKER;
  const compressionThresholdBytes =
    config.compressionThresholdBytes ?? DEFAULT_COMPRESSION_THRESHOLD_BYTES;
  const maxDecompressedSize =
    config.maxDecompressedSize ?? DEFAULT_MAX_DECOMPRESSED_SIZE;

  return {
    encryptToken(
      plaintext: Uint8Array,
      inboxId: string,
      privateKeyBytes: Uint8Array,
    ): Uint8Array {
      const key = deriveTokenKey(privateKeyBytes, inboxId);
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const aad = new TextEncoder().encode(inboxId);
      const cipher = chacha20poly1305(key, nonce, aad);
      const ciphertext = cipher.encrypt(plaintext);

      const token = new Uint8Array(1 + nonce.length + ciphertext.length);
      token[0] = formatVersion;
      token.set(nonce, 1);
      token.set(ciphertext, 1 + nonce.length);
      return token;
    },

    decryptToken(
      tokenBytes: Uint8Array,
      inboxId: string,
      privateKeyBytes: Uint8Array,
    ): Uint8Array {
      if (tokenBytes[0] !== formatVersion) {
        throw new Error(`Unsupported token version: ${tokenBytes[0]}`);
      }

      const nonce = tokenBytes.slice(1, 13);
      const ciphertextWithTag = tokenBytes.slice(13);
      const key = deriveTokenKey(privateKeyBytes, inboxId);
      const aad = new TextEncoder().encode(inboxId);
      const cipher = chacha20poly1305(key, nonce, aad);
      return cipher.decrypt(ciphertextWithTag);
    },

    sign(payloadBytes: Uint8Array, privateKeyBytes: Uint8Array): Uint8Array {
      const sig = secp256k1.sign(sha256(payloadBytes), privateKeyBytes);
      const compact = sig.toCompactRawBytes();
      const result = new Uint8Array(65);
      result.set(compact, 0);
      result[64] = sig.recovery;
      return result;
    },

    recoverPublicKey(
      payloadBytes: Uint8Array,
      signatureBytes: Uint8Array,
    ): Uint8Array {
      if (signatureBytes.length !== 65) {
        throw new Error(
          `Invalid signature length: expected 65 bytes, got ${signatureBytes.length}`,
        );
      }

      const compactSig = signatureBytes.slice(0, 64);
      const recoveryBit = signatureBytes[64];

      if (recoveryBit === undefined || recoveryBit > 3) {
        throw new Error(`Invalid recovery bit: ${recoveryBit}`);
      }

      const sig =
        secp256k1.Signature.fromCompact(compactSig).addRecoveryBit(recoveryBit);
      return sig.recoverPublicKey(sha256(payloadBytes)).toRawBytes(false);
    },

    compress(data: Uint8Array): Uint8Array {
      if (data.length <= compressionThresholdBytes) {
        return data;
      }

      const compressed = deflateSync(data);
      if (compressed.length + 5 < data.length) {
        const result = new Uint8Array(compressed.length + 5);
        result[0] = compressionMarker;
        result[1] = (data.length >>> 24) & 0xff;
        result[2] = (data.length >>> 16) & 0xff;
        result[3] = (data.length >>> 8) & 0xff;
        result[4] = data.length & 0xff;
        result.set(new Uint8Array(compressed), 5);
        return result;
      }

      return data;
    },

    decompress(
      data: Uint8Array,
      options?: { readonly errorField?: string },
    ): Result<Uint8Array, SignetError> {
      if (data.length === 0 || data[0] !== compressionMarker) {
        return BetterResult.ok(data);
      }

      const decompressed = inflateSync(data.slice(5));
      if (decompressed.length > maxDecompressedSize) {
        return BetterResult.err(
          ValidationError.create(
            options?.errorField ?? "inviteData",
            `Decompressed size exceeds maximum: ${decompressed.length}`,
          ),
        );
      }

      return BetterResult.ok(new Uint8Array(decompressed));
    },
  };
}
