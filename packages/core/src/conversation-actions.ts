import { Result } from "better-result";
import { z } from "zod";
import type { ActionSpec } from "@xmtp-broker/contracts";
import { NotFoundError } from "@xmtp-broker/schemas";
import type { BrokerError } from "@xmtp-broker/schemas";
import type { SqliteIdentityStore } from "./identity-store.js";
import type { ManagedClient } from "./client-registry.js";
import type {
  XmtpClientFactory,
  XmtpGroupInfo,
} from "./xmtp-client-factory.js";
import type { BrokerCoreConfig } from "./config.js";
import { joinConversation } from "./convos/join.js";
import { generateConvosInviteUrl } from "./convos/invite-generator.js";
import type { SignerProviderFactory } from "./identity-registration.js";

export interface ConversationActionDeps {
  readonly identityStore: SqliteIdentityStore;
  readonly getManagedClient: (identityId: string) => ManagedClient | undefined;
  readonly getGroupInfo: (
    groupId: string,
  ) => Promise<Result<XmtpGroupInfo, BrokerError>>;
  readonly clientFactory?: XmtpClientFactory;
  readonly signerProviderFactory?: SignerProviderFactory;
  readonly config?: Pick<BrokerCoreConfig, "dataDir" | "env" | "appVersion">;
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

  const join: ActionSpec<
    {
      inviteUrl: string;
      label?: string | undefined;
      timeoutSeconds?: number | undefined;
    },
    {
      groupId: string;
      identityId: string;
      inboxId: string;
      inviteTag: string;
      groupName: string | undefined;
      creatorInboxId: string;
    },
    BrokerError
  > = {
    id: "conversation.join",
    input: z.object({
      inviteUrl: z.string(),
      label: z.string().optional(),
      timeoutSeconds: z.number().positive().optional(),
    }),
    handler: async (input) => {
      if (!deps.clientFactory || !deps.signerProviderFactory || !deps.config) {
        return Result.err(
          NotFoundError.create(
            "join-deps",
            "Join requires clientFactory, signerProviderFactory, and config",
          ) as BrokerError,
        );
      }

      const maxPollAttempts = input.timeoutSeconds
        ? Math.ceil((input.timeoutSeconds * 1000) / 2000)
        : undefined;

      const joinOptions: {
        label?: string;
        maxPollAttempts?: number;
      } = {};
      if (input.label !== undefined) joinOptions.label = input.label;
      if (maxPollAttempts !== undefined)
        joinOptions.maxPollAttempts = maxPollAttempts;

      return joinConversation(
        {
          identityStore: deps.identityStore,
          clientFactory: deps.clientFactory,
          signerProviderFactory: deps.signerProviderFactory,
          config: deps.config,
        },
        input.inviteUrl,
        joinOptions,
      );
    },
    cli: {
      command: "conversation:join",
      rpcMethod: "conversation.join",
      description: "Join a Convos conversation via invite URL",
    },
    mcp: {
      toolName: "broker/conversation/join",
      description: "Join a Convos conversation via invite URL",
      readOnly: false,
    },
  };

  const invite: ActionSpec<
    {
      groupId: string;
      identityLabel?: string | undefined;
      name?: string | undefined;
      description?: string | undefined;
    },
    {
      inviteUrl: string;
      groupId: string;
      groupName: string;
      creatorInboxId: string;
      inviteTag: string;
    },
    BrokerError
  > = {
    id: "conversation.invite",
    input: z.object({
      groupId: z.string(),
      identityLabel: z.string().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
    }),
    handler: async (input) => {
      if (!deps.signerProviderFactory || !deps.config) {
        return Result.err(
          NotFoundError.create(
            "invite-deps",
            "Invite requires signerProviderFactory and config",
          ) as BrokerError,
        );
      }

      // Resolve identity
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

      // Get group info
      const groupResult = await deps.getGroupInfo(input.groupId);
      if (Result.isError(groupResult)) return groupResult;

      // Get the secp256k1 private key for signing
      const signer = deps.signerProviderFactory(resolved.value.identityId);
      const keyResult = await signer.getXmtpIdentityKey(
        resolved.value.identityId,
      );
      if (Result.isError(keyResult)) return keyResult;

      // Strip 0x prefix for the generator
      const walletPrivateKeyHex = keyResult.value.startsWith("0x")
        ? keyResult.value.slice(2)
        : keyResult.value;

      // Generate a random invite tag
      const tagBytes = crypto.getRandomValues(new Uint8Array(10));
      const inviteTag = Array.from(tagBytes, (b) =>
        b.toString(36).padStart(2, "0"),
      )
        .join("")
        .slice(0, 10);

      const env =
        deps.config.env === "dev" || deps.config.env === "local"
          ? (deps.config.env as "dev" | "local")
          : ("production" as const);

      const urlResult = await generateConvosInviteUrl({
        conversationId: input.groupId,
        creatorInboxId: managed.inboxId,
        walletPrivateKeyHex,
        inviteTag,
        name: input.name ?? groupResult.value.name,
        description: input.description ?? groupResult.value.description,
        env,
      });

      if (Result.isError(urlResult)) return urlResult;

      return Result.ok({
        inviteUrl: urlResult.value,
        groupId: input.groupId,
        groupName: groupResult.value.name,
        creatorInboxId: managed.inboxId,
        inviteTag,
      });
    },
    cli: {
      command: "conversation:invite",
      rpcMethod: "conversation.invite",
      description: "Generate a Convos-compatible invite URL for a group",
    },
    mcp: {
      toolName: "broker/conversation/invite",
      description: "Generate a Convos-compatible invite URL for a group",
      readOnly: true,
    },
  };

  return [
    widenActionSpec(create),
    widenActionSpec(list),
    widenActionSpec(info),
    widenActionSpec(join),
    widenActionSpec(invite),
  ];
}
