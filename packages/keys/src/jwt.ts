import { z } from "zod";
import { Result } from "better-result";
import {
  AuthError,
  ValidationError,
  InternalError,
} from "@xmtp/signet-schemas";

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

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Admin JWT configuration (parsed output). */
export type AdminJwtConfig = {
  defaultTtlSeconds: number;
  maxTtlSeconds: number;
  clockSkewSeconds: number;
};

/** Admin JWT configuration (input, fields with defaults are optional). */
type AdminJwtConfigInput = {
  defaultTtlSeconds?: number | undefined;
  maxTtlSeconds?: number | undefined;
  clockSkewSeconds?: number | undefined;
};

/** Admin JWT configuration schema with defaults. */
export const AdminJwtConfigSchema: z.ZodType<
  AdminJwtConfig,
  z.ZodTypeDef,
  AdminJwtConfigInput
> = z
  .object({
    defaultTtlSeconds: z
      .number()
      .int()
      .positive()
      .default(120)
      .describe("Default JWT TTL in seconds (2 minutes)"),
    maxTtlSeconds: z
      .number()
      .int()
      .positive()
      .default(3600)
      .describe("Maximum JWT TTL in seconds (1 hour)"),
    clockSkewSeconds: z
      .number()
      .int()
      .nonnegative()
      .default(30)
      .describe("Allowed clock skew for JWT verification"),
  })
  .describe("Admin JWT configuration");

/** Admin JWT payload. */
export interface AdminJwtPayload {
  readonly iss: string;
  readonly sub: "admin";
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
}

/** Admin JWT payload schema. */
export const AdminJwtPayloadSchema: z.ZodType<
  AdminJwtPayload,
  z.ZodTypeDef,
  AdminJwtPayload
> = z
  .object({
    iss: z.string().describe("Admin key fingerprint"),
    sub: z.literal("admin").describe("Subject claim"),
    iat: z.number().int().positive().describe("Issued-at timestamp"),
    exp: z.number().int().positive().describe("Expiration timestamp"),
    jti: z.string().describe("JWT ID (random nonce, hex-encoded, 16 bytes)"),
  })
  .describe("Admin JWT payload claims");

/** JWT header for EdDSA. */
interface JwtHeader {
  readonly alg: string;
  readonly typ: string;
}

