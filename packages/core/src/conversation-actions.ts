import { Result } from "better-result";
import { z } from "zod";
import type { ActionSpec } from "@xmtp/signet-contracts";
import { NotFoundError } from "@xmtp/signet-schemas";
import type { SignetError } from "@xmtp/signet-schemas";
import type { SqliteIdentityStore } from "./identity-store.js";
import type { ManagedClient } from "./client-registry.js";
import type {
  XmtpClientFactory,
  XmtpGroupInfo,
} from "./xmtp-client-factory.js";
import type { SignetCoreConfig } from "./config.js";
import { joinConversation } from "./convos/join.js";
import { generateConvosInviteUrl } from "./convos/invite-generator.js";
import type { SignerProviderFactory } from "./identity-registration.js";

const GroupInfoSchema = z.object({
  groupId: z.string(),
  name: z.string(),
  description: z.string(),
  memberInboxIds: z.array(z.string()),
  createdAt: z.string(),
});

const MembersOutputSchema = z.object({
  groupId: z.string(),
  members: z.array(z.string()),
  memberCount: z.number().int().nonnegative(),
});

/** Dependencies used to build conversation-related action specs. */
export interface ConversationActionDeps {
  /** Identity store used to resolve conversation creators and viewers. */
  readonly identityStore: SqliteIdentityStore;
  /** Lookup for the managed client tied to a signet identity. */
  readonly getManagedClient: (identityId: string) => ManagedClient | undefined;
  /** Fetch group metadata from XMTP for the provided group id. */
  readonly getGroupInfo: (
    groupId: string,
  ) => Promise<Result<XmtpGroupInfo, SignetError>>;
  /** Optional XMTP client factory for conversation wiring. */
  readonly clientFactory?: XmtpClientFactory;
  /** Optional signer provider factory for identity-bound actions. */
  readonly signerProviderFactory?: SignerProviderFactory;
  /** Optional core config snapshot used by invite/join helpers. */
  readonly config?: Pick<SignetCoreConfig, "dataDir" | "env" | "appVersion">;
}

/**
 * Resolve an identity by label, or fall back to the first identity
 * in the store when no label is provided.
 */
async function resolveIdentity(
  identityStore: SqliteIdentityStore,
  label: string | undefined,
): Promise<
  Result<{ identityId: string; inboxId: string | null }, SignetError>
> {
  if (label) {
    const identity = await identityStore.getByLabel(label);
    if (!identity) {
      return Result.err(NotFoundError.create("identity", label) as SignetError);
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
      NotFoundError.create("identity", "(none)") as SignetError,
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
): ActionSpec<any, any, SignetError>[] {
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
    SignetError
  > = {
    id: "conversation.create",
    description: "Create a new group conversation",
    intent: "write",
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
          ) as SignetError,
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
    },
    mcp: {},
    http: {
      auth: "admin",
    },
  };

  const list: ActionSpec<
    { identityLabel?: string | undefined },
    { groups: readonly XmtpGroupInfo[] },
    SignetError
  > = {
    id: "conversation.list",
    description: "List group conversations",
    intent: "read",
    idempotent: true,
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
          ) as SignetError,
        );
      }

      const groupsResult = await managed.client.listGroups();
      if (Result.isError(groupsResult)) return groupsResult;

      return Result.ok({ groups: groupsResult.value });
    },
    cli: {
      command: "conversation:list",
    },
    mcp: {},
    http: {
      auth: "admin",
    },
  };

  const info: ActionSpec<{ groupId: string }, XmtpGroupInfo, SignetError> = {
    id: "conversation.info",
    description: "Get group conversation details",
    intent: "read",
    idempotent: true,
    input: z.object({
      groupId: z.string(),
    }),
    output: GroupInfoSchema,
    examples: [
      {
        name: "group info",
        input: {
          groupId: "group-1",
        },
        expected: {
          groupId: "group-1",
          name: "Example Group",
          description: "Example description",
          memberInboxIds: ["inbox-a", "inbox-b"],
          createdAt: "2026-03-30T00:00:00.000Z",
        },
      },
    ],
    handler: async (input) => deps.getGroupInfo(input.groupId),
    cli: {
      command: "conversation:info",
    },
    mcp: {},
    http: {
      auth: "admin",
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
    SignetError
  > = {
    id: "conversation.join",
    description: "Join a Convos conversation via invite URL",
    intent: "write",
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
          ) as SignetError,
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
    },
    mcp: {},
    http: {
      auth: "admin",
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
    SignetError
  > = {
    id: "conversation.invite",
    description: "Generate a Convos-compatible invite URL for a group",
    intent: "write",
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
          ) as SignetError,
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
          ) as SignetError,
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
    },
    mcp: {},
    http: {
      auth: "admin",
    },
  };

  const addMember: ActionSpec<
    {
      groupId: string;
      inboxId: string;
      identityLabel?: string | undefined;
    },
    { groupId: string; memberCount: number },
    SignetError
  > = {
    id: "conversation.add-member",
    description: "Add a member to a group conversation",
    intent: "write",
    input: z.object({
      groupId: z.string(),
      inboxId: z.string(),
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
          ) as SignetError,
        );
      }

      const addResult = await managed.client.addMembers(input.groupId, [
        input.inboxId,
      ]);
      if (Result.isError(addResult)) return addResult;

      // Fetch updated group info for member count
      const groupResult = await deps.getGroupInfo(input.groupId);
      if (Result.isError(groupResult)) return groupResult;

      return Result.ok({
        groupId: input.groupId,
        memberCount: groupResult.value.memberInboxIds.length,
      });
    },
    cli: {
      command: "conversation:add-member",
    },
    mcp: {},
    http: {
      auth: "admin",
    },
  };

  const members: ActionSpec<
    { groupId: string },
    {
      groupId: string;
      members: readonly string[];
      memberCount: number;
    },
    SignetError
  > = {
    id: "conversation.members",
    description: "List members of a group conversation",
    intent: "read",
    idempotent: true,
    input: z.object({
      groupId: z.string(),
    }),
    output: MembersOutputSchema,
    examples: [
      {
        name: "member list",
        input: {
          groupId: "group-1",
        },
        expected: {
          groupId: "group-1",
          members: ["inbox-a", "inbox-b"],
          memberCount: 2,
        },
      },
    ],
    handler: async (input) => {
      const groupResult = await deps.getGroupInfo(input.groupId);
      if (Result.isError(groupResult)) return groupResult;

      return Result.ok({
        groupId: input.groupId,
        members: groupResult.value.memberInboxIds,
        memberCount: groupResult.value.memberInboxIds.length,
      });
    },
    cli: {
      command: "conversation:members",
    },
    mcp: {},
    http: {
      auth: "admin",
    },
  };

  return [create, list, info, join, invite, addMember, members];
}
