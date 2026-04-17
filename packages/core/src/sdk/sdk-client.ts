import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import {
  InternalError,
  NotFoundError,
  PermissionError,
  ValidationError,
} from "@xmtp/signet-schemas";
import type {
  XmtpClient,
  XmtpDecodedMessage,
  XmtpDmInfo,
  XmtpGroupInfo,
  ListMessagesOptions,
  MessageStream,
  DmStream,
  GroupStream,
  ConsentEntityType,
  ConsentState,
} from "../xmtp-client-factory.js";
import { wrapSdkCall } from "./error-mapping.js";
import { toGroupInfo, toDecodedMessage } from "./type-mapping.js";
import {
  wrapMessageStream,
  wrapDmStream,
  wrapGroupStream,
} from "./stream-wrappers.js";
import { createConvosOnboardingScheme } from "../convos/onboarding-scheme.js";
import type { OnboardingScheme } from "../schemes/onboarding-scheme.js";
import type {
  SdkClientShape,
  SdkGroupShape,
  SdkConsentEntityType,
  SdkConsentState,
} from "./sdk-types.js";

/** Options for creating an SdkClient adapter. */
export interface SdkClientOptions {
  /** The live or mock SDK Client instance. */
  readonly client: SdkClientShape;
  /** Timeout for sync operations in milliseconds. */
  readonly syncTimeoutMs: number;
  /** Onboarding scheme that owns custom content-type handling. */
  readonly onboardingScheme?: OnboardingScheme;
}

const DEFAULT_ONBOARDING_SCHEME = createConvosOnboardingScheme();

/**
 * Look up a group by ID, returning NotFoundError if missing.
 * Wraps the SDK call so that SDK exceptions become Result errors.
 */
async function getGroup(
  client: SdkClientShape,
  groupId: string,
): Promise<Result<SdkGroupShape, SignetError>> {
  const result = await wrapSdkCall(
    async () => client.conversations.getConversationById(groupId),
    "getConversationById",
    { resourceType: "group", resourceId: groupId },
  );
  if (result.isErr()) return result;
  if (!result.value) {
    return Result.err(NotFoundError.create("group", groupId));
  }
  return Result.ok(result.value);
}

/**
 * Extract text from message content. Handles plain strings, objects
 * with a `text` property (text content type), and falls back to JSON
 * serialization for other structured payloads.
 */
function resolveTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (typeof content === "object" && content !== null && "text" in content) {
    const record = content as Record<string, unknown>;
    const text = record["text"];
    if (typeof text === "string") {
      return text;
    }
  }
  return JSON.stringify(content);
}

/** Map our consent entity types to SDK enum string equivalents. */
function toSdkConsentEntityType(
  entityType: ConsentEntityType,
): SdkConsentEntityType {
  switch (entityType) {
    case "inbox_id":
      return "InboxId";
    case "group_id":
      return "GroupId";
    default:
      throw new Error(`Unknown consent entity type: ${entityType}`);
  }
}

/** Map SDK consent state to our lowercase string equivalents. */
function fromSdkConsentState(state: SdkConsentState): ConsentState {
  switch (state) {
    case "Allowed":
      return "allowed";
    case "Denied":
      return "denied";
    default:
      return "unknown";
  }
}

/** Map our consent state to SDK enum string equivalents. */
function toSdkConsentState(state: "allowed" | "denied"): SdkConsentState {
  return state === "allowed" ? "Allowed" : "Denied";
}

/**
 * Production XmtpClient backed by a live or mock @xmtp/node-sdk Client.
 *
 * Wraps every SDK call in try/catch, converting exceptions to Result errors.
 */