/** Decoded JWT parts (header + payload, no signature). */
export interface DecodedJwt {
  readonly header: JwtHeader;
  readonly payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Base64url
// ---------------------------------------------------------------------------

/** Encode bytes to base64url (no padding). */
export function base64urlEncode(data: Uint8Array): string {
  if (data.length === 0) return "";
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Decode base64url string to bytes. */
export function base64urlDecode(str: string): Uint8Array {
  if (str === "") return new Uint8Array(0);
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// ---------------------------------------------------------------------------
// JWT encode / decode
// ---------------------------------------------------------------------------

/** Encode JWT header and payload into `base64url(header).base64url(payload)`. */
export function encodeJwt(header: object, payload: object): string {
  const headerB64 = base64urlEncode(
    new TextEncoder().encode(JSON.stringify(header)),
  );
  const payloadB64 = base64urlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return `${headerB64}.${payloadB64}`;
}

/**
 * Decode a two-part JWT string (header.payload) without verification.
 * Used internally before signature check.
 */
export function decodeJwt(
  headerPayload: string,
): Result<DecodedJwt, ValidationError> {
  const parts = headerPayload.split(".");
  if (parts.length !== 2) {
    return Result.err(
      ValidationError.create("jwt", "Expected 2 parts (header.payload)"),
    );
  }

  try {
    const headerPart = parts[0];
    const payloadPart = parts[1];
    if (headerPart === undefined || payloadPart === undefined) {
      return Result.err(
        ValidationError.create("jwt", "Missing header or payload"),
      );
    }
    const header = JSON.parse(
      new TextDecoder().decode(base64urlDecode(headerPart)),
    ) as JwtHeader;
    const payload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(payloadPart)),
    ) as Record<string, unknown>;
    return Result.ok({ header, payload });
  } catch {
    return Result.err(
      ValidationError.create("jwt", "Invalid base64url encoding"),
    );
  }
}

// ---------------------------------------------------------------------------
// JWT sign / verify
// ---------------------------------------------------------------------------

/**
 * Sign a JWT payload with an Ed25519 private CryptoKey.
 * Returns the compact three-part JWT string.
 */
export async function signJwt(
  privateKey: CryptoKey,
  payload: AdminJwtPayload,
): Promise<Result<string, InternalError>> {
  try {
    const header = { alg: "EdDSA", typ: "JWT" };
    const headerPayload = encodeJwt(header, payload);
    const data = new TextEncoder().encode(headerPayload);

    const signature = await crypto.subtle.sign(
      "Ed25519",
      privateKey,
      asBuffer(data),
    );

    const sigB64 = base64urlEncode(new Uint8Array(signature));
    return Result.ok(`${headerPayload}.${sigB64}`);
  } catch (e) {
    return Result.err(
      InternalError.create("Failed to sign JWT", {
        cause: String(e),
      }),
    );
  }
}

/** Options for JWT verification. */
export interface VerifyJwtOptions {
  /** Clock skew tolerance in seconds. Default: 30. */
  readonly clockSkewSeconds?: number;
}

/**
 * Verify a compact JWT string against an Ed25519 public key (raw bytes).
 * Checks signature, expiration, and payload schema.
 */
export async function verifyJwt(
  token: string,
  publicKeyBytes: Uint8Array,
  options?: VerifyJwtOptions,
): Promise<Result<AdminJwtPayload, AuthError | ValidationError>> {
  const clockSkew = options?.clockSkewSeconds ?? 30;

  // Split into 3 parts
  const parts = token.split(".");
  if (parts.length !== 3) {
    return Result.err(
      ValidationError.create("jwt", "Malformed JWT: expected 3 parts"),
    );
  }

  const headerPart = parts[0];
  const payloadPart = parts[1];
  const sigPart = parts[2];
  if (
    headerPart === undefined ||
    payloadPart === undefined ||
    sigPart === undefined
  ) {
    return Result.err(
      ValidationError.create("jwt", "Malformed JWT: missing parts"),
    );
  }

  // Decode header
  const headerPayload = `${headerPart}.${payloadPart}`;
  const decoded = decodeJwt(headerPayload);
  if (Result.isError(decoded)) return decoded;

  // Verify header alg
  if (decoded.value.header.alg !== "EdDSA") {
    return Result.err(
      ValidationError.create(
        "jwt.header.alg",
        `Expected EdDSA, got ${decoded.value.header.alg}`,
      ),
    );
  }

  // Parse payload with schema
  const payloadResult = AdminJwtPayloadSchema.safeParse(decoded.value.payload);
  if (!payloadResult.success) {
    return Result.err(
      ValidationError.create("jwt.payload", "Invalid JWT payload schema"),
    );
  }
  const payload = payloadResult.data;

  // Import public key for verification
  let publicKey: CryptoKey;
  try {
    publicKey = await crypto.subtle.importKey(
      "raw",
      asBuffer(publicKeyBytes),
      "Ed25519",
      false,
      ["verify"],
    );
  } catch {
    return Result.err(AuthError.create("Failed to import admin public key"));
  }

  // Verify signature
  let sigBytes: Uint8Array;
  try {
    sigBytes = base64urlDecode(sigPart);
  } catch {
    return Result.err(
      ValidationError.create("jwt.signature", "Invalid base64url signature"),
    );
  }
  const data = new TextEncoder().encode(headerPayload);
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      asBuffer(sigBytes),
      asBuffer(data),
    );
  } catch {
    return Result.err(AuthError.create("Invalid admin token signature"));
  }

  if (!valid) {
    return Result.err(AuthError.create("Invalid admin token signature"));
  }

  // Check expiration with clock skew tolerance
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now - clockSkew) {
    return Result.err(AuthError.create("Admin token expired"));
  }

  // Check iat is not in the future (beyond clock skew)
  if (payload.iat > now + clockSkew) {
    return Result.err(
      ValidationError.create("jwt.iat", "Token issued in future"),
    );
  }

  return Result.ok(payload);
}
