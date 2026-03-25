/**
 * Credential service -- public API over the internal credential manager.
 *
 * Maps internal records to contract types for consumption by
 * transports (CLI, WS, MCP, HTTP). Optionally resolves scopes
 * from a policy manager when a `policyId` is present.
 */

import { Result } from "better-result";
import type {
  CredentialConfigType,
  CredentialRecordType,
  CredentialIssuerType,
  IssuedCredentialType,
  CredentialRevocationReason,
  SignetError,
  PermissionScopeType,
  ScopeSetType,
} from "@xmtp/signet-schemas";
import {
  resolvePolicy,
  NotFoundError,
  ValidationError,
} from "@xmtp/signet-schemas";
import type {
  CredentialManager,
  CredentialRecord,
  PolicyManager,
} from "@xmtp/signet-contracts";
import { fingerprintToken, generateCredentialId } from "./token.js";
import type {
  InternalCredentialManager,
  InternalCredentialRecord,
} from "./credential-manager.js";

/** Dependencies required by the credential service. */
export interface CredentialServiceDeps {
  /** The internal credential manager for storage and lifecycle. */
  readonly manager: InternalCredentialManager;
  /** Optional policy manager for resolving policyId references. */
  readonly policyManager?: PolicyManager;
}

/** Optional provenance supplied at credential issuance time. */
export interface CredentialServiceIssueOptions {
  /** Actor that issued the credential. Defaults to `"owner"` when omitted. */
  readonly issuedBy?: CredentialIssuerType;
}

/** Map internal record to the schema credential record. */
function toSchemaCredentialRecord(
  record: InternalCredentialRecord,
): CredentialRecordType {
  return {
    id: record.credentialId,
    config: {
      operatorId: record.operatorId,
      chatIds: [...record.chatIds],
      allow: [...record.effectiveScopes.allow],
      deny: [...record.effectiveScopes.deny],
    },
    inboxIds: [],
    status: record.status,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    issuedBy: record.issuedBy,
  };
}

/** Map internal record to the runtime-enriched credential contract. */
function toCredentialRecord(
  record: InternalCredentialRecord,
): CredentialRecord {
  const baseRecord = toSchemaCredentialRecord(record);
  return {
    ...baseRecord,
    credentialId: record.credentialId,
    operatorId: record.operatorId,
    effectiveScopes: {
      allow: [...record.effectiveScopes.allow],
      deny: [...record.effectiveScopes.deny],
    },
    isExpired:
      record.status === "expired" ||
      new Date(record.expiresAt).getTime() <= Date.now(),
    lastHeartbeat: record.lastHeartbeat,
  };
}

/** Map internal record to the issued credential response. */
function toIssuedCredential(
  record: InternalCredentialRecord,
): IssuedCredentialType {
  return {
    token: record.token,
    credential: toSchemaCredentialRecord(record),
  };
}

/**
 * Resolve scopes by looking up a policy and merging with inline overrides.
 *
 * @returns Ok with merged scope set, or Err if policy lookup fails.
 */
async function resolvePolicyScopes(
  policyManager: PolicyManager | undefined,
  policyId: string,
  inlineAllow?: PermissionScopeType[],
  inlineDeny?: PermissionScopeType[],
): Promise<Result<ScopeSetType, SignetError>> {
  if (policyManager === undefined) {
    return Result.err(NotFoundError.create("policy", policyId));
  }
  const policyResult = await policyManager.lookup(policyId);
  if (Result.isError(policyResult)) {
    return policyResult;
  }
  return Result.ok(
    resolvePolicy(policyResult.value.config, inlineAllow, inlineDeny),
  );
}

