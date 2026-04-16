import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import type { CoreRawEvent, RawMessageEvent } from "../raw-events.js";
import {
  processJoinRequest,
  type ProcessJoinRequestDeps,
  type IncomingJoinMessage,
  type JoinRequestResult,
} from "./process-join-requests.js";
import { extractJoinRequestContent } from "./join-request-content.js";

/** Dependencies for the invite host listener. */
export interface InviteHostDeps {
  /** The secp256k1 private key (hex, no 0x prefix) for the host identity. */
  readonly walletPrivateKeyHex: string;
  /** The host's inbox ID. */
  readonly creatorInboxId: string;
  /** Add members to a group. */
  readonly addMembersToGroup: (
    groupId: string,
    inboxIds: readonly string[],
  ) => Promise<Result<void, SignetError>>;
  /** Look up the stored invite tag for a group. */
  readonly getGroupInviteTag: (
    groupId: string,
  ) => Promise<Result<string | undefined, SignetError>>;
}

/**
 * Try to process a raw message event as an invite join request.
 *
 * Returns the join result if the message was a valid invite URL,
 * or `null` if the message is not a join request (so the caller
 * can ignore it).
 */
export async function tryProcessJoinRequest(
  deps: InviteHostDeps,
  event: RawMessageEvent,
): Promise<Result<JoinRequestResult, SignetError> | null> {
  const joinRequest = extractJoinRequestContent(event.content);
  const text =
    typeof event.content === "string" ? event.content.trim() : undefined;
  const looksLikeSlug =
    text !== undefined && text.length >= 50 && !text.includes(" ");
  if (!joinRequest && !looksLikeSlug) return null;

  const message: IncomingJoinMessage = {
    senderInboxId: event.senderInboxId,
    content: joinRequest ?? text ?? event.content,
  };

  return processJoinRequest(
    {
      walletPrivateKeyHex: deps.walletPrivateKeyHex,
      creatorInboxId: deps.creatorInboxId,
      addMembersToGroup: deps.addMembersToGroup,
      getGroupInviteTag: deps.getGroupInviteTag,
    } satisfies ProcessJoinRequestDeps,
    message,
  );
}

/**
 * Subscribe to raw events and process any that look like invite join
 * requests. Returns an unsubscribe function.
 *
 * Historical messages are skipped. Processing is fire-and-forget so
 * the event stream is never blocked.
 */
export function startInviteHostListener(
  subscribe: (handler: (event: CoreRawEvent) => void) => () => void,
  deps: InviteHostDeps,
): () => void {
  return subscribe((event) => {
    if (event.type !== "raw.message") return;
    if (event.isHistorical) return;

    // Fire and forget — most messages are not join requests
    void tryProcessJoinRequest(deps, event).catch(() => {
      // Silently ignore processing errors
    });
  });
}
