import { Result } from "better-result";
import { PermissionError } from "@xmtp/signet-schemas";
import { checkChatInScope } from "./scope-check.js";

/** Successful send validation. */
export interface SendValidation {
  readonly draftOnly: boolean;
}

/**
 * Validates a send_message request against the resolved scope set.
 *
 * Checks that the chat is in scope and that the "send" permission
 * scope is present.
 */
export function validateSendMessage(
  request: { groupId: string },
  scopes: ReadonlySet<string>,
  chatIds: readonly string[],
): Result<SendValidation, PermissionError> {
  const scopeResult = checkChatInScope(request.groupId, chatIds);
  if (scopeResult.isErr()) return Result.err(scopeResult.error);

  if (!scopes.has("send")) {
    return Result.err(
      PermissionError.create("Permission denied: send", { scope: "send" }),
    );
  }
  return Result.ok({ draftOnly: false });
}

/**
 * Validates a send_reply request against the resolved scope set.
 *
 * Checks that the chat is in scope and that the "reply" permission
 * scope is present.
 */
export function validateSendReply(
  request: { groupId: string },
  scopes: ReadonlySet<string>,
  chatIds: readonly string[],
): Result<void, PermissionError> {
  const scopeResult = checkChatInScope(request.groupId, chatIds);
  if (scopeResult.isErr()) return Result.err(scopeResult.error);

  if (!scopes.has("reply")) {
    return Result.err(
      PermissionError.create("Permission denied: reply", { scope: "reply" }),
    );
  }
  return Result.ok();
}
