/**
 * Projects outbound SignetEvents through the session's view pipeline
 * before they reach the harness. Non-message events pass through;
 * message.visible events are filtered by scope, content type, and
 * visibility mode via the policy engine's projectMessage.
 */

import type { SignetEvent, ContentTypeId } from "@xmtp/signet-schemas";
import type { SessionRecord, RevealStateStore } from "@xmtp/signet-contracts";
import { projectMessage } from "@xmtp/signet-policy";
import type { RawMessage, ProjectionResult } from "@xmtp/signet-policy";

export interface EventProjectorDeps {
  readonly getRevealState: (sessionId: string) => RevealStateStore | null;
}

/** Always create a fresh allowlist — no caching, so view updates take effect immediately. */
function getEffectiveAllowlist(
  session: SessionRecord,
): ReadonlySet<ContentTypeId> {
  return new Set(session.view.contentTypes);
}

/**
 * Creates a projector function that filters events based on the
 * session's view mode. Returns null to signal the event should be
 * dropped (not sent to this harness connection).
 *
 * ALL view modes (full, thread-only, redacted, reveal-only) go through
 * projectMessage so scope and content-type filters are always enforced.
 */
export function createEventProjector(
  deps: EventProjectorDeps,
): (event: SignetEvent, session: SessionRecord) => SignetEvent | null {
  return (event: SignetEvent, session: SessionRecord): SignetEvent | null => {
    // Only message.visible events go through the projection pipeline
    if (event.type !== "message.visible") {
      return event;
    }

    // Extract threadId from event payload if present
    const threadId: string | null =
      "threadId" in event && typeof event.threadId === "string"
        ? event.threadId
        : null;

    const store = deps.getRevealState(session.sessionId);
    const isRevealed =
      store !== null
        ? store.isRevealed(
            event.messageId,
            event.groupId,
            threadId,
            event.senderInboxId,
            event.contentType,
          )
        : false;

    const rawMessage: RawMessage = {
      messageId: event.messageId,
      groupId: event.groupId,
      senderInboxId: event.senderInboxId,
      contentType: event.contentType,
      content: event.content,
      sentAt: event.sentAt,
      sealId: event.sealId,
      threadId,
    };

    const effectiveAllowlist = getEffectiveAllowlist(session);
    const result: ProjectionResult = projectMessage(
      rawMessage,
      session.view,
      effectiveAllowlist,
      isRevealed,
    );

    if (result.action === "drop") {
      return null;
    }

    return result.event;
  };
}
