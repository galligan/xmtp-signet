/**
 * Projects outbound SignetEvents through the credential's scope pipeline
 * before they reach the harness. Non-message events pass through;
 * message.visible events are filtered by scope, content type, and
 * visibility mode via the policy engine's projectMessage.
 */

import { resolveScopeSet } from "@xmtp/signet-schemas";
import type { SignetEvent, ContentTypeId } from "@xmtp/signet-schemas";
import type {
  CredentialRecord,
  RevealStateStore,
} from "@xmtp/signet-contracts";
import { projectMessage } from "@xmtp/signet-policy";
import type { RawMessage, ProjectionResult } from "@xmtp/signet-policy";

/** Dependencies used to rehydrate reveal state during WS projection. */
export interface EventProjectorDeps {
  readonly getRevealState: (credentialId: string) => RevealStateStore | null;
  /** Resolve the scoped chat IDs for a credential. */
  readonly getChatIds?: (credentialId: string) => readonly string[];
}

/**
 * Creates a projector function that filters events based on the
 * credential's scopes. Returns null to signal the event should be
 * dropped (not sent to this harness connection).
 *
 * All events go through projectMessage so scope and content-type
 * filters are always enforced.
 */
export function createEventProjector(
  deps: EventProjectorDeps,
): (event: SignetEvent, credential: CredentialRecord) => SignetEvent | null {
  return (
    event: SignetEvent,
    credential: CredentialRecord,
  ): SignetEvent | null => {
    // Only message.visible events go through the projection pipeline
    if (event.type !== "message.visible") {
      return event;
    }

    // Extract threadId from event payload if present
    const threadId: string | null =
      "threadId" in event && typeof event.threadId === "string"
        ? event.threadId
        : null;

    const store = deps.getRevealState(credential.credentialId);
    const isRevealed =
      store !== null
        ? store.isRevealed(
            event.messageId,
            event.groupId,
            threadId,
            event.senderInboxId,
            event.contentType,
            event.sentAt,
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
      isHistorical: event.visibility === "historical",
    };

    const scopes = resolveScopeSet(credential.effectiveScopes);
    // Default to the credential's persisted chat scope, then let an injected
    // resolver override it when a narrower runtime scope is available.
    const resolvedChatIds =
      deps.getChatIds?.(credential.credentialId) ?? credential.config.chatIds;
    const chatIds =
      resolvedChatIds.length > 0
        ? resolvedChatIds
        : credential.config.chatIds;
    // In v1, content types are not restricted at the credential level.
    // Include the message's own type to pass the content-type filter.
    const effectiveAllowlist = new Set<ContentTypeId>([rawMessage.contentType]);

    const result: ProjectionResult = projectMessage(
      rawMessage,
      scopes,
      chatIds,
      effectiveAllowlist,
      isRevealed,
    );

    if (result.action === "drop") {
      return null;
    }

    return result.event;
  };
}
