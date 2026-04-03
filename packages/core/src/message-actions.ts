import { Result } from "better-result";
import { z } from "zod";
import type { ActionSpec } from "@xmtp/signet-contracts";
import { NotFoundError } from "@xmtp/signet-schemas";
import type { SignetError, IdMappingStore } from "@xmtp/signet-schemas";
import type { SqliteIdentityStore } from "./identity-store.js";
import type { ManagedClient } from "./client-registry.js";
import type { XmtpDecodedMessage } from "./xmtp-client-factory.js";

/** Dependencies used to build message-related action specs. */
export interface MessageActionDeps {
  /** Identity store used to resolve message senders/viewers. */
  readonly identityStore: SqliteIdentityStore;
  /** Lookup for the managed client tied to a signet identity. */
  readonly getManagedClient: (identityId: string) => ManagedClient | undefined;
  /** Optional ID mapping store for conv_ boundary enforcement. */
  readonly idMappings?: IdMappingStore;
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
 * Resolve a messageId (which may be a msg_ local ID or a raw XMTP message ID)
 * to the underlying network message ID using the mapping store.
 */
function resolveMessageId(
  idMappings: IdMappingStore | undefined,
  messageId: string,
): string {
  if (!idMappings) return messageId;
  const networkId = idMappings.getNetwork(messageId);
  return networkId ?? messageId;
}

function widenActionSpec<TInput, TOutput>(
  spec: ActionSpec<TInput, TOutput, SignetError>,
): ActionSpec<unknown, unknown, SignetError> {
  return spec as ActionSpec<unknown, unknown, SignetError>;
}

/** Create ActionSpecs for message operations. */
export function createMessageActions(
  deps: MessageActionDeps,
): ActionSpec<unknown, unknown, SignetError>[] {
  const send: ActionSpec<
    { chatId: string; text: string; identityLabel?: string | undefined },
    { messageId: string; chatId: string },
    SignetError
  > = {
    id: "message.send",
    description: "Send a text message to a conversation",
    intent: "write",
    input: z.object({
      chatId: z.string(),
      text: z.string(),
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

      const groupId = resolveGroupId(deps.idMappings, input.chatId);
      const sendResult = await managed.client.sendMessage(groupId, input.text);
      if (Result.isError(sendResult)) return sendResult;

      return Result.ok({
        messageId: sendResult.value,
        chatId: input.chatId,
      });
    },
    cli: {
      command: "message:send",
    },
    mcp: {
      toolName: "message_send",
    },
    http: {
      auth: "admin",
    },
  };

  const list: ActionSpec<
    {
      chatId: string;
      limit?: number | undefined;
      before?: string | undefined;
      after?: string | undefined;
      identityLabel?: string | undefined;
    },
    { chatId: string; messages: readonly XmtpDecodedMessage[] },
    SignetError
  > = {
    id: "message.list",
    description: "List messages in a conversation",
    intent: "read",
    idempotent: true,
    input: z.object({
      chatId: z.string(),
      limit: z.coerce.number().optional(),
      before: z.string().optional(),
      after: z.string().optional(),
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

      const groupId = resolveGroupId(deps.idMappings, input.chatId);
      const listOpts: {
        limit?: number;
        before?: string;
        after?: string;
      } = {};
      if (input.limit !== undefined) listOpts.limit = input.limit;
      if (input.before !== undefined) listOpts.before = input.before;
      if (input.after !== undefined) listOpts.after = input.after;
      const listResult = await managed.client.listMessages(groupId, listOpts);
      if (Result.isError(listResult)) return listResult;

      return Result.ok({
        chatId: input.chatId,
        messages: listResult.value,
      });
    },
    cli: {
      command: "message:list",
    },
    mcp: {
      toolName: "message_list",
    },
    http: {
      auth: "admin",
    },
  };

  const info: ActionSpec<
    {
      chatId: string;
      messageId: string;
      identityLabel?: string | undefined;
    },
    XmtpDecodedMessage,
    SignetError
  > = {
    id: "message.info",
    description: "Get details for a specific message",
    intent: "read",
    idempotent: true,
    input: z.object({
      chatId: z.string(),
      messageId: z.string(),
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

      const xmtpMessageId = resolveMessageId(deps.idMappings, input.messageId);
      const lookupResult = managed.client.getMessageById(xmtpMessageId);
      if (Result.isError(lookupResult)) return lookupResult;

      if (!lookupResult.value) {
        return Result.err(
          NotFoundError.create("message", input.messageId) as SignetError,
        );
      }

      // Validate the message belongs to the requested chat
      const expectedGroupId = resolveGroupId(deps.idMappings, input.chatId);
      if (lookupResult.value.groupId !== expectedGroupId) {
        return Result.err(
          NotFoundError.create("message", input.messageId) as SignetError,
        );
      }

      return Result.ok(lookupResult.value);
    },
    cli: {
      command: "message:info",
    },
    mcp: {
      toolName: "message_info",
    },
    http: {
      auth: "admin",
    },
  };

  const reply: ActionSpec<
    {
      chatId: string;
      messageId: string;
      text: string;
      identityLabel?: string | undefined;
    },
    { messageId: string; chatId: string; inReplyTo: string },
    SignetError
  > = {
    id: "message.reply",
    description: "Reply to a specific message in a conversation",
    intent: "write",
    input: z.object({
      chatId: z.string(),
      messageId: z.string(),
      text: z.string(),
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

      const groupId = resolveGroupId(deps.idMappings, input.chatId);
      const resolvedMsgId = resolveMessageId(deps.idMappings, input.messageId);
      const sendResult = await managed.client.sendMessage(
        groupId,
        { text: input.text, reference: resolvedMsgId },
        "reply",
      );
      if (Result.isError(sendResult)) return sendResult;

      return Result.ok({
        messageId: sendResult.value,
        chatId: input.chatId,
        inReplyTo: input.messageId,
      });
    },
    cli: {
      command: "message:reply",
    },
    mcp: {
      toolName: "message_reply",
    },
    http: {
      auth: "admin",
    },
  };

  const react: ActionSpec<
    {
      chatId: string;
      messageId: string;
      reaction: string;
      identityLabel?: string | undefined;
    },
    { messageId: string; chatId: string; reactedTo: string },
    SignetError
  > = {
    id: "message.react",
    description: "React to a specific message in a conversation",
    intent: "write",
    input: z.object({
      chatId: z.string(),
      messageId: z.string(),
      reaction: z.string(),
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

      const groupId = resolveGroupId(deps.idMappings, input.chatId);
      const resolvedMsgId = resolveMessageId(deps.idMappings, input.messageId);
      const sendResult = await managed.client.sendMessage(
        groupId,
        {
          reference: resolvedMsgId,
          action: "added",
          content: input.reaction,
          schema: "unicode",
        },
        "reaction",
      );
      if (Result.isError(sendResult)) return sendResult;

      return Result.ok({
        messageId: sendResult.value,
        chatId: input.chatId,
        reactedTo: input.messageId,
      });
    },
    cli: {
      command: "message:react",
    },
    mcp: {
      toolName: "message_react",
    },
    http: {
      auth: "admin",
    },
  };

  const read: ActionSpec<
    { chatId: string; identityLabel?: string | undefined },
    { chatId: string; markedRead: true },
    SignetError
  > = {
    id: "message.read",
    description: "Mark a conversation as read",
    intent: "write",
    input: z.object({
      chatId: z.string(),
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

      const groupId = resolveGroupId(deps.idMappings, input.chatId);
      const sendResult = await managed.client.sendMessage(
        groupId,
        {},
        "readReceipt",
      );
      if (Result.isError(sendResult)) return sendResult;

      return Result.ok({
        chatId: input.chatId,
        markedRead: true as const,
      });
    },
    cli: {
      command: "message:read",
    },
    mcp: {
      toolName: "message_read",
    },
    http: {
      auth: "admin",
    },
  };

  return [
    widenActionSpec(send),
    widenActionSpec(list),
    widenActionSpec(info),
    widenActionSpec(reply),
    widenActionSpec(react),
    widenActionSpec(read),
  ];
}