/** Create the public credential service implementation. */
export function createCredentialService(
  deps: CredentialServiceDeps,
): CredentialManager {
  return {
    async issue(
      config: CredentialConfigType,
      options?: CredentialServiceIssueOptions,
    ) {
      deps.manager.sweepExpired();

      // Resolve scopes from policy if policyId is specified
      let resolvedConfig = config;
      if (config.policyId !== undefined) {
        const scopeResult = await resolvePolicyScopes(
          deps.policyManager,
          config.policyId,
          config.allow,
          config.deny,
        );
        if (Result.isError(scopeResult)) {
          return scopeResult;
        }
        resolvedConfig = {
          ...config,
          allow: scopeResult.value.allow,
          deny: scopeResult.value.deny,
        };
      }

      const credentialId = generateCredentialId();
      const issueOptions =
        options?.issuedBy !== undefined
          ? {
              credentialId,
              issuedBy: options.issuedBy,
            }
          : { credentialId };

      const created = await deps.manager.issueCredential(
        resolvedConfig,
        issueOptions,
      );
      if (Result.isError(created)) {
        return created;
      }

      return Result.ok(toIssuedCredential(created.value));
    },

    async list(operatorId?: string) {
      deps.manager.sweepExpired();
      return Result.ok(
        deps.manager.listCredentials(operatorId).map(toCredentialRecord),
      );
    },

    async lookup(credentialId: string) {
      deps.manager.sweepExpired();
      const result = deps.manager.getCredentialById(credentialId);
      if (Result.isError(result)) {
        return result;
      }
      return Result.ok(toCredentialRecord(result.value));
    },

    async lookupByToken(token: string) {
      const result = deps.manager.getCredentialByToken(token);
      if (Result.isError(result)) {
        return result;
      }
      return Result.ok(toCredentialRecord(result.value));
    },

    async revoke(credentialId: string, reason: CredentialRevocationReason) {
      const result = deps.manager.revokeCredential(credentialId, reason);
      if (Result.isError(result)) {
        return result;
      }
      return Result.ok(undefined);
    },

    async update(credentialId: string, changes: Partial<CredentialConfigType>) {
      const current = deps.manager.getCredentialById(credentialId);
      if (Result.isError(current)) {
        return current;
      }

      if (
        changes.operatorId !== undefined ||
        changes.chatIds !== undefined ||
        changes.ttlSeconds !== undefined
      ) {
        return Result.err(
          ValidationError.create(
            "changes",
            "Credential updates only support allow/deny/policyId changes",
          ),
        );
      }

      const hasScopeChanges =
        changes.allow !== undefined ||
        changes.deny !== undefined ||
        changes.policyId !== undefined;

      if (!hasScopeChanges) {
        return Result.ok(toCredentialRecord(current.value));
      }

      // Resolve policy if policyId is changing
      let effectiveAllow = changes.allow ?? current.value.effectiveScopes.allow;
      let effectiveDeny = changes.deny ?? current.value.effectiveScopes.deny;

      if (changes.policyId !== undefined) {
        const scopeResult = await resolvePolicyScopes(
          deps.policyManager,
          changes.policyId,
          changes.allow,
          changes.deny,
        );
        if (Result.isError(scopeResult)) {
          return scopeResult;
        }
        effectiveAllow = scopeResult.value.allow;
        effectiveDeny = scopeResult.value.deny;
      }

      const nextScopes = {
        allow: effectiveAllow,
        deny: effectiveDeny,
      } satisfies ScopeSetType;

      const materialityResult = deps.manager.checkMateriality(
        credentialId,
        nextScopes,
      );
      if (Result.isError(materialityResult)) {
        return materialityResult;
      }

      if (materialityResult.value.requiresReauthorization) {
        const revokeResult = deps.manager.revokeCredential(
          credentialId,
          "reauthorization-required",
        );
        if (Result.isError(revokeResult)) {
          return revokeResult;
        }
        return Result.ok(toCredentialRecord(revokeResult.value));
      }

      const updateResult = deps.manager.updateCredentialScopes(
        credentialId,
        nextScopes,
      );
      if (Result.isError(updateResult)) {
        return updateResult;
      }
      return Result.ok(toCredentialRecord(updateResult.value));
    },

    async renew(credentialId: string) {
      const result = await deps.manager.renewCredential(credentialId);
      if (Result.isError(result)) {
        return result;
      }
      const fingerprint = await fingerprintToken(result.value.token);
      return Result.ok({
        credentialId: result.value.credentialId,
        operatorId: result.value.operatorId,
        fingerprint,
        issuedAt: result.value.issuedAt,
        expiresAt: result.value.expiresAt,
      });
    },
  };
}
