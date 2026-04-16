import { Result } from "better-result";
import { z } from "zod";
import type { ActionSpec, OperatorManager } from "@xmtp/signet-contracts";
import {
  InternalError,
  NotFoundError,
  ValidationError,
  createResourceId,
} from "@xmtp/signet-schemas";
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
import { encodeProfileUpdate, MemberKind } from "./convos/profile-messages.js";
import type { SignerProviderFactory } from "./identity-registration.js";

const GroupInfoSchema = z.object({
  chatId: z.string().optional(),
  groupId: z.string(),
  name: z.string(),
  description: z.string(),
  imageUrl: z.string().optional(),
  memberInboxIds: z.array(z.string()),
  createdAt: z.string(),
});

const MembersOutputSchema = z.object({
  chatId: z.string().optional(),
  groupId: z.string(),
  members: z.array(z.string()),
  memberCount: z.number().int().nonnegative(),
});

const CleanupResultSchema = z.object({
  executed: z.boolean(),
  actions: z.array(z.string()),
});

const ProfileSourceSchema = z.enum(["explicit", "operator-default"]);

const ProfileUpdateResultSchema = z.object({
  chatId: z.string().optional(),
  groupId: z.string(),
  profileName: z.string(),
  profileSource: ProfileSourceSchema,
  profileApplied: z.literal(true),
});

