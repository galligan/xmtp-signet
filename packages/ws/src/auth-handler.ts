import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import { AuthError } from "@xmtp/signet-schemas";
import type { CredentialRecord } from "@xmtp/signet-contracts";
import type { AuthFrame } from "./frames.js";

/**
 * Callback to look up a credential by bearer token.
 * Injected by the server -- the auth handler doesn't know about
 * the CredentialManager directly.
 */
export type TokenLookup = (
  token: string,
) => Promise<Result<CredentialRecord, SignetError>>;

/**
 * Validates an auth frame by looking up the token and checking
 * the credential is in an active state.
 */
export async function handleAuth(
  frame: AuthFrame,
  lookup: TokenLookup,
): Promise<Result<CredentialRecord, SignetError>> {
  const result = await lookup(frame.token);
  if (!result.isOk()) return result;

  const credential = result.value;
  if (credential.status !== "active") {
    return Result.err(
      AuthError.create(`Credential ${credential.credentialId} is not active`, {
        credentialId: credential.credentialId,
        status: credential.status,
      }),
    );
  }

  return Result.ok(credential);
}
