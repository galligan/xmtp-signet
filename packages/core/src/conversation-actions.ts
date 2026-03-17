import { Result } from "better-result";
import { z } from "zod";
import type { ActionSpec } from "@xmtp-broker/contracts";
import { NotFoundError } from "@xmtp-broker/schemas";
import type { BrokerError } from "@xmtp-broker/schemas";
import type { SqliteIdentityStore } from "./identity-store.js";
import type { ManagedClient } from "./client-registry.js";
import type { XmtpGroupInfo } from "./xmtp-client-factory.js";

export interface ConversationActionDeps {
  readonly identityStore: SqliteIdentityStore;
  readonly getManagedClient: (identityId: string) => ManagedClient | undefined;
  readonly getGroupInfo: (
    groupId: string,
  ) => Promise<Result<XmtpGroupInfo, BrokerError>>;
}

/**
 * Resolve an identity by label, or fall back to the first identity
 * in the store when no label is provided.
 */
async function resolveIdentity(
  identityStore: SqliteIdentityStore,
  label: string | undefined,
): Promise<
  Result<{ identityId: string; inboxId: string | null }, BrokerError>
> {
  if (label) {
    const identity = await identityStore.getByLabel(label);
    if (!identity) {
      return Result.err(NotFoundError.create("identity", label) as BrokerError);
    }
    return Result.ok({
      identityId: identity.id,
      inboxId: identity.inboxId,
    });
  }

  // Fall back to first identity
  const identities = await identityStore.list();
  const first = identities[0];
  if (!first) {
    return Result.err(
      NotFoundError.create("identity", "(none)") as BrokerError,
    );
  }
  return Result.ok({
    identityId: first.id,
    inboxId: first.inboxId,
  });
}

/** Create ActionSpecs for conversation operations. */
export function createConversationActions(
  deps: ConversationActionDeps,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): ActionSpec<any, any, BrokerError>[] {
  const create: ActionSpec<
    {
      memberInboxIds: string[];
      name?: string | undefined;
      creatorIdentityLabel?: string | undefined;
    },
    {
      groupId: string;
      name: string;
      creatorInboxId: string;
      memberCount: number;
    },
    BrokerError
  > = {
    id: "conversation.create",
    input: z.object({
      memberInboxIds: z.array(z.string()),
      name: z.string().optional(),
      creatorIdentityLabel: z.string().optional(),
    }),
    handler: async (input) => {
      const resolved = await resolveIdentity(
        deps.identityStore,
        input.creatorIdentityLabel,
      );
      if (Result.isError(resolved)) return resolved;

      const managed = deps.getManagedClient(resolved.value.identityId);
      if (!managed) {
        return Result.err(
          NotFoundError.create(
            "managed-client",
            resolved.value.identityId,
          ) as BrokerError,
        );
      }

      const opts = input.name !== undefined ? { name: input.name } : {};
      const groupResult = await managed.client.createGroup(
        input.memberInboxIds,
        opts,
      );
      if (Result.isError(groupResult)) return groupResult;

      const group = groupResult.value;
      return Result.ok({
        groupId: group.groupId,
        name: group.name,
        creatorInboxId: managed.inboxId,
        memberCount: group.memberInboxIds.length,
      });
    },
    cli: {
      command: "conversation:create",
      rpcMethod: "conversation.create",
    },
    mcp: {
      toolName: "broker/conversation/create",
      description: "Create a new group conversation",
      readOnly: false,
    },
  };

  const list: ActionSpec<
    { identityLabel?: string | undefined },
    { groups: readonly XmtpGroupInfo[] },
    BrokerError
  > = {
    id: "conversation.list",
    input: z.object({
      identityLabel: z.string().optional(),
    }),
    handler: async (input) => {
      const resolved = await resolveIdentity(
        deps.identityStore,
        input.identityLabel,
      );
      if (Result.isError(resolved)) return resolved;

      const managed = deps.getManagedClient(resolved.value.identityId);
      if (!managed) {
        return Result.err(
          NotFoundError.create(
            "managed-client",
            resolved.value.identityId,
          ) as BrokerError,
        );
      }

      const groupsResult = await managed.client.listGroups();
      if (Result.isError(groupsResult)) return groupsResult;

      return Result.ok({ groups: groupsResult.value });
    },
    cli: {
      command: "conversation:list",
      rpcMethod: "conversation.list",
    },
    mcp: {
      toolName: "broker/conversation/list",
      description: "List group conversations",
      readOnly: true,
    },
  };

  const info: ActionSpec<{ groupId: string }, XmtpGroupInfo, BrokerError> = {
    id: "conversation.info",
    input: z.object({
      groupId: z.string(),
    }),
    handler: async (input) => deps.getGroupInfo(input.groupId),
    cli: {
      command: "conversation:info",
      rpcMethod: "conversation.info",
    },
    mcp: {
      toolName: "broker/conversation/info",
      description: "Get group conversation details",
      readOnly: true,
    },
  };

  return [
    widenActionSpec(create),
    widenActionSpec(list),
    widenActionSpec(info),
  ];
}
