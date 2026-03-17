import { Result } from "better-result";
import { type GrantConfig, GrantDeniedError } from "@xmtp-broker/schemas";
import type { GrantError } from "@xmtp-broker/contracts";

/**
 * Validates a tool invocation against the active grant.
 *
 * The toolId must appear in grant.tools.scopes with allowed: true.
 * Deep parameter constraint validation is deferred to Phase 2.
 */
export function validateToolUse(
  toolId: string,
  _parameters: Record<string, unknown> | null,
  grant: GrantConfig,
): Result<void, GrantError> {
  const scope = grant.tools.scopes.find((s) => s.toolId === toolId);

  if (!scope || !scope.allowed) {
    return Result.err(
      GrantDeniedError.create(`tool:${toolId}`, "tools.scopes"),
    );
  }

  return Result.ok();
}
