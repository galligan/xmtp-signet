import { Result } from "better-result";
import type {
  PermissionScopeType,
  ScopeSetType,
  SignetError,
} from "@xmtp/signet-schemas";
import { resolveScopeSet } from "@xmtp/signet-schemas";
import type { ScopeGuard } from "@xmtp/signet-contracts";

/**
 * Callback to look up a credential's scope set by ID.
 *
 * Implementations typically query the credential store and return
 * the credential's {@link ScopeSetType}. Return an error result
 * (e.g. {@link NotFoundError}) when the credential does not exist.
 */
export type CredentialScopeLookup = (
  credentialId: string,
) => Promise<Result<ScopeSetType, SignetError>>;

/**
 * Create a {@link ScopeGuard} that resolves scopes via a credential lookup.
 *
 * The returned guard delegates scope resolution to
 * {@link resolveScopeSet}, which applies deny-wins semantics:
 * a scope is effective only if it appears in `allow` and does
 * NOT appear in `deny`.
 *
 * @param lookup - Async function that retrieves a credential's scope set.
 * @returns A {@link ScopeGuard} backed by the provided lookup.
 */
export function createScopeGuard(lookup: CredentialScopeLookup): ScopeGuard {
  return {
    async check(
      scope: PermissionScopeType,
      credentialId: string,
    ): Promise<Result<boolean, SignetError>> {
      const scopesResult = await lookup(credentialId);
      if (scopesResult.isErr()) {
        return scopesResult;
      }

      const resolved = resolveScopeSet(scopesResult.value);
      return Result.ok(resolved.has(scope));
    },

    async effectiveScopes(
      credentialId: string,
    ): Promise<Result<ScopeSetType, SignetError>> {
      return lookup(credentialId);
    },
  };
}
