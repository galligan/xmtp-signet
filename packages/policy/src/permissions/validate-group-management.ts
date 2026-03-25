import { Result } from "better-result";
import { PermissionError } from "@xmtp/signet-schemas";
import { checkChatInScope } from "./scope-check.js";

/**
 * Validates a group management action against the resolved scope set.
 *
 * The scope parameter should be the v1 permission scope name (e.g.,
 * "add-member", "remove-member", "update-name", "invite").
 */
export function validateGroupManagement(
  scope: string,
  request: { groupId: string },
  scopes: ReadonlySet<string>,
  chatIds: readonly string[],
): Result<void, PermissionError> {
  const scopeResult = checkChatInScope(request.groupId, chatIds);
  if (scopeResult.isErr()) return Result.err(scopeResult.error);

  if (!scopes.has(scope)) {
    return Result.err(
      PermissionError.create(`Permission denied: ${scope}`, { scope }),
    );
  }
  return Result.ok();
}
