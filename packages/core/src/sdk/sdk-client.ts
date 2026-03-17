import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import { NotFoundError } from "@xmtp/signet-schemas";
import type {
  XmtpClient,
  XmtpDmInfo,
  XmtpGroupInfo,
  MessageStream,
  GroupStream,
} from "../xmtp-client-factory.js";
import { wrapSdkCall } from "./error-mapping.js";
import { toGroupInfo } from "./type-mapping.js";
import { wrapMessageStream, wrapGroupStream } from "./stream-wrappers.js";
import type { SdkClientShape, SdkGroupShape } from "./sdk-types.js";

/** Options for creating an SdkClient adapter. */
export interface SdkClientOptions {
  /** The live or mock SDK Client instance. */
  readonly client: SdkClientShape;
  /** Timeout for sync operations in milliseconds. */
  readonly syncTimeoutMs: number;
}

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

/**
 * Production XmtpClient backed by a live or mock @xmtp/node-sdk Client.
 *
 * Wraps every SDK call in try/catch, converting exceptions to Result errors.
 */
export function createSdkClient(options: SdkClientOptions): XmtpClient {
  const { client, syncTimeoutMs } = options;

  return {
    get inboxId(): string {
      return client.inboxId;
    },

    async sendMessage(
      groupId: string,
      content: unknown,
    ): Promise<Result<string, SignetError>> {
      const groupResult = await getGroup(client, groupId);
      if (groupResult.isErr()) return groupResult;
      const group = groupResult.value;

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

    async streamAllMessages(): Promise<Result<MessageStream, SignetError>> {
      return wrapSdkCall(async () => {
        const stream = await client.conversations.streamAllGroupMessages();
        return wrapMessageStream(stream);
      }, "streamAllMessages");
    },

    async streamGroups(): Promise<Result<GroupStream, SignetError>> {
      return wrapSdkCall(async () => {
        const stream = await client.conversations.streamGroups();
        return wrapGroupStream(stream);
      }, "streamGroups");
    },
  };
}
