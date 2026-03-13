import type { ThreadScope } from "@xmtp-broker/schemas";

/**
 * Stage 1: Scope filter. Returns true if the message falls within
 * any of the view's thread scopes.
 *
 * A scope with `threadId: null` matches all threads in that group.
 * A scope with a specific `threadId` matches only that thread.
 */
export function isInScope(
  message: Pick<
    { groupId: string; threadId: string | null },
    "groupId" | "threadId"
  >,
  scopes: readonly ThreadScope[],
): boolean {
  return scopes.some((scope) => {
    if (scope.groupId !== message.groupId) {
      return false;
    }
    // null threadId in scope matches all threads in the group
    if (scope.threadId === null) {
      return true;
    }
    return scope.threadId === message.threadId;
  });
}
