/**
 * Operator lifecycle actions for CLI and MCP surfaces.
 */

import { Result } from "better-result";
import { z } from "zod";
import type { ActionSpec } from "@xmtp/signet-contracts";
import type { OperatorManager } from "@xmtp/signet-contracts";
import type {
  SignetError,
  OperatorConfigType,
  OperatorRecordType,
} from "@xmtp/signet-schemas";
import {
  OperatorConfig,
  OperatorId,
  NotFoundError,
  ValidationError,
} from "@xmtp/signet-schemas";

/** Dependencies for operator action registration. */
export interface OperatorActionDeps {
  readonly operatorManager: OperatorManager;
}

function widenActionSpec<TInput, TOutput>(
  spec: ActionSpec<TInput, TOutput, SignetError>,
): ActionSpec<unknown, unknown, SignetError> {
  // The shared registry intentionally erases per-action input/output types.
  return spec as ActionSpec<unknown, unknown, SignetError>;
}

/**
 * Resolve an operator by ID or label. If the value starts with `op_`, validate
 * it as a resource ID and use directly. Otherwise, search active operators by
 * label. Rejects ambiguous labels (multiple operators with the same label).
 */
async function resolveOperatorId(
  manager: OperatorManager,
  idOrLabel: string,
): Promise<Result<string, SignetError>> {
  if (idOrLabel.startsWith("op_")) {
    if (!OperatorId.safeParse(idOrLabel).success) {
      return Result.err(
        ValidationError.create(
          "operatorId",
          `Invalid operator ID format: ${idOrLabel}`,
        ),
      );
    }
    return Result.ok(idOrLabel);
  }
  const listResult = await manager.list();
  if (Result.isError(listResult)) return listResult;
  const matches = listResult.value.filter(
    (op) => op.config.label === idOrLabel,
  );
  if (matches.length === 0) {
    return Result.err(NotFoundError.create("operator", idOrLabel));
  }
  if (matches.length > 1) {
    return Result.err(
      ValidationError.create("operatorId", "Ambiguous operator label", {
        label: idOrLabel,
        matchingIds: matches.map((op) => op.id),
      }),
    );
  }
  return Result.ok(matches[0]!.id);
}

/** Create operator lifecycle actions for CLI and future HTTP surfaces. */
export function createOperatorActions(
  deps: OperatorActionDeps,
): ActionSpec<unknown, unknown, SignetError>[] {
  const create: ActionSpec<OperatorConfigType, unknown, SignetError> = {
    id: "operator.create",
    description: "Register a new operator",
    intent: "write",
    input: OperatorConfig as z.ZodType<OperatorConfigType>,
    handler: async (input) => deps.operatorManager.create(input),
    cli: {
      command: "operator:create",
    },
    mcp: {
      toolName: "operator_create",
    },
    http: {
      auth: "admin",
    },
  };

  const list: ActionSpec<
    Record<string, never>,
    readonly OperatorRecordType[],
    SignetError
  > = {
    id: "operator.list",
    description: "List all active operators",
    intent: "read",
    idempotent: true,
    input: z.object({}),
    handler: async () => deps.operatorManager.list(),
    cli: {
      command: "operator:list",
    },
    mcp: {
      toolName: "operator_list",
    },
    http: {
      auth: "admin",
    },
  };

  const info: ActionSpec<{ operatorId: string }, unknown, SignetError> = {
    id: "operator.info",
    description: "Look up an operator by ID or label",
    intent: "read",
    idempotent: true,
    input: z.object({
      operatorId: z.string(),
    }),
    handler: async (input) => {
      const resolved = await resolveOperatorId(
        deps.operatorManager,
        input.operatorId,
      );
      if (Result.isError(resolved)) return resolved;
      return deps.operatorManager.lookup(resolved.value);
    },
    cli: {
      command: "operator:info",
    },
    mcp: {
      toolName: "operator_info",
    },
    http: {
      auth: "admin",
    },
  };

  const update: ActionSpec<
    { operatorId: string; changes: Partial<OperatorConfigType> },
    unknown,
    SignetError
  > = {
    id: "operator.update",
    description: "Update an operator's configuration",
    intent: "write",
    input: z.object({
      operatorId: z.string(),
      changes: OperatorConfig.partial() as z.ZodType<
        Partial<OperatorConfigType>
      >,
    }),
    handler: async (input) => {
      const resolved = await resolveOperatorId(
        deps.operatorManager,
        input.operatorId,
      );
      if (Result.isError(resolved)) return resolved;
      return deps.operatorManager.update(resolved.value, input.changes);
    },
    cli: {
      command: "operator:update",
    },
    mcp: {
      toolName: "operator_update",
    },
    http: {
      auth: "admin",
    },
  };

  const remove: ActionSpec<
    { operatorId: string },
    { removed: true },
    SignetError
  > = {
    id: "operator.remove",
    description: "Remove an operator and revoke associated credentials",
    intent: "destroy",
    input: z.object({
      operatorId: z.string(),
    }),
    handler: async (input) => {
      const resolved = await resolveOperatorId(
        deps.operatorManager,
        input.operatorId,
      );
      if (Result.isError(resolved)) return resolved;
      const result = await deps.operatorManager.remove(resolved.value);
      if (Result.isError(result)) return result;
      return Result.ok({ removed: true as const });
    },
    cli: {
      command: "operator:remove",
    },
    mcp: {
      toolName: "operator_remove",
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
