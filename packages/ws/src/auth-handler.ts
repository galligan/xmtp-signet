import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import { AuthError } from "@xmtp/signet-schemas";
import type { SessionRecord } from "@xmtp/signet-contracts";
import type { AuthFrame } from "./frames.js";

/**
 * Callback to look up a session by bearer token.
 * Injected by the server -- the auth handler doesn't know about
 * the SessionManager directly.
 */
export type TokenLookup = (
  token: string,
) => Promise<Result<SessionRecord, SignetError>>;

/**
 * Validates an auth frame by looking up the token and checking
 * the session is in an active state.
 */
export async function handleAuth(
  frame: AuthFrame,
  lookup: TokenLookup,
): Promise<Result<SessionRecord, SignetError>> {
  const result = await lookup(frame.token);
  if (!result.isOk()) return result;

  const session = result.value;
  if (session.state !== "active") {
    return Result.err(
      AuthError.create(`Session ${session.sessionId} is not active`, {
        sessionId: session.sessionId,
        state: session.state,
      }),
    );
  }

  return Result.ok(session);
}
