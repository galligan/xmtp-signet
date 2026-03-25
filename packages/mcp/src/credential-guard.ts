import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import { AuthError } from "@xmtp/signet-schemas";
import type { CredentialRecord } from "@xmtp/signet-contracts";

/**
 * Resolve a bearer token to a runtime-enriched CredentialRecord.
 * Injected by the composition root.
 */
export type TokenLookup = (
  token: string,
) => Promise<Result<CredentialRecord, SignetError>>;

/**
 * Resolve a credential ID to a runtime-enriched CredentialRecord.
 * Injected by the composition root.
 */
export type CredentialLookup = (
  credentialId: string,
) => Promise<Result<CredentialRecord, SignetError>>;

/**
 * Validate a credential token at startup. Resolves the token to a
 * CredentialRecord via the injected token lookup.
 */
export async function validateCredential(
  token: string,
  tokenLookup: TokenLookup,
): Promise<Result<CredentialRecord, AuthError>> {
  const lookupResult = await tokenLookup(token);
  if (!lookupResult.isOk()) {
    return Result.err(AuthError.create("Invalid credential token"));
  }
  return Result.ok(lookupResult.value);
}

/**
 * Check credential liveness on each tool call.
 * Verifies the credential has not expired or been revoked by
 * re-fetching the record via the credential lookup.
 */
export async function checkCredentialLiveness(
  credential: CredentialRecord,
  credentialLookup: CredentialLookup,
): Promise<Result<void, AuthError>> {
  // Re-fetch to check current status and expiry. This ensures renewals that
  // extend expiresAt on an existing credential ID are respected immediately.
  const lookupResult = await credentialLookup(credential.credentialId);
  if (!lookupResult.isOk()) {
    return Result.err(
      AuthError.create("Credential check failed", {
        credentialId: credential.credentialId,
      }),
    );
  }

  if (lookupResult.value.status !== "active") {
    return Result.err(
      AuthError.create(`Credential is ${lookupResult.value.status}`, {
        credentialId: credential.credentialId,
      }),
    );
  }

  const expiresAt = new Date(lookupResult.value.expiresAt).getTime();
  if (Date.now() >= expiresAt) {
    return Result.err(
      AuthError.create("Credential expired", {
        credentialId: credential.credentialId,
      }),
    );
  }

  return Result.ok(undefined);
}
