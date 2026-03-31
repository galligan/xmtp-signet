/**
 * Policy lifecycle actions for CLI and MCP surfaces.
 */

import { Result } from "better-result";
import { z } from "zod";
import type { ActionSpec } from "@xmtp/signet-contracts";
import type { PolicyManager } from "@xmtp/signet-contracts";
import type {
  SignetError,
  PolicyConfigType,
  PolicyRecordType,
} from "@xmtp/signet-schemas";
import {
  PolicyConfig,
  PolicyId,
  PermissionScope,
  NotFoundError,
  ValidationError,
} from "@xmtp/signet-schemas";

/** Dependencies for policy action registration. */
export interface PolicyActionDeps {
  readonly policyManager: PolicyManager;
}

function widenActionSpec<TInput, TOutput>(
  spec: ActionSpec<TInput, TOutput, SignetError>,
): ActionSpec<unknown, unknown, SignetError> {
  // The shared registry intentionally erases per-action input/output types.
  return spec as ActionSpec<unknown, unknown, SignetError>;
}

/**
 * Resolve a policy by ID or label. If the value starts with `policy_`, validate
 * it as a resource ID and use directly. Otherwise, search policies by label.
 * Rejects ambiguous labels (multiple policies with the same label).
 */
async function resolvePolicyId(
  manager: PolicyManager,
  idOrLabel: string,
): Promise<Result<string, SignetError>> {
  if (idOrLabel.startsWith("policy_")) {
    if (!PolicyId.safeParse(idOrLabel).success) {
      return Result.err(
        ValidationError.create(
          "policyId",
          `Invalid policy ID format: ${idOrLabel}`,
        ),
      );
    }
    return Result.ok(idOrLabel);
  }
  const listResult = await manager.list();
  if (Result.isError(listResult)) return listResult;
  const matches = listResult.value.filter((p) => p.config.label === idOrLabel);
  if (matches.length === 0) {
    return Result.err(NotFoundError.create("policy", idOrLabel));
  }
  if (matches.length > 1) {
    return Result.err(
      ValidationError.create("policyId", "Ambiguous policy label", {
        label: idOrLabel,
        matchingIds: matches.map((p) => p.id),
      }),
    );
  }
  return Result.ok(matches[0]!.id);
}

/** Create policy lifecycle actions for CLI and future HTTP surfaces. */
export function createPolicyActions(
  deps: PolicyActionDeps,
): ActionSpec<unknown, unknown, SignetError>[] {
  const create: ActionSpec<PolicyConfigType, unknown, SignetError> = {
    id: "policy.create",
    description: "Create a new permission policy",
    intent: "write",
    input: PolicyConfig,
    handler: async (input) => deps.policyManager.create(input),
    cli: {
      command: "policy:create",
    },
    mcp: {
      toolName: "policy_create",
    },
    http: {
      auth: "admin",
    },
  };

  const list: ActionSpec<
    Record<string, never>,
    readonly PolicyRecordType[],
    SignetError
  > = {
    id: "policy.list",
    description: "List all registered policies",
    intent: "read",
    idempotent: true,
    input: z.object({}),
    handler: async () => deps.policyManager.list(),
    cli: {
      command: "policy:list",
    },
    mcp: {
      toolName: "policy_list",
    },
    http: {
      auth: "admin",
    },
  };

  const info: ActionSpec<{ policyId: string }, unknown, SignetError> = {
    id: "policy.info",
    description: "Look up a policy by ID or label",
    intent: "read",
    idempotent: true,
    input: z.object({
      policyId: z.string(),
    }),
    handler: async (input) => {
      const resolved = await resolvePolicyId(
        deps.policyManager,
        input.policyId,
      );
      if (Result.isError(resolved)) return resolved;
      return deps.policyManager.lookup(resolved.value);
    },
    cli: {
      command: "policy:info",
    },
    mcp: {
      toolName: "policy_info",
    },
    http: {
      auth: "admin",
    },
  };

  const update: ActionSpec<
    { policyId: string; changes: Partial<PolicyConfigType> },
    unknown,
    SignetError
  > = {
    id: "policy.update",
    description: "Update a policy's configuration",
    intent: "write",
    input: z.object({
      policyId: z.string(),
      changes: z
        .object({
          label: z.string().min(1),
          allow: z.array(PermissionScope),
          deny: z.array(PermissionScope),
        })
        .partial() as z.ZodType<Partial<PolicyConfigType>>,
    }),
    handler: async (input) => {
      const resolved = await resolvePolicyId(
        deps.policyManager,
        input.policyId,
      );
      if (Result.isError(resolved)) return resolved;
      return deps.policyManager.update(resolved.value, input.changes);
    },
    cli: {
      command: "policy:update",
    },
    mcp: {
      toolName: "policy_update",
    },
    http: {
      auth: "admin",
    },
  };

  const remove: ActionSpec<
    { policyId: string },
    { removed: true },
    SignetError
  > = {
    id: "policy.remove",
    description: "Remove a policy",
    intent: "destroy",
    input: z.object({
      policyId: z.string(),
    }),
    handler: async (input) => {
      const resolved = await resolvePolicyId(
        deps.policyManager,
        input.policyId,
      );
      if (Result.isError(resolved)) return resolved;
      const result = await deps.policyManager.remove(resolved.value);
      if (Result.isError(result)) return result;
      return Result.ok({ removed: true as const });
    },
    cli: {
      command: "policy:remove",
    },
    mcp: {
      toolName: "policy_remove",
    },
    http: {
      auth: "admin",
    },
  };

  return [
    widenActionSpec(create),
    widenActionSpec(list),
    widenActionSpec(info),
    widenActionSpec(update),
    widenActionSpec(remove),
  ];
}
