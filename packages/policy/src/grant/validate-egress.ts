import { Result } from "better-result";
import { PermissionError } from "@xmtp/signet-schemas";

/**
 * Validates an egress action against the resolved scope set.
 *
 * The scope parameter should be the v1 permission scope name (e.g.,
 * "store-excerpts", "use-for-memory", "forward-to-provider").
 */
export function validateEgress(
  scope: string,
  scopes: ReadonlySet<string>,
): Result<void, PermissionError> {
  if (!scopes.has(scope)) {
    return Result.err(
      PermissionError.create(`Permission denied: ${scope}`, { scope }),
    );
  }
  return Result.ok();
}
