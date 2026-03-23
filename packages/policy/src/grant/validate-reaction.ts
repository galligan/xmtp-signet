import { Result } from "better-result";
import { PermissionError } from "@xmtp/signet-schemas";
import { checkChatInScope } from "./scope-check.js";

/**
 * Validates a send_reaction request against the resolved scope set.
 *
 * Checks that the chat is in scope and that the "react" permission
 * scope is present.
 */
export function validateSendReaction(
  request: { groupId: string },
  scopes: ReadonlySet<string>,
  chatIds: readonly string[],
): Result<void, PermissionError> {
  const scopeResult = checkChatInScope(request.groupId, chatIds);
  if (scopeResult.isErr()) return Result.err(scopeResult.error);

  if (!scopes.has("react")) {
    return Result.err(
      PermissionError.create("Permission denied: react", { scope: "react" }),
    );
  }
  return Result.ok();
}
