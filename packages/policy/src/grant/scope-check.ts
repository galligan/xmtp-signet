import { Result } from "better-result";
import { PermissionError } from "@xmtp/signet-schemas";

/**
 * Checks that the chat is in the credential's scoped conversations.
 *
 * Returns a PermissionError if the chatId is not found in the
 * allowed chatIds list.
 */
export function checkChatInScope(
  chatId: string,
  chatIds: readonly string[],
): Result<void, PermissionError> {
  if (!chatIds.includes(chatId)) {
    return Result.err(
      PermissionError.create(
        `Chat '${chatId}' is not in the credential's scoped conversations`,
        { chatId },
      ),
    );
  }
  return Result.ok();
}
