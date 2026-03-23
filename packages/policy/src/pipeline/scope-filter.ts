/**
 * Stage 1: Scope filter. Returns true if the message's groupId
 * is in the credential's scoped chat IDs.
 *
 * Thread-level scoping is removed in v1 -- scoping is per-chat
 * via credentials.
 */
export function isInScope(
  message: { groupId: string },
  chatIds: readonly string[],
): boolean {
  return chatIds.includes(message.groupId);
}
