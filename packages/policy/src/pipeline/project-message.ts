import type { ContentTypeId, MessageEvent } from "@xmtp/signet-schemas";
import type { RawMessage, ProjectionResult } from "../types.js";
import { isInScope } from "./scope-filter.js";
import { isContentTypeAllowed } from "./content-type-filter.js";
import { resolveVisibility } from "./visibility-resolver.js";
import { projectContent } from "./content-projector.js";

const DROP: ProjectionResult = { action: "drop" } as const;

/**
 * Projects a raw message through the scope filter, content type filter,
 * visibility logic, and content projection to produce a derived event or drop.
 *
 * Pure function. No side effects.
 *
 * @param message - The raw XMTP message, already decoded
 * @param scopes - The resolved permission scope set for the credential
 * @param chatIds - The credential's scoped conversation IDs
 * @param effectiveAllowlist - Pre-computed content type allowlist
 * @param isRevealed - Whether this message has active reveal access
 */
export function projectMessage(
  message: RawMessage,
  scopes: ReadonlySet<string>,
  chatIds: readonly string[],
  effectiveAllowlist: ReadonlySet<ContentTypeId>,
  isRevealed: boolean,
): ProjectionResult {
  // Stage 1: Scope filter
  if (!isInScope(message, chatIds)) {
    return DROP;
  }

  // Stage 2: Content type filter
  if (!isContentTypeAllowed(message.contentType, effectiveAllowlist)) {
    return DROP;
  }

  // Stage 3: Visibility resolver
  const baseVisibility = resolveVisibility(scopes, isRevealed);
  if (baseVisibility === "hidden") {
    return DROP;
  }

  // Stage 3b: Historical override -- require read-history scope
  if (message.isHistorical === true && !scopes.has("read-history")) {
    return DROP;
  }

  const visibility =
    message.isHistorical === true && baseVisibility === "visible"
      ? ("historical" as const)
      : baseVisibility;

  // Stage 4: Content projector
  const content = projectContent(
    message.content,
    message.contentType,
    visibility,
  );

  const event: MessageEvent = {
    type: "message.visible",
    messageId: message.messageId,
    groupId: message.groupId,
    senderInboxId: message.senderInboxId,
    contentType: message.contentType,
    content,
    visibility,
    sentAt: message.sentAt,
    sealId: message.sealId,
    threadId: message.threadId,
  };

  return { action: "emit", event };
}
