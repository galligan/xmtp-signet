import { Result } from "better-result";
import {
  type GrantConfig,
  type ViewConfig,
  GrantDeniedError,
} from "@xmtp/signet-schemas";
import type { GrantError } from "@xmtp/signet-contracts";
import { checkGroupInScope } from "./scope-check.js";

type GroupManagementAction =
  | "addMembers"
  | "removeMembers"
  | "updateMetadata"
  | "inviteUsers";

/**
 * Validates a group management action against the active grant.
 */
export function validateGroupManagement(
  action: GroupManagementAction,
  request: { groupId: string },
  grant: GrantConfig,
  view: ViewConfig,
): Result<void, GrantError> {
  const scopeResult = checkGroupInScope(request.groupId, view);
  if (scopeResult.isErr()) {
    return Result.err(scopeResult.error);
  }

  if (!grant.groupManagement[action]) {
    return Result.err(
      GrantDeniedError.create(action, `groupManagement.${action}`),
    );
  }

  return Result.ok();
}
