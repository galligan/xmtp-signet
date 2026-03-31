import { Result } from "better-result";
import { z } from "zod";
import type { ActionSpec } from "@xmtp/signet-contracts";
import { NotFoundError, createResourceId } from "@xmtp/signet-schemas";
import type { SignetError, IdMappingStore } from "@xmtp/signet-schemas";
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
  chatId: z.string().optional(),
  groupId: z.string(),
  name: z.string(),
  description: z.string(),
  memberInboxIds: z.array(z.string()),
  createdAt: z.string(),
});

const MembersOutputSchema = z.object({
  chatId: z.string().optional(),
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
  /** Optional ID mapping store for conv_ boundary enforcement. */
  readonly idMappings?: IdMappingStore;
  /** Store an invite tag for a group (for hosted invite verification). */
  readonly storeInviteTag?: (groupId: string, inviteTag: string) => void;
  /** Get the stored invite tag for a group. */
  readonly getInviteTag?: (groupId: string) => string | undefined;
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

/**
 * Resolve a chatId (which may be a conv_ local ID or a raw groupId)
 * to the underlying network groupId using the mapping store.
 */
function resolveGroupId(
  idMappings: IdMappingStore | undefined,
  chatId: string,
): string {
  if (!idMappings) return chatId;
  const networkId = idMappings.getNetwork(chatId);
  return networkId ?? chatId;
}

/**
 * Ensure a groupId has a conv_ local mapping. Returns the local ID,
 * creating one if it doesn't already exist.
 */
function ensureLocalId(
  idMappings: IdMappingStore | undefined,
  groupId: string,
): string | undefined {
  if (!idMappings) return undefined;
  const existing = idMappings.getLocal(groupId);
  if (existing) return existing;
  const localId = createResourceId("conversation");
  idMappings.set(groupId, localId, "conversation");
  return localId;
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
      chatId?: string | undefined;
      groupId: string;
      name: string;
      creatorInboxId: string;
      memberCount: number;
    },
    SignetError
  > = {
    id: "chat.create",
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
      const chatId = ensureLocalId(deps.idMappings, group.groupId);
      return Result.ok({
        chatId,
        groupId: group.groupId,
        name: group.name,
        creatorInboxId: managed.inboxId,
        memberCount: group.memberInboxIds.length,
      });
    },
    cli: {
      command: "chat:create",
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
    id: "chat.list",
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

      const groups = groupsResult.value.map((g) => ({
        ...g,
        chatId: ensureLocalId(deps.idMappings, g.groupId),
      }));

      return Result.ok({ groups });
    },
    cli: {
      command: "chat:list",
    },
    mcp: {},
    http: {
      auth: "admin",
    },
  };

  const info: ActionSpec<
    { chatId: string },
    XmtpGroupInfo & { chatId?: string | undefined },
    SignetError
  > = {
    id: "chat.info",
    description: "Get group conversation details",
    intent: "read",
    idempotent: true,
    input: z.object({
      chatId: z.string(),
    }),
    output: GroupInfoSchema,
    examples: [
      {
        name: "group info by conv_ ID",
        input: {
          chatId: "conv_0123456789abcdef",
        },
        expected: {
          chatId: "conv_0123456789abcdef",
          groupId: "resolved-network-group-id",
          name: "Example Group",
          description: "Example description",
          memberInboxIds: ["inbox-a", "inbox-b"],
          createdAt: "2026-03-30T00:00:00.000Z",
        },
      },
    ],
    handler: async (input) => {
      const groupId = resolveGroupId(deps.idMappings, input.chatId);
      const result = await deps.getGroupInfo(groupId);
      if (Result.isError(result)) return result;
      return Result.ok({ ...result.value, chatId: input.chatId });
    },
    cli: {
      command: "chat:info",
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
      chatId?: string | undefined;
      groupId: string;
      identityId: string;
      inboxId: string;
      inviteTag: string;
      groupName: string | undefined;
      creatorInboxId: string;
    },
    SignetError
  > = {
    id: "chat.join",
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

      const joinResult = await joinConversation(
        {
          identityStore: deps.identityStore,
          clientFactory: deps.clientFactory,
          signerProviderFactory: deps.signerProviderFactory,
          config: deps.config,
        },
        input.inviteUrl,
        joinOptions,
      );
      if (Result.isError(joinResult)) return joinResult;

      const chatId = ensureLocalId(deps.idMappings, joinResult.value.groupId);
      return Result.ok({ ...joinResult.value, chatId });
    },
    cli: {
      command: "chat:join",
    },
    mcp: {},
    http: {
      auth: "admin",
    },
  };

  const invite: ActionSpec<
    {
      chatId: string;
      identityLabel?: string | undefined;
      name?: string | undefined;
      description?: string | undefined;
    },
    {
      inviteUrl: string;
      chatId?: string | undefined;
      groupId: string;
      groupName: string;
      creatorInboxId: string;
      inviteTag: string;
    },
    SignetError
  > = {
    id: "chat.invite",
    description: "Generate a Convos-compatible invite URL for a group",
    intent: "write",
    input: z.object({
      chatId: z.string(),
      identityLabel: z.string().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
    }),
    handler: async (input) => {
      const groupId = resolveGroupId(deps.idMappings, input.chatId);
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
      const groupResult = await deps.getGroupInfo(groupId);
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
        conversationId: groupId,
        creatorInboxId: managed.inboxId,
        walletPrivateKeyHex,
        inviteTag,
        name: input.name ?? groupResult.value.name,
        description: input.description ?? groupResult.value.description,
        env,
      });

      if (Result.isError(urlResult)) return urlResult;

      // Persist the invite tag so the host-side join processor can verify it
      if (deps.storeInviteTag) {
        deps.storeInviteTag(groupId, inviteTag);
      }

      return Result.ok({
        inviteUrl: urlResult.value,
        chatId: input.chatId,
        groupId,
        groupName: groupResult.value.name,
        creatorInboxId: managed.inboxId,
        inviteTag,
      });
    },
    cli: {
      command: "chat:invite",
    },
    mcp: {},
    http: {
      auth: "admin",
    },
  };

  const addMember: ActionSpec<
    {
      chatId: string;
      inboxId: string;
      identityLabel?: string | undefined;
    },
    { chatId?: string | undefined; groupId: string; memberCount: number },
    SignetError
  > = {
    id: "chat.add-member",
    description: "Add a member to a group conversation",
    intent: "write",
    input: z.object({
      chatId: z.string(),
      inboxId: z.string(),
      identityLabel: z.string().optional(),
    }),
    handler: async (input) => {
      const groupId = resolveGroupId(deps.idMappings, input.chatId);
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

      const addResult = await managed.client.addMembers(groupId, [
        input.inboxId,
      ]);
      if (Result.isError(addResult)) return addResult;

      // Fetch updated group info for member count
      const groupResult = await deps.getGroupInfo(groupId);
      if (Result.isError(groupResult)) return groupResult;

      return Result.ok({
        chatId: input.chatId,
        groupId,
        memberCount: groupResult.value.memberInboxIds.length,
      });
    },
    cli: {
      command: "chat:add-member",
    },
    mcp: {},
    http: {
      auth: "admin",
    },
  };

  const members: ActionSpec<
    { chatId: string },
    {
      chatId?: string | undefined;
      groupId: string;
      members: readonly string[];
      memberCount: number;
    },
    SignetError
  > = {
    id: "chat.members",
    description: "List members of a group conversation",
    intent: "read",
    idempotent: true,
    input: z.object({
      chatId: z.string(),
    }),
    output: MembersOutputSchema,
    examples: [
      {
        name: "member list by conv_ ID",
        input: {
          chatId: "conv_0123456789abcdef",
        },
        expected: {
          chatId: "conv_0123456789abcdef",
          groupId: "resolved-network-group-id",
          members: ["inbox-a", "inbox-b"],
          memberCount: 2,
        },
      },
    ],
    handler: async (input) => {
      const groupId = resolveGroupId(deps.idMappings, input.chatId);
      const groupResult = await deps.getGroupInfo(groupId);
      if (Result.isError(groupResult)) return groupResult;

      return Result.ok({
        chatId: input.chatId,
        groupId,
        members: groupResult.value.memberInboxIds,
        memberCount: groupResult.value.memberInboxIds.length,
      });
    },
    cli: {
      command: "chat:members",
    },
    mcp: {},
    http: {
      auth: "admin",
    },
  };

  return [create, list, info, join, invite, addMember, members];
}