/** Dependencies used to build conversation-related action specs. */
export interface ConversationActionDeps {
  /** Identity store used to resolve conversation creators and viewers. */
  readonly identityStore: SqliteIdentityStore;
  /** Optional operator manager for defaulting human-facing Convos profile names. */
  readonly operatorManager?: OperatorManager;
  /** Lookup for the managed client tied to a signet identity. */
  readonly getManagedClient: (identityId: string) => ManagedClient | undefined;
  /** Optional lookup for the managed client currently responsible for a group. */
  readonly getManagedClientForGroup?: (
    groupId: string,
  ) => ManagedClient | undefined;
  /** Fetch group metadata from XMTP for the provided group id. */
  readonly getGroupInfo: (
    groupId: string,
  ) => Promise<Result<XmtpGroupInfo, SignetError>>;
  /** Optional XMTP client factory for conversation wiring. */
  readonly clientFactory?: XmtpClientFactory;
  /** Optional signer provider factory for identity-bound actions. */
  readonly signerProviderFactory?: SignerProviderFactory;
  /** Optional runtime hook to attach a persisted identity without restart. */
  readonly attachManagedIdentity?: (
    identityId: string,
  ) => Promise<Result<void, SignetError>>;
  /** Optional core config snapshot used by invite/join helpers. */
  readonly config?: Pick<SignetCoreConfig, "dataDir" | "env" | "appVersion">;
  /** Optional ID mapping store for conv_ boundary enforcement. */
  readonly idMappings?: IdMappingStore;
  /** Store an invite tag for a group (for hosted invite verification). */
  readonly storeInviteTag?: (groupId: string, inviteTag: string) => void;
  /** Get the stored invite tag for a group. */
  readonly getInviteTag?: (groupId: string) => string | undefined;
  /** Optional runtime-owned local cleanup hook for destructive chat operations. */
  readonly cleanupLocalState?: (input: {
    chatId?: string;
    groupId: string;
    execute: boolean;
    reason: "rm" | "leave-purge";
  }) => Promise<
    Result<
      {
        executed: boolean;
        actions: readonly string[];
      },
      SignetError
    >
  >;
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

type ProfileSelectionSource = z.infer<typeof ProfileSourceSchema>;

interface ProfileSelection {
  readonly profileName: string;
  readonly profileSource: ProfileSelectionSource;
}

async function resolveProfileSelection(
  operatorManager: OperatorManager | undefined,
  input: {
    readonly operatorId?: string | undefined;
    readonly profileName?: string | undefined;
  },
): Promise<Result<ProfileSelection | null, SignetError>> {
  if (input.profileName !== undefined) {
    return Result.ok({
      profileName: input.profileName,
      profileSource: "explicit",
    });
  }

  if (input.operatorId === undefined) {
    return Result.ok(null);
  }

  if (!operatorManager) {
    return Result.err(
      InternalError.create(
        "OperatorManager not initialized before resolving profile defaults",
      ) as SignetError,
    );
  }

  const operatorResult = await operatorManager.lookup(input.operatorId);
  if (Result.isError(operatorResult)) return operatorResult;

  return Result.ok({
    profileName: operatorResult.value.config.label,
    profileSource: "operator-default",
  });
}

async function resolveManagedClientForGroup(
  deps: ConversationActionDeps,
  groupId: string,
  identityLabel?: string,
): Promise<Result<ManagedClient, SignetError>> {
  if (identityLabel !== undefined) {
    const resolved = await resolveIdentity(deps.identityStore, identityLabel);
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
    return Result.ok(managed);
  }

  const byGroup = deps.getManagedClientForGroup?.(groupId);
  if (byGroup) {
    return Result.ok(byGroup);
  }

  const fallback = await resolveIdentity(deps.identityStore, undefined);
  if (Result.isError(fallback)) return fallback;

  const managed = deps.getManagedClient(fallback.value.identityId);
  if (!managed) {
    return Result.err(
      NotFoundError.create(
        "managed-client",
        fallback.value.identityId,
      ) as SignetError,
    );
  }
  return Result.ok(managed);
}

async function runLocalCleanup(
  deps: ConversationActionDeps,
  input: {
    chatId?: string;
    groupId: string;
    execute: boolean;
    reason: "rm" | "leave-purge";
  },
): Promise<
  Result<
    {
      executed: boolean;
      actions: readonly string[];
    },
    SignetError
  >
> {
  if (!deps.cleanupLocalState) {
    return Result.ok({
      executed: input.execute,
      actions: [],
    });
  }
  return deps.cleanupLocalState(input);
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
      operatorId?: string | undefined;
      profileName?: string | undefined;
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
      profileName?: string | undefined;
      profileSource?: ProfileSelectionSource | undefined;
      profileApplied?: boolean | undefined;
    },
    SignetError
  > = {
    id: "chat.join",
    description: "Join a Convos conversation via invite URL",
    intent: "write",
    input: z.object({
      inviteUrl: z.string(),
      label: z.string().optional(),
      operatorId: z.string().optional(),
      profileName: z.string().optional(),
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
      const profileSelectionResult = await resolveProfileSelection(
        deps.operatorManager,
        input,
      );
      if (Result.isError(profileSelectionResult)) return profileSelectionResult;
      const profileSelection = profileSelectionResult.value;

      const joinOptions: {
        label?: string;
        maxPollAttempts?: number;
        profileName?: string;
      } = {};
      if (input.label !== undefined) joinOptions.label = input.label;
      if (maxPollAttempts !== undefined)
        joinOptions.maxPollAttempts = maxPollAttempts;
      if (profileSelection) {
        joinOptions.profileName = profileSelection.profileName;
      }

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

      if (deps.attachManagedIdentity) {
        const attachResult = await deps.attachManagedIdentity(
          joinResult.value.identityId,
        );
        // The durable join already succeeded at this point. If runtime
        // hydration fails, return success and let the daemon recover the
        // identity on the next attach or restart instead of encouraging
        // duplicate join retries.
        void attachResult;
      }

      const chatId = ensureLocalId(deps.idMappings, joinResult.value.groupId);
      return Result.ok({
        ...joinResult.value,
        chatId,
        ...(profileSelection
          ? { profileSource: profileSelection.profileSource }
          : {}),
      });
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
      const managedResult = await resolveManagedClientForGroup(
        deps,
        groupId,
        input.identityLabel,
      );
      if (Result.isError(managedResult)) return managedResult;
      const managed = managedResult.value;

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

  const update: ActionSpec<
    {
      chatId: string;
      name?: string | undefined;
      description?: string | undefined;
      imageUrl?: string | undefined;
    },
    XmtpGroupInfo & { chatId?: string | undefined },
    SignetError
  > = {
    id: "chat.update",
    description: "Update group conversation metadata",
    intent: "write",
    input: z
      .object({
        chatId: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        imageUrl: z.string().optional(),
      })
      .refine(
        (value) =>
          value.name !== undefined ||
          value.description !== undefined ||
          value.imageUrl !== undefined,
        {
          message: "At least one metadata field must be provided",
          path: ["chatId"],
        },
      ),
    output: GroupInfoSchema,
    handler: async (input) => {
      const groupId = resolveGroupId(deps.idMappings, input.chatId);
      const managedResult = await resolveManagedClientForGroup(deps, groupId);
      if (Result.isError(managedResult)) return managedResult;

      const changes: {
        name?: string;
        description?: string;
        imageUrl?: string;
      } = {};
      if (input.name !== undefined) changes.name = input.name;
      if (input.description !== undefined) {
        changes.description = input.description;
      }
      if (input.imageUrl !== undefined) changes.imageUrl = input.imageUrl;

      const updateResult = await managedResult.value.client.updateGroupMetadata(
        groupId,
        changes,
      );
      if (Result.isError(updateResult)) return updateResult;

      const groupResult = await deps.getGroupInfo(groupId);
      if (Result.isError(groupResult)) return groupResult;

      return Result.ok({ ...groupResult.value, chatId: input.chatId });
    },
    cli: {
      command: "chat:update",
    },
    mcp: {},
    http: {
      auth: "admin",
    },
  };

  const updateProfile: ActionSpec<
    {
      chatId: string;
      identityLabel?: string | undefined;
      operatorId?: string | undefined;
      profileName?: string | undefined;
    },
    {
      chatId?: string | undefined;
      groupId: string;
      profileName: string;
      profileSource: ProfileSelectionSource;
      profileApplied: true;
    },
    SignetError
  > = {
    id: "chat.update-profile",
    description: "Publish a Convos profile update for a group identity",
    intent: "write",
    input: z
      .object({
        chatId: z.string(),
        identityLabel: z.string().optional(),
        operatorId: z.string().optional(),
        profileName: z.string().optional(),
      })
      .refine(
        (value) =>
          value.profileName !== undefined || value.operatorId !== undefined,
        {
          message: "Provide a profile name or operator ID",
          path: ["chatId"],
        },
      ),
    output: ProfileUpdateResultSchema,
    handler: async (input) => {
      const groupId = resolveGroupId(deps.idMappings, input.chatId);
      const managedResult = await resolveManagedClientForGroup(
        deps,
        groupId,
        input.identityLabel,
      );
      if (Result.isError(managedResult)) return managedResult;

      const profileSelectionResult = await resolveProfileSelection(
        deps.operatorManager,
        input,
      );
      if (Result.isError(profileSelectionResult)) return profileSelectionResult;

      const profileSelection = profileSelectionResult.value;
      if (!profileSelection) {
        return Result.err(
          ValidationError.create(
            "profileName",
            "A profile name or operator default is required",
          ) as SignetError,
        );
      }

      const updateResult = await managedResult.value.client.sendMessage(
        groupId,
        encodeProfileUpdate({
          name: profileSelection.profileName,
          memberKind: MemberKind.Agent,
        }),
        "convos.org/profile_update:1.0",
      );
      if (Result.isError(updateResult)) return updateResult;

      return Result.ok({
        chatId: input.chatId,
        groupId,
        profileName: profileSelection.profileName,
        profileSource: profileSelection.profileSource,
        profileApplied: true,
      });
    },
    cli: {
      command: "chat:update-profile",
    },
    mcp: {},
    http: {
      auth: "admin",
    },
  };

  const leave: ActionSpec<
    { chatId: string; purge?: boolean | undefined },
    {
      chatId?: string | undefined;
      groupId: string;
      leftGroup: true;
      purged: boolean;
      cleanup?:
        | {
            executed: boolean;
            actions: readonly string[];
          }
        | undefined;
    },
    SignetError
  > = {
    id: "chat.leave",
    description: "Leave a group conversation",
    intent: "write",
    input: z.object({
      chatId: z.string(),
      purge: z.boolean().optional(),
    }),
    output: z.object({
      chatId: z.string().optional(),
      groupId: z.string(),
      leftGroup: z.literal(true),
      purged: z.boolean(),
      cleanup: CleanupResultSchema.optional(),
    }),
    handler: async (input) => {
      const groupId = resolveGroupId(deps.idMappings, input.chatId);
      const managedResult = await resolveManagedClientForGroup(deps, groupId);
      if (Result.isError(managedResult)) return managedResult;

      const leaveResult = await managedResult.value.client.leaveGroup(groupId);
      if (Result.isError(leaveResult)) return leaveResult;

      if (input.purge === true) {
        const cleanupResult = await runLocalCleanup(deps, {
          chatId: input.chatId,
          groupId,
          execute: true,
          reason: "leave-purge",
        });
        if (Result.isError(cleanupResult)) return cleanupResult;

        return Result.ok({
          chatId: input.chatId,
          groupId,
          leftGroup: true,
          purged: true,
          cleanup: cleanupResult.value,
        });
      }

      return Result.ok({
        chatId: input.chatId,
        groupId,
        leftGroup: true,
        purged: false,
      });
    },
    cli: {
      command: "chat:leave",
    },
    mcp: {},
    http: {
      auth: "admin",
    },
  };

  const removeLocal: ActionSpec<
    { chatId: string; force?: boolean | undefined },
    {
      chatId?: string | undefined;
      groupId: string;
      removed: boolean;
      cleanup: {
        executed: boolean;
        actions: readonly string[];
      };
    },
    SignetError
  > = {
    id: "chat.rm",
    description: "Remove local conversation state without leaving the group",
    intent: "write",
    input: z.object({
      chatId: z.string(),
      force: z.boolean().optional(),
    }),
    output: z.object({
      chatId: z.string().optional(),
      groupId: z.string(),
      removed: z.boolean(),
      cleanup: CleanupResultSchema,
    }),
    handler: async (input) => {
      const groupId = resolveGroupId(deps.idMappings, input.chatId);
      const cleanupResult = await runLocalCleanup(deps, {
        chatId: input.chatId,
        groupId,
        execute: input.force === true,
        reason: "rm",
      });
      if (Result.isError(cleanupResult)) return cleanupResult;

      return Result.ok({
        chatId: input.chatId,
        groupId,
        removed: cleanupResult.value.executed,
        cleanup: cleanupResult.value,
      });
    },
    cli: {
      command: "chat:rm",
    },
    mcp: {},
    http: {
      auth: "admin",
    },
  };

  const removeMember: ActionSpec<
    {
      chatId: string;
      inboxId: string;
      identityLabel?: string | undefined;
    },
    { chatId?: string | undefined; groupId: string; memberCount: number },
    SignetError
  > = {
    id: "chat.remove-member",
    description: "Remove a member from a group conversation",
    intent: "write",
    input: z.object({
      chatId: z.string(),
      inboxId: z.string(),
      identityLabel: z.string().optional(),
    }),
    handler: async (input) => {
      const groupId = resolveGroupId(deps.idMappings, input.chatId);
      const managedResult = await resolveManagedClientForGroup(
        deps,
        groupId,
        input.identityLabel,
      );
      if (Result.isError(managedResult)) return managedResult;

      const removeResult = await managedResult.value.client.removeMembers(
        groupId,
        [input.inboxId],
      );
      if (Result.isError(removeResult)) return removeResult;

      const groupResult = await deps.getGroupInfo(groupId);
      if (Result.isError(groupResult)) return groupResult;

      return Result.ok({
        chatId: input.chatId,
        groupId,
        memberCount: groupResult.value.memberInboxIds.length,
      });
    },
    cli: {
      command: "chat:remove-member",
    },
    mcp: {},
    http: {
      auth: "admin",
    },
  };

  const promoteMember: ActionSpec<
    { chatId: string; inboxId: string },
    {
      chatId?: string | undefined;
      groupId: string;
      inboxId: string;
      role: "admin";
    },
    SignetError
  > = {
    id: "chat.promote-member",
    description: "Promote a member to admin",
    intent: "write",
    input: z.object({
      chatId: z.string(),
      inboxId: z.string(),
    }),
    handler: async (input) => {
      const groupId = resolveGroupId(deps.idMappings, input.chatId);
      const managedResult = await resolveManagedClientForGroup(deps, groupId);
      if (Result.isError(managedResult)) return managedResult;

      const promoteResult = await managedResult.value.client.addAdmin(
        groupId,
        input.inboxId,
      );
      if (Result.isError(promoteResult)) return promoteResult;

      return Result.ok({
        chatId: input.chatId,
        groupId,
        inboxId: input.inboxId,
        role: "admin",
      });
    },
    cli: {
      command: "chat:promote-member",
    },
    mcp: {},
    http: {
      auth: "admin",
    },
  };

  const demoteMember: ActionSpec<
    { chatId: string; inboxId: string },
    {
      chatId?: string | undefined;
      groupId: string;
      inboxId: string;
      role: "member";
    },
    SignetError
  > = {
    id: "chat.demote-member",
    description: "Demote an admin back to member",
    intent: "write",
    input: z.object({
      chatId: z.string(),
      inboxId: z.string(),
    }),
    handler: async (input) => {
      const groupId = resolveGroupId(deps.idMappings, input.chatId);
      const managedResult = await resolveManagedClientForGroup(deps, groupId);
      if (Result.isError(managedResult)) return managedResult;

      const demoteResult = await managedResult.value.client.removeAdmin(
        groupId,
        input.inboxId,
      );
      if (Result.isError(demoteResult)) return demoteResult;

      return Result.ok({
        chatId: input.chatId,
        groupId,
        inboxId: input.inboxId,
        role: "member",
      });
    },
    cli: {
      command: "chat:demote-member",
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

  return [
    create,
    list,
    info,
    update,
    updateProfile,
    join,
    invite,
    leave,
    removeLocal,
    addMember,
    removeMember,
    promoteMember,
    demoteMember,
    members,
  ];
}
