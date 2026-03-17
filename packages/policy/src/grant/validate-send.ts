import { Result } from "better-result";
import {
  type ContentTypeId,
  type GrantConfig,
  type ViewConfig,
  GrantDeniedError,
} from "@xmtp/signet-schemas";
import type { GrantError } from "@xmtp/signet-contracts";
import { checkGroupInScope } from "./scope-check.js";

/**
 * Validates a send_message request against the active grant.
 */
export function validateSendMessage(
  request: { groupId: string; contentType: ContentTypeId },
  grant: GrantConfig,
  view: ViewConfig,
): Result<{ draftOnly: boolean }, GrantError> {
  const scopeResult = checkGroupInScope(request.groupId, view);
  if (scopeResult.isErr()) {
    return Result.err(scopeResult.error);
  }

  if (!grant.messaging.send) {
    return Result.err(
      GrantDeniedError.create("send_message", "messaging.send"),
    );
  }

  return Result.ok({ draftOnly: grant.messaging.draftOnly });
}

/**
 * Validates a send_reply request against the active grant.
 */
export function validateSendReply(
  request: { groupId: string; messageId: string; contentType: ContentTypeId },
  grant: GrantConfig,
  view: ViewConfig,
): Result<{ draftOnly: boolean }, GrantError> {
  const scopeResult = checkGroupInScope(request.groupId, view);
  if (scopeResult.isErr()) {
    return Result.err(scopeResult.error);
  }

  if (!grant.messaging.reply) {
    return Result.err(GrantDeniedError.create("send_reply", "messaging.reply"));
  }

  return Result.ok({ draftOnly: grant.messaging.draftOnly });
}
