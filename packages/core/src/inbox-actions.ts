import { Result } from "better-result";
import { z } from "zod";
import type { ActionSpec, OperatorManager } from "@xmtp/signet-contracts";
import type { IdMappingStore, SignetError } from "@xmtp/signet-schemas";
import {
  InboxId,
  NotFoundError,
  OperatorId,
  ValidationError,
} from "@xmtp/signet-schemas";
import type { AgentIdentity, SqliteIdentityStore } from "./identity-store.js";
import type {
  RegisterIdentityInput,
  RegisteredIdentity,
} from "./identity-registration.js";

/** Callback used to register a new inbox identity on the XMTP network. */
export type RegisterInbox = (
  input: RegisterIdentityInput,
) => Promise<Result<RegisteredIdentity, SignetError>>;

/**
 * Callback used to summarize and optionally execute runtime-specific inbox
 * cleanup, such as detaching live clients or deleting local database files.
 */
export type CleanupInbox = (
  identity: AgentIdentity,
  execute: boolean,
) => Promise<Result<readonly string[], SignetError>>;

/** Dependencies required to expose inbox actions through the runtime. */
export interface InboxActionDeps {
  /** Persistent store of local inbox identities. */
  readonly identityStore: SqliteIdentityStore;
  /** XMTP registration entrypoint for new inbox identities. */
  readonly registerInbox: RegisterInbox;
  /** Optional operator manager for auto-linking inboxes to operators. */
  readonly operatorManager?: OperatorManager;
  /** Optional mapping store between network inbox IDs and local inbox IDs. */
  readonly idMappings?: IdMappingStore;
  /** Optional runtime cleanup callback for inbox removal. */
  readonly cleanupInbox?: CleanupInbox;
}

/** Public summary for a managed inbox. */
export type InboxSummary = {
  readonly id: string;
  readonly networkInboxId: string | null;
  readonly label: string | null;
  readonly groupId: string | null;
  readonly createdAt: string;
  readonly operatorId: string | null;
};

/** Result returned by `inbox.rm`. */
export type InboxRemoveResult = {
  readonly executed: boolean;
  readonly actions: readonly string[];
};

const InboxSummarySchema: z.ZodType<InboxSummary> = z.object({
  id: InboxId,
  networkInboxId: z.string().nullable(),
  label: z.string().nullable(),
  groupId: z.string().nullable(),
  createdAt: z.string(),
  operatorId: OperatorId.nullable(),
});

const InboxRemoveResultSchema: z.ZodType<InboxRemoveResult> = z.object({
  executed: z.boolean(),
  actions: z.array(z.string()),
});

function widenActionSpec<TInput, TOutput>(
  spec: ActionSpec<TInput, TOutput, SignetError>,
): ActionSpec<unknown, unknown, SignetError> {
  return spec as ActionSpec<unknown, unknown, SignetError>;
}

async function resolveInbox(
  identityStore: SqliteIdentityStore,
  idOrLabel: string,
): Promise<Result<AgentIdentity, SignetError>> {
  if (idOrLabel.startsWith("inbox_")) {
    if (!InboxId.safeParse(idOrLabel).success) {
      return Result.err(
        ValidationError.create(
          "inboxId",
          `Invalid inbox ID format: ${idOrLabel}`,
        ),
      );
    }
    const identity = await identityStore.getById(idOrLabel);
    if (identity === null) {
      return Result.err(NotFoundError.create("inbox", idOrLabel));
    }
    return Result.ok(identity);
  }

  const byLabel = await identityStore.getByLabel(idOrLabel);
  if (byLabel !== null) {
    return Result.ok(byLabel);
  }

  const byId = await identityStore.getById(idOrLabel);
  if (byId !== null) {
    return Result.ok(byId);
  }

  return Result.err(NotFoundError.create("inbox", idOrLabel));
}

