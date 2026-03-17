import { Result } from "better-result";
import { type ViewConfig, PermissionError } from "@xmtp/signet-schemas";

/**
 * Checks that the request's groupId appears in at least one of the
 * view's threadScopes. An agent cannot act on groups it cannot see.
 */
export function checkGroupInScope(
  groupId: string,
  view: ViewConfig,
): Result<void, PermissionError> {
  const inScope = view.threadScopes.some((scope) => scope.groupId === groupId);
  if (!inScope) {
    return Result.err(
      PermissionError.create(
        `Group '${groupId}' is not in the agent's view scopes`,
        { groupId },
      ),
    );
  }
  return Result.ok();
}
