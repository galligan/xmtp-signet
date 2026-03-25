/**
 * Credential scope update actions.
 *
 * Allows modifying a credential's scopes in-place without
 * revoke + reissue. Non-escalating changes apply immediately.
 * Escalations trigger reauthorization.
 */

import { Result } from "better-result";
import { z } from "zod";
import type { ActionSpec } from "@xmtp/signet-contracts";
import type { CredentialManager } from "@xmtp/signet-contracts";
import type { SignetError, ScopeSetType } from "@xmtp/signet-schemas";
import { AuthError, ScopeSet } from "@xmtp/signet-schemas";
import type { InternalCredentialManager } from "./credential-manager.js";

/** Dependencies for credential update actions. */
export interface UpdateActionDeps {
  readonly credentialManager: CredentialManager;
  readonly internalManager: InternalCredentialManager;
}

/** Result shape for update operations. */
interface UpdateResult {
  readonly updated: boolean;
  readonly material: boolean;
  readonly reason: string | null;
}

function widenActionSpec<TInput, TOutput>(
  spec: ActionSpec<TInput, TOutput, SignetError>,
): ActionSpec<unknown, unknown, SignetError> {
  return spec as ActionSpec<unknown, unknown, SignetError>;
}

/** Create CLI and MCP actions for in-place credential scope updates. */
export function createUpdateActions(
  deps: UpdateActionDeps,
): ActionSpec<unknown, unknown, SignetError>[] {
  const updateScopes: ActionSpec<
    { credentialId: string; scopes: ScopeSetType },
    UpdateResult,
    SignetError
  > = {
    id: "credential.updateScopes",
    input: z.object({
      credentialId: z.string(),
      scopes: ScopeSet,
    }),
    handler: async (input) => {
      const lookupResult = await deps.credentialManager.lookup(
        input.credentialId,
      );
      if (Result.isError(lookupResult)) {
        return lookupResult;
      }

      const credential = lookupResult.value;
      if (credential.status !== "active") {
        return Result.err(
          AuthError.create("Credential is not active", {
            credentialId: input.credentialId,
            status: credential.status,
          }),
        );
      }

      const materialityResult = deps.internalManager.checkMateriality(
        input.credentialId,
        input.scopes,
      );
      if (Result.isError(materialityResult)) {
        return materialityResult;
      }

      const check = materialityResult.value;

      if (check.requiresReauthorization) {
        const revokeResult = deps.internalManager.revokeCredential(
          input.credentialId,
          "reauthorization-required",
        );
        if (Result.isError(revokeResult)) {
          return revokeResult;
        }
        return Result.ok({
          updated: false,
          material: true,
          reason: check.reason,
        });
      }

      const updateResult = deps.internalManager.updateCredentialScopes(
        input.credentialId,
        input.scopes,
      );
      if (Result.isError(updateResult)) {
        return updateResult;
      }

      return Result.ok({
        updated: true,
        material: check.isMaterial,
        reason: check.reason,
      });
    },
    cli: {
      command: "credential:update-scopes",
      rpcMethod: "credential.updateScopes",
    },
  };

  return [widenActionSpec(updateScopes)];
}
