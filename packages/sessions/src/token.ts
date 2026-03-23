/**
 * Cryptographic token and credential ID generation.
 *
 * Tokens are 32 random bytes, base64url-encoded (no padding) = 43 chars.
 * Credential IDs use `createResourceId("credential")` from schemas.
 */

import { createResourceId } from "@xmtp/signet-schemas";

/** Generate a cryptographically random bearer token. */
export function generateToken(byteLength: number = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** Generate a unique credential ID with "cred_" prefix. */
export function generateCredentialId(): string {
  return createResourceId("credential");
}

/** Encode bytes as base64url without padding. */
function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