async function resolveOperator(
  operatorManager: OperatorManager,
  operatorId: string,
): Promise<Result<{ id: string }, SignetError>> {
  if (operatorId.startsWith("op_")) {
    if (!OperatorId.safeParse(operatorId).success) {
      return Result.err(
        ValidationError.create(
          "operatorId",
          `Invalid operator ID format: ${operatorId}`,
        ),
      );
    }

    const direct = await operatorManager.lookup(operatorId);
    if (Result.isError(direct)) {
      return direct;
    }
    if (direct.value.status === "removed") {
      return Result.err(NotFoundError.create("operator", operatorId));
    }

    return Result.ok({ id: direct.value.id });
  }

  const operators = await operatorManager.list();
  if (Result.isError(operators)) {
    return operators;
  }

  const matches = operators.value.filter(
    (candidate) => candidate.config.label === operatorId,
  );
  if (matches.length === 0) {
    return Result.err(NotFoundError.create("operator", operatorId));
  }
  if (matches.length > 1) {
    return Result.err(
      ValidationError.create("operatorId", "Ambiguous operator label", {
        label: operatorId,
        matchingIds: matches.map((candidate) => candidate.id),
      }),
    );
  }

  return Result.ok({ id: matches[0]!.id });
}

async function buildInboxLinkMap(
  operatorManager: OperatorManager | undefined,
): Promise<Result<Map<string, string>, SignetError>> {
  const map = new Map<string, string>();
  if (!operatorManager) {
    return Result.ok(map);
  }

  const operators = await operatorManager.list();
  if (Result.isError(operators)) {
    return operators;
  }

  for (const operator of operators.value) {
    for (const inboxId of operator.config.inboxIds ?? []) {
      const existing = map.get(inboxId);
      if (existing && existing !== operator.id) {
        return Result.err(
          ValidationError.create(
            "inboxIds",
            "Inbox is linked to multiple operators",
            {
              inboxId,
              operatorIds: [existing, operator.id],
            },
          ),
        );
      }
      map.set(inboxId, operator.id);
    }
  }

  return Result.ok(map);
}

function summarizeInbox(
  identity: AgentIdentity,
  operatorId: string | null,
): InboxSummary {
  return {
    id: identity.id,
    networkInboxId: identity.inboxId,
    label: identity.label,
    groupId: identity.groupId,
    createdAt: identity.createdAt,
    operatorId,
  };
}

async function linkInboxToOperator(
  operatorManager: OperatorManager,
  operatorId: string,
  inboxId: string,
): Promise<Result<string, SignetError>> {
  const resolvedOperator = await resolveOperator(operatorManager, operatorId);
  if (Result.isError(resolvedOperator)) {
    return resolvedOperator;
  }

  const linkMap = await buildInboxLinkMap(operatorManager);
  if (Result.isError(linkMap)) {
    return linkMap;
  }

  const existingOperatorId = linkMap.value.get(inboxId) ?? null;
  if (
    existingOperatorId !== null &&
    existingOperatorId !== resolvedOperator.value.id
  ) {
    return Result.err(
      ValidationError.create(
        "inboxId",
        "Inbox is already linked to another operator",
        {
          inboxId,
          operatorId: existingOperatorId,
        },
      ),
    );
  }

  const operator = await operatorManager.lookup(resolvedOperator.value.id);
  if (Result.isError(operator)) {
    return operator;
  }

  const inboxIds = new Set(operator.value.config.inboxIds ?? []);
  inboxIds.add(inboxId);

  const updated = await operatorManager.update(operator.value.id, {
    inboxIds: [...inboxIds],
  });
  if (Result.isError(updated)) {
    return updated;
  }

  return Result.ok(updated.value.id);
}

async function unlinkInboxFromOperator(
  operatorManager: OperatorManager | undefined,
  inboxId: string,
): Promise<Result<string | null, SignetError>> {
  if (!operatorManager) {
    return Result.ok(null);
  }

  const linkMap = await buildInboxLinkMap(operatorManager);
  if (Result.isError(linkMap)) {
    return linkMap;
  }

  const operatorId = linkMap.value.get(inboxId) ?? null;
  if (operatorId === null) {
    return Result.ok(null);
  }

  const operator = await operatorManager.lookup(operatorId);
  if (Result.isError(operator)) {
    return operator;
  }

  const remainingInboxIds = (operator.value.config.inboxIds ?? []).filter(
    (candidate) => candidate !== inboxId,
  );

  const updated = await operatorManager.update(operatorId, {
    inboxIds: remainingInboxIds.length > 0 ? remainingInboxIds : undefined,
  });
  if (Result.isError(updated)) {
    return updated;
  }

  return Result.ok(operatorId);
}

