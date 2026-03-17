import { Result } from "better-result";
import { type GrantConfig, GrantDeniedError } from "@xmtp/signet-schemas";
import type { GrantError } from "@xmtp/signet-contracts";

type EgressAction =
  | "storeExcerpts"
  | "useForMemory"
  | "forwardToProviders"
  | "quoteRevealed"
  | "summarize";

/**
 * Validates an egress action against the active grant.
 */
export function validateEgress(
  action: EgressAction,
  grant: GrantConfig,
): Result<void, GrantError> {
  if (!grant.egress[action]) {
    return Result.err(GrantDeniedError.create(action, `egress.${action}`));
  }

  return Result.ok();
}
