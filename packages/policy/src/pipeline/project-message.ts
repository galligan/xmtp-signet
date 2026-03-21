import type {
  ContentTypeId,
  MessageEvent,
  ViewConfig,
} from "@xmtp/signet-schemas";
import type { RawMessage, ProjectionResult } from "../types.js";
import { isInScope } from "./scope-filter.js";
import { isContentTypeAllowed } from "./content-type-filter.js";
import { resolveVisibility } from "./visibility-resolver.js";
import { projectContent } from "./content-projector.js";

const DROP: ProjectionResult = { action: "drop" } as const;

/**
 * Projects a raw message through the view filter, content type filter,
 * visibility logic, and content projection to produce a derived event or drop.
 *
 * Pure function. No side effects.
 *
 * @param message - The raw XMTP message, already decoded
 * @param view - The active view configuration
 * @param effectiveAllowlist - Pre-computed content type allowlist
 * @param isRevealed - Whether this message has an active reveal grant
 */
export function projectMessage(
  message: RawMessage,
  view: ViewConfig,
  effectiveAllowlist: ReadonlySet<ContentTypeId>,
  isRevealed: boolean,
): ProjectionResult {
  // Stage 1: Scope filter
  if (!isInScope(message, view.threadScopes)) {
    return DROP;
  }

  // Stage 2: Content type filter
  if (!isContentTypeAllowed(message.contentType, effectiveAllowlist)) {
    return DROP;
  }

  // Stage 3: Visibility resolver
  const baseVisibility = resolveVisibility(view.mode, isRevealed);
  if (baseVisibility === "hidden") {
    return DROP;
  }

  // Stage 3b: Historical override — non-hidden messages during recovery
  // are tagged as historical so the harness can treat them as context,
  // not action triggers.
  const visibility =
    message.isHistorical === true &&
    baseVisibility !== "redacted" &&
    baseVisibility !== "revealed"
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
