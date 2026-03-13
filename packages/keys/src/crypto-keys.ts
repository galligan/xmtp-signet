import { Result } from "better-result";
import { InternalError } from "@xmtp-broker/schemas";

/**
 * Helper to convert Uint8Array to a BufferSource compatible with
 * Bun's strict WebCrypto types.
 */
function asBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
}

/** Generate a P-256 ECDSA key pair. */
export async function generateP256KeyPair(): Promise<
  Result<CryptoKeyPair, InternalError>
> {
  try {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    return Result.ok(keyPair);
  } catch (e) {
    return Result.err(
      InternalError.create("Failed to generate P-256 key pair", {
        cause: String(e),
      }),
    );
  }
}

/** Generate an Ed25519 key pair. */
export async function generateEd25519KeyPair(): Promise<
  Result<CryptoKeyPair, InternalError>
> {
  try {
    const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ]);
    return Result.ok(keyPair);
  } catch (e) {
    return Result.err(
      InternalError.create("Failed to generate Ed25519 key pair", {
        cause: String(e),
      }),
    );
  }
}

/** Sign data with P-256 ECDSA (SHA-256). */
export async function signP256(
  privateKey: CryptoKey,
  data: Uint8Array,
): Promise<Result<Uint8Array, InternalError>> {
  try {
    const sig = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      asBuffer(data),
    );
    return Result.ok(new Uint8Array(sig));
  } catch (e) {
    return Result.err(
      InternalError.create("P-256 signing failed", { cause: String(e) }),
    );
  }
}

/** Verify a P-256 ECDSA signature. */
export async function verifyP256(
  publicKey: CryptoKey,
  data: Uint8Array,
  signature: Uint8Array,
): Promise<Result<boolean, InternalError>> {
  try {
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      asBuffer(signature),
      asBuffer(data),
    );
    return Result.ok(valid);
  } catch (e) {
    return Result.err(
      InternalError.create("P-256 verification failed", {
        cause: String(e),
      }),
    );
  }
}

/** Sign data with Ed25519. */
export async function signEd25519(
  privateKey: CryptoKey,
  data: Uint8Array,
): Promise<Result<Uint8Array, InternalError>> {
  try {
    const sig = await crypto.subtle.sign(
      { name: "Ed25519" },
      privateKey,
      asBuffer(data),
    );
    return Result.ok(new Uint8Array(sig));
  } catch (e) {
    return Result.err(
      InternalError.create("Ed25519 signing failed", { cause: String(e) }),
    );
  }
}

/** Verify an Ed25519 signature. */
export async function verifyEd25519(
  publicKey: CryptoKey,
  data: Uint8Array,
  signature: Uint8Array,
): Promise<Result<boolean, InternalError>> {
  try {
    const valid = await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      asBuffer(signature),
      asBuffer(data),
    );
    return Result.ok(valid);
  } catch (e) {
    return Result.err(
      InternalError.create("Ed25519 verification failed", {
        cause: String(e),
      }),
    );
  }
}

/** Export a public key as raw bytes. */
export async function exportPublicKey(
  key: CryptoKey,
): Promise<Result<Uint8Array, InternalError>> {
  try {
    const raw = await crypto.subtle.exportKey("raw", key);
    return Result.ok(new Uint8Array(raw));
  } catch (e) {
    return Result.err(
      InternalError.create("Failed to export public key", {
        cause: String(e),
      }),
    );
  }
}

/** Export a private key as PKCS8 bytes. */
export async function exportPrivateKey(
  key: CryptoKey,
): Promise<Result<Uint8Array, InternalError>> {
  try {
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", key);
    return Result.ok(new Uint8Array(pkcs8));
  } catch (e) {
    return Result.err(
      InternalError.create("Failed to export private key", {
        cause: String(e),
      }),
    );
  }
}

/** Import Ed25519 private key from PKCS8 bytes. */
export async function importEd25519PrivateKey(
  pkcs8: Uint8Array,
): Promise<Result<CryptoKey, InternalError>> {
  try {
    const key = await crypto.subtle.importKey(
      "pkcs8",
      asBuffer(pkcs8),
      { name: "Ed25519" },
      true,
      ["sign"],
    );
    return Result.ok(key);
  } catch (e) {
    return Result.err(
      InternalError.create("Failed to import Ed25519 private key", {
        cause: String(e),
      }),
    );
  }
}

/** Import P-256 ECDSA private key from PKCS8 bytes. */
export async function importP256PrivateKey(
  pkcs8: Uint8Array,
): Promise<Result<CryptoKey, InternalError>> {
  try {
    const key = await crypto.subtle.importKey(
      "pkcs8",
      asBuffer(pkcs8),
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign"],
    );
    return Result.ok(key);
  } catch (e) {
    return Result.err(
      InternalError.create("Failed to import P-256 private key", {
        cause: String(e),
      }),
    );
  }
}

/** Compute SHA-256 fingerprint of a public key (hex-encoded). */
export async function fingerprint(
  publicKey: CryptoKey,
): Promise<Result<string, InternalError>> {
  const exported = await exportPublicKey(publicKey);
  if (Result.isError(exported)) return exported;

  try {
    const hash = await crypto.subtle.digest(
      "SHA-256",
      asBuffer(exported.value),
    );
    const hex = Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return Result.ok(hex);
  } catch (e) {
    return Result.err(
      InternalError.create("Failed to compute fingerprint", {
        cause: String(e),
      }),
    );
  }
}

/** Convert bytes to hex string. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
