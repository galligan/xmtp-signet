import { Result } from "better-result";
import { AuthError } from "@xmtp/signet-schemas";
import type { SessionManager, SessionRecord } from "@xmtp/signet-contracts";

/**
 * Validate a session token at startup. Resolves the token to a
 * SessionRecord via the session manager's lookupByToken method.
 */
export async function validateSession(
  token: string,
  sessionManager: SessionManager,
): Promise<Result<SessionRecord, AuthError>> {
  const lookupResult = await sessionManager.lookupByToken(token);
  if (!lookupResult.isOk()) {
    return Result.err(AuthError.create("Invalid session token"));
  }
  return Result.ok(lookupResult.value);
}

/**
 * Check session liveness on each tool call.
 * Verifies the session has not expired or been revoked.
 */
export async function checkSessionLiveness(
  session: SessionRecord,
  sessionManager: SessionManager,
): Promise<Result<void, AuthError>> {
  // Expiry check
  const expiresAt = new Date(session.expiresAt).getTime();
  if (Date.now() >= expiresAt) {
    return Result.err(
      AuthError.create("Session expired", { sessionId: session.sessionId }),
    );
  }

  // Revocation check via isActive
  const activeResult = await sessionManager.isActive(session.sessionId);
  if (!activeResult.isOk()) {
    return Result.err(
      AuthError.create("Session check failed", {
        sessionId: session.sessionId,
      }),
    );
  }

  if (!activeResult.value) {
    return Result.err(
      AuthError.create("Session revoked", {
        sessionId: session.sessionId,
      }),
    );
  }

  return Result.ok(undefined);
}
