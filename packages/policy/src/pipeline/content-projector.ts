import type { ContentTypeId, MessageVisibility } from "@xmtp-broker/schemas";

/**
 * Stage 4: Content projector. Applies redaction based on resolved visibility.
 *
 * - visible / historical / revealed: content passes through unchanged
 * - redacted: content replaced with null (metadata preserved by caller)
 * - hidden: unreachable in normal flow (dropped in stage 3), returns null defensively
 */
export function projectContent(
  content: unknown,
  _contentType: ContentTypeId,
  visibility: MessageVisibility,
): unknown {
  switch (visibility) {
    case "visible":
    case "historical":
    case "revealed":
      return content;
    case "redacted":
    case "hidden":
      return null;
  }
}