export function createSdkClient(options: SdkClientOptions): XmtpClient {
  const {
    client,
    syncTimeoutMs,
    onboardingScheme = DEFAULT_ONBOARDING_SCHEME,
  } = options;

  const isOnboardingContentType = (contentType: string): boolean =>
    contentType === onboardingScheme.joinRequestContentType() ||
    contentType === onboardingScheme.errorContentType() ||
    contentType === onboardingScheme.profileUpdateContentType() ||
    contentType === onboardingScheme.profileSnapshotContentType();

  return {
    get inboxId(): string {
      return client.inboxId;
    },

    async sendMessage(
      groupId: string,
      content: unknown,
      contentType?: string,
    ): Promise<Result<string, SignetError>> {
      const groupResult = await getGroup(client, groupId);
      if (groupResult.isErr()) return groupResult;
      const group = groupResult.value;

      // For custom content types, use group.send() with encoded content
      if (contentType && contentType !== "xmtp.org/text:1.0") {
        if (
          isOnboardingContentType(contentType) &&
          onboardingScheme.isEncodedContent(content)
        ) {
          return wrapSdkCall(async () => group.send(content), "sendMessage");
        }
        // Parse "authority/type:major.minor" format
        const slashIdx = contentType.indexOf("/");
        const colonIdx = contentType.indexOf(":");
        const authorityId =
          slashIdx > 0 ? contentType.slice(0, slashIdx) : "xmtp.org";
        const typeId =
          slashIdx > 0
            ? contentType.slice(
                slashIdx + 1,
                colonIdx > slashIdx ? colonIdx : undefined,
              )
            : contentType;
        const versionStr =
          colonIdx > 0 ? contentType.slice(colonIdx + 1) : "1.0";
        const [majorStr, minorStr] = versionStr.split(".");
        const encoded = {
          type: {
            authorityId,
            typeId,
            versionMajor: parseInt(majorStr ?? "1", 10),
            versionMinor: parseInt(minorStr ?? "0", 10),
          },
          content: new TextEncoder().encode(
            typeof content === "string" ? content : JSON.stringify(content),
          ),
        };
        return wrapSdkCall(async () => group.send(encoded), "sendMessage");
      }

      const text = resolveTextContent(content);
      return wrapSdkCall(async () => group.sendText(text), "sendMessage");
    },

    async createDm(
      peerInboxId: string,
    ): Promise<Result<XmtpDmInfo, SignetError>> {
      return wrapSdkCall(async () => {
        const dm = await client.conversations.createDm(peerInboxId);
        return { dmId: dm.id, peerInboxId };
      }, "createDm");
    },

    async sendDmMessage(
      dmId: string,
      text: string,
    ): Promise<Result<string, SignetError>> {
      const dmResult = await getGroup(client, dmId);
      if (dmResult.isErr()) return dmResult;

      return wrapSdkCall(
        async () => dmResult.value.sendText(text),
        "sendDmMessage",
      );
    },

    async syncAll(): Promise<Result<void, SignetError>> {
      return wrapSdkCall(
        async () => {
          await client.conversations.sync();
          await client.conversations.syncAll();
        },
        "syncAll",
        { timeoutMs: syncTimeoutMs },
      );
    },

    async syncGroup(groupId: string): Promise<Result<void, SignetError>> {
      const groupResult = await getGroup(client, groupId);
      if (groupResult.isErr()) return groupResult;

      return wrapSdkCall(async () => groupResult.value.sync(), "syncGroup", {
        resourceType: "group",
        resourceId: groupId,
      });
    },

    async getGroupInfo(
      groupId: string,
    ): Promise<Result<XmtpGroupInfo, SignetError>> {
      const groupResult = await getGroup(client, groupId);
      if (groupResult.isErr()) return groupResult;
      const group = groupResult.value;

      return wrapSdkCall(
        async () => {
          const members = await group.members();
          return toGroupInfo(group, members);
        },
        "getGroupInfo",
        { resourceType: "group", resourceId: groupId },
      );
    },

    async listGroups(): Promise<Result<readonly XmtpGroupInfo[], SignetError>> {
      return wrapSdkCall(async () => {
        const groups = client.conversations.listGroups();
        const results: XmtpGroupInfo[] = [];
        for (const group of groups) {
          const members = await group.members();
          results.push(toGroupInfo(group, members));
        }
        return results;
      }, "listGroups");
    },

    async createGroup(
      memberInboxIds: readonly string[],
      options?: { name?: string },
    ): Promise<Result<XmtpGroupInfo, SignetError>> {
      return wrapSdkCall(async () => {
        const opts = options?.name !== undefined ? { name: options.name } : {};
        const group = await client.conversations.createGroup(
          [...memberInboxIds],
          opts,
        );
        await group.sync();
        const members = await group.members();
        return toGroupInfo(group, members);
      }, "createGroup");
    },

    async addMembers(
      groupId: string,
      inboxIds: readonly string[],
    ): Promise<Result<void, SignetError>> {
      const groupResult = await getGroup(client, groupId);
      if (groupResult.isErr()) return groupResult;

      return wrapSdkCall(
        async () => groupResult.value.addMembers([...inboxIds]),
        "addMembers",
        { resourceType: "group", resourceId: groupId },
      );
    },

    async removeMembers(
      groupId: string,
      inboxIds: readonly string[],
    ): Promise<Result<void, SignetError>> {
      const groupResult = await getGroup(client, groupId);
      if (groupResult.isErr()) return groupResult;

      return wrapSdkCall(
        async () => groupResult.value.removeMembers([...inboxIds]),
        "removeMembers",
        { resourceType: "group", resourceId: groupId },
      );
    },

    async updateGroupMetadata(
      groupId: string,
      changes: {
        name?: string;
        description?: string;
        imageUrl?: string;
      },
    ): Promise<Result<XmtpGroupInfo, SignetError>> {
      if (
        changes.name === undefined &&
        changes.description === undefined &&
        changes.imageUrl === undefined
      ) {
        return Result.err(
          ValidationError.create(
            "changes",
            "At least one metadata field must be provided",
          ),
        );
      }

      const groupResult = await getGroup(client, groupId);
      if (groupResult.isErr()) return groupResult;
      const group = groupResult.value;

      return wrapSdkCall(
        async () => {
          if (changes.name !== undefined) {
            await group.updateName(changes.name);
          }
          if (changes.description !== undefined) {
            await group.updateDescription(changes.description);
          }
          if (changes.imageUrl !== undefined) {
            await group.updateImageUrl(changes.imageUrl);
          }
          await group.sync();
          const members = await group.members();
          return toGroupInfo(group, members);
        },
        "updateGroupMetadata",
        { resourceType: "group", resourceId: groupId },
      );
    },

    async leaveGroup(groupId: string): Promise<Result<void, SignetError>> {
      const groupResult = await getGroup(client, groupId);
      if (groupResult.isErr()) return groupResult;
      const group = groupResult.value;

      const membersResult = await wrapSdkCall(
        async () => group.members(),
        "leaveGroup.members",
        { resourceType: "group", resourceId: groupId },
      );
      if (membersResult.isErr()) return membersResult;

      const selfMember = membersResult.value.find(
        (member) => member.inboxId === client.inboxId,
      );
      if (selfMember?.permissionLevel === "super_admin") {
        return Result.err(
          PermissionError.create(
            "Super admins must transfer ownership before leaving the group",
            { groupId, inboxId: client.inboxId },
          ),
        );
      }

      return wrapSdkCall(
        async () => {
          await group.leaveGroup();
          await group.sync();
        },
        "leaveGroup",
        { resourceType: "group", resourceId: groupId },
      );
    },

    async addAdmin(
      groupId: string,
      inboxId: string,
    ): Promise<Result<void, SignetError>> {
      const groupResult = await getGroup(client, groupId);
      if (groupResult.isErr()) return groupResult;

      return wrapSdkCall(
        async () => groupResult.value.addAdmin(inboxId),
        "addAdmin",
        { resourceType: "group", resourceId: groupId },
      );
    },

    async removeAdmin(
      groupId: string,
      inboxId: string,
    ): Promise<Result<void, SignetError>> {
      const groupResult = await getGroup(client, groupId);
      if (groupResult.isErr()) return groupResult;

      return wrapSdkCall(
        async () => groupResult.value.removeAdmin(inboxId),
        "removeAdmin",
        { resourceType: "group", resourceId: groupId },
      );
    },

    async addSuperAdmin(
      groupId: string,
      inboxId: string,
    ): Promise<Result<void, SignetError>> {
      const groupResult = await getGroup(client, groupId);
      if (groupResult.isErr()) return groupResult;

      return wrapSdkCall(
        async () => groupResult.value.addSuperAdmin(inboxId),
        "addSuperAdmin",
        { resourceType: "group", resourceId: groupId },
      );
    },

    async removeSuperAdmin(
      groupId: string,
      inboxId: string,
    ): Promise<Result<void, SignetError>> {
      const groupResult = await getGroup(client, groupId);
      if (groupResult.isErr()) return groupResult;

      return wrapSdkCall(
        async () => groupResult.value.removeSuperAdmin(inboxId),
        "removeSuperAdmin",
        { resourceType: "group", resourceId: groupId },
      );
    },

    getMessageById(
      messageId: string,
    ): Result<XmtpDecodedMessage | undefined, SignetError> {
      try {
        const message = client.conversations.getMessageById(messageId);
        return Result.ok(message ? toDecodedMessage(message) : undefined);
      } catch (thrown) {
        // Mirror wrapSdkCall error classification for consistency
        const errorMessage =
          thrown instanceof Error ? thrown.message : String(thrown);
        return Result.err(
          InternalError.create(`SDK error (getMessageById): ${errorMessage}`, {
            cause: errorMessage,
          }) as SignetError,
        );
      }
    },

    async listMessages(
      groupId: string,
      options?: ListMessagesOptions,
    ): Promise<Result<readonly XmtpDecodedMessage[], SignetError>> {
      const groupResult = await getGroup(client, groupId);
      if (groupResult.isErr()) return groupResult;
      const group = groupResult.value;

      return wrapSdkCall(
        async () => {
          const sdkOptions: Record<string, unknown> = {};
          if (options?.limit !== undefined) {
            sdkOptions["limit"] = options.limit;
          }
          if (options?.before !== undefined) {
            sdkOptions["sentBeforeNs"] =
              BigInt(new Date(options.before).getTime()) * 1_000_000n;
          }
          if (options?.after !== undefined) {
            sdkOptions["sentAfterNs"] =
              BigInt(new Date(options.after).getTime()) * 1_000_000n;
          }
          if (options?.direction !== undefined) {
            // Map public strings to SDK SortDirection enum values
            sdkOptions["direction"] = options.direction === "ascending" ? 1 : 2;
          }

          const messages = await group.messages(sdkOptions);
          return messages.map((m) => toDecodedMessage(m));
        },
        "listMessages",
        { resourceType: "group", resourceId: groupId },
      );
    },

    async streamAllMessages(): Promise<Result<MessageStream, SignetError>> {
      return wrapSdkCall(async () => {
        // Convos join requests arrive via DM, so the raw stream must include
        // both group and DM traffic.
        const stream = await client.conversations.streamAllMessages();
        return wrapMessageStream(stream);
      }, "streamAllMessages");
    },

    async streamGroups(): Promise<Result<GroupStream, SignetError>> {
      return wrapSdkCall(async () => {
        const stream = await client.conversations.streamGroups();
        return wrapGroupStream(stream);
      }, "streamGroups");
    },

    async streamDms(): Promise<Result<DmStream, SignetError>> {
      return wrapSdkCall(async () => {
        const stream = await client.conversations.streamDms();
        return wrapDmStream(stream);
      }, "streamDms");
    },

    async getConsentState(
      entityType: ConsentEntityType,
      entity: string,
    ): Promise<Result<ConsentState, SignetError>> {
      return wrapSdkCall(async () => {
        const sdkState = await client.preferences.getConsentState(
          toSdkConsentEntityType(entityType),
          entity,
        );
        return fromSdkConsentState(sdkState);
      }, "getConsentState");
    },

    async setConsentState(
      entityType: ConsentEntityType,
      entity: string,
      state: "allowed" | "denied",
    ): Promise<Result<void, SignetError>> {
      return wrapSdkCall(
        async () =>
          client.preferences.setConsentStates([
            {
              entityType: toSdkConsentEntityType(entityType),
              entity,
              state: toSdkConsentState(state),
            },
          ]),
        "setConsentState",
      );
    },
  };
}