/** Create inbox lifecycle actions for the CLI and admin surfaces. */
export function createInboxActions(
  deps: InboxActionDeps,
): ActionSpec<unknown, unknown, SignetError>[] {
  const create: ActionSpec<
    { label?: string | undefined; operatorId?: string | undefined },
    InboxSummary,
    SignetError
  > = {
    id: "inbox.create",
    description: "Create and optionally link a managed inbox",
    intent: "write",
    input: z.object({
      label: z.string().min(1).optional(),
      operatorId: z.string().min(1).optional(),
    }),
    output: InboxSummarySchema,
    handler: async (input) => {
      let linkedOperatorId: string | null = null;

      if (input.operatorId !== undefined) {
        if (!deps.operatorManager) {
          return Result.err(
            ValidationError.create(
              "operatorId",
              "Operator linking is unavailable without an operator manager",
            ),
          );
        }

        const resolvedOperator = await resolveOperator(
          deps.operatorManager,
          input.operatorId,
        );
        if (Result.isError(resolvedOperator)) {
          return resolvedOperator;
        }
        linkedOperatorId = resolvedOperator.value.id;
      }

      const registered = await deps.registerInbox({
        groupId: null,
        ...(input.label !== undefined ? { label: input.label } : {}),
      });
      if (Result.isError(registered)) {
        return registered;
      }

      if (deps.idMappings) {
        deps.idMappings.set(
          registered.value.inboxId,
          registered.value.identityId,
          "inbox",
        );
      }

      if (linkedOperatorId !== null && deps.operatorManager) {
        const linked = await linkInboxToOperator(
          deps.operatorManager,
          linkedOperatorId,
          registered.value.identityId,
        );
        if (Result.isError(linked)) {
          return linked;
        }
        linkedOperatorId = linked.value;
      }

      const identity = await deps.identityStore.getById(
        registered.value.identityId,
      );
      if (identity === null) {
        return Result.err(
          NotFoundError.create("inbox", registered.value.identityId),
        );
      }

      return Result.ok(summarizeInbox(identity, linkedOperatorId));
    },
    cli: {
      command: "inbox:create",
    },
    http: {
      auth: "admin",
    },
  };

  const list: ActionSpec<
    Record<string, never>,
    readonly InboxSummary[],
    SignetError
  > = {
    id: "inbox.list",
    description: "List all managed inboxes",
    intent: "read",
    idempotent: true,
    input: z.object({}),
    output: z.array(InboxSummarySchema),
    handler: async () => {
      const identities = await deps.identityStore.list();
      const linkMap = await buildInboxLinkMap(deps.operatorManager);
      if (Result.isError(linkMap)) {
        return linkMap;
      }

      return Result.ok(
        identities.map((identity) =>
          summarizeInbox(identity, linkMap.value.get(identity.id) ?? null),
        ),
      );
    },
    cli: {
      command: "inbox:list",
    },
    http: {
      auth: "admin",
    },
  };

  const info: ActionSpec<{ inboxId: string }, InboxSummary, SignetError> = {
    id: "inbox.info",
    description: "Show managed inbox details",
    intent: "read",
    idempotent: true,
    input: z.object({
      inboxId: z.string().min(1),
    }),
    output: InboxSummarySchema,
    handler: async (input) => {
      const identity = await resolveInbox(deps.identityStore, input.inboxId);
      if (Result.isError(identity)) {
        return identity;
      }

      const linkMap = await buildInboxLinkMap(deps.operatorManager);
      if (Result.isError(linkMap)) {
        return linkMap;
      }

      return Result.ok(
        summarizeInbox(
          identity.value,
          linkMap.value.get(identity.value.id) ?? null,
        ),
      );
    },
    cli: {
      command: "inbox:info",
    },
    http: {
      auth: "admin",
    },
  };

  const link: ActionSpec<
    { inboxId: string; operatorId: string },
    InboxSummary,
    SignetError
  > = {
    id: "inbox.link",
    description: "Link a managed inbox to an operator",
    intent: "write",
    input: z.object({
      inboxId: z.string().min(1),
      operatorId: z.string().min(1),
    }),
    output: InboxSummarySchema,
    handler: async (input) => {
      if (!deps.operatorManager) {
        return Result.err(
          ValidationError.create(
            "operatorId",
            "Operator linking is unavailable without an operator manager",
          ),
        );
      }

      const identity = await resolveInbox(deps.identityStore, input.inboxId);
      if (Result.isError(identity)) {
        return identity;
      }

      const operatorId = await linkInboxToOperator(
        deps.operatorManager,
        input.operatorId,
        identity.value.id,
      );
      if (Result.isError(operatorId)) {
        return operatorId;
      }

      return Result.ok(summarizeInbox(identity.value, operatorId.value));
    },
    cli: {
      command: "inbox:link",
    },
    http: {
      auth: "admin",
    },
  };

  const unlink: ActionSpec<{ inboxId: string }, InboxSummary, SignetError> = {
    id: "inbox.unlink",
    description: "Unlink a managed inbox from its operator",
    intent: "write",
    input: z.object({
      inboxId: z.string().min(1),
    }),
    output: InboxSummarySchema,
    handler: async (input) => {
      const identity = await resolveInbox(deps.identityStore, input.inboxId);
      if (Result.isError(identity)) {
        return identity;
      }

      const unlinked = await unlinkInboxFromOperator(
        deps.operatorManager,
        identity.value.id,
      );
      if (Result.isError(unlinked)) {
        return unlinked;
      }

      return Result.ok(summarizeInbox(identity.value, null));
    },
    cli: {
      command: "inbox:unlink",
    },
    http: {
      auth: "admin",
    },
  };

  const remove: ActionSpec<
    { inboxId: string; execute?: boolean | undefined },
    InboxRemoveResult,
    SignetError
  > = {
    id: "inbox.rm",
    description: "Remove a managed inbox from local signet state",
    intent: "destroy",
    input: z.object({
      inboxId: z.string().min(1),
      execute: z.boolean().optional(),
    }),
    output: InboxRemoveResultSchema,
    handler: async (input) => {
      const identity = await resolveInbox(deps.identityStore, input.inboxId);
      if (Result.isError(identity)) {
        return identity;
      }

      const execute = input.execute === true;
      const actions: string[] = [];
      const linkMap = await buildInboxLinkMap(deps.operatorManager);
      if (Result.isError(linkMap)) {
        return linkMap;
      }

      const linkedOperatorId = linkMap.value.get(identity.value.id) ?? null;
      if (linkedOperatorId !== null) {
        actions.push(`unlink operator ${linkedOperatorId}`);
      }

      actions.push(`remove inbox ${identity.value.id}`);

      const mapping =
        deps.idMappings?.resolve(identity.value.id) ??
        (identity.value.inboxId
          ? deps.idMappings?.resolve(identity.value.inboxId)
          : null) ??
        null;
      if (mapping !== null) {
        actions.push("remove id mapping");
      }

      if (deps.cleanupInbox) {
        const cleanup = await deps.cleanupInbox(identity.value, execute);
        if (Result.isError(cleanup)) {
          return cleanup;
        }
        actions.push(...cleanup.value);
      }

      if (!execute) {
        return Result.ok({ executed: false, actions });
      }

      const unlinked = await unlinkInboxFromOperator(
        deps.operatorManager,
        identity.value.id,
      );
      if (Result.isError(unlinked)) {
        return unlinked;
      }

      if (mapping !== null) {
        deps.idMappings?.remove(identity.value.id);
      }

      const removed = await deps.identityStore.remove(identity.value.id);
      if (Result.isError(removed)) {
        return removed;
      }

      return Result.ok({ executed: true, actions });
    },
    cli: {
      command: "inbox:rm",
    },
    http: {
      auth: "admin",
    },
  };

  return [
    widenActionSpec(create),
    widenActionSpec(list),
    widenActionSpec(info),
    widenActionSpec(remove),
    widenActionSpec(link),
    widenActionSpec(unlink),
  ];
}
