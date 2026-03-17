import { Result } from "better-result";
import {
  type GrantConfig,
  type ViewConfig,
  GrantDeniedError,
} from "@xmtp/signet-schemas";
import type { GrantError } from "@xmtp/signet-contracts";
import { checkGroupInScope } from "./scope-check.js";

/**
 * Validates a send_reaction request against the active grant.
 */
export function validateSendReaction(
  request: { groupId: string; messageId: string },
  grant: GrantConfig,
  view: ViewConfig,
): Result<void, GrantError> {
  const scopeResult = checkGroupInScope(request.groupId, view);
  if (scopeResult.isErr()) {
    return Result.err(scopeResult.error);
  }

  if (!grant.messaging.react) {
    return Result.err(
      GrantDeniedError.create("send_reaction", "messaging.react"),
    );
  }

  return Result.ok();
}
