import type { ContentTypeId } from "@xmtp/signet-schemas";

/**
 * Stage 2: Content type filter. Returns true if the message's content
 * type is in the effective allowlist.
 *
 * Unknown content types are dropped silently (default-deny).
 */
export function isContentTypeAllowed(
  contentType: ContentTypeId,
  allowlist: ReadonlySet<ContentTypeId>,
): boolean {
  return allowlist.has(contentType);
}
