import { Result } from "better-result";
import { z } from "zod";
import type { ActionSpec, HandlerContext } from "@xmtp/signet-contracts";
import { NotFoundError, PermissionError } from "@xmtp/signet-schemas";
import type {
  SignetError,
  IdMappingStore,
  CredentialRecordType,
  AdminReadElevationType,
} from "@xmtp/signet-schemas";
import type { SqliteIdentityStore } from "./identity-store.js";
import type { ManagedClient } from "./client-registry.js";
import { resolveIdentitySelector } from "./identity-selector.js";
import type { XmtpDecodedMessage } from "./xmtp-client-factory.js";

/** Dependencies used to build message-related action specs. */
export interface MessageActionDeps {
  /** Identity store used to resolve message senders/viewers. */
  readonly identityStore: SqliteIdentityStore;
  /** Lookup for the managed client tied to a signet identity. */
  readonly getManagedClient: (identityId: string) => ManagedClient | undefined;
  /** Optional ID mapping store for conv_ boundary enforcement. */
  readonly idMappings?: IdMappingStore;
  /** Resolve a credential ID to its record. Used for scope enforcement. */
  readonly credentialLookup?:
    | ((
        credentialId: string,
      ) => Promise<Result<CredentialRecordType, SignetError>>)
    | undefined;
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

/**
 * Compute effective scopes from credential config allow/deny.
 * Deny always wins.
 */
function resolveEffectiveScopes(config: {
  allow?: readonly string[] | undefined;
  deny?: readonly string[] | undefined;
}): ReadonlySet<string> {
  const allowed = new Set(config.allow ?? []);
  if (config.deny) {
    for (const scope of config.deny) {
      allowed.delete(scope);
    }
  }
  return allowed;
}

function authorizeAdminReadElevation(
  elevation: AdminReadElevationType,
  chatId: string,
  idMappings: IdMappingStore | undefined,
): Result<void, SignetError> {
  const expiresAt = Date.parse(elevation.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return Result.err(
      PermissionError.create("Admin read elevation has expired", {
        approvalId: elevation.approvalId,
        expiresAt: elevation.expiresAt,
      }) as SignetError,
    );
  }

  const targetGroupId = resolveGroupId(idMappings, chatId);
  const scopedGroupIds = elevation.scope.chatIds.map((scopedChatId) =>
    resolveGroupId(idMappings, scopedChatId),
  );
  if (!scopedGroupIds.includes(targetGroupId)) {
    return Result.err(
      PermissionError.create(
        "Admin read elevation does not cover this conversation",
        {
          approvalId: elevation.approvalId,
          chatId,
        },
      ) as SignetError,
    );
  }

  return Result.ok(undefined);
}

function authorizeAdminReadAccess(
  ctx: HandlerContext,
  chatId: string,
  idMappings: IdMappingStore | undefined,
): Result<void, SignetError> {
  if (ctx.credentialId) {
    return Result.ok(undefined);
  }
  if (ctx.adminReadElevation) {
    return authorizeAdminReadElevation(
      ctx.adminReadElevation,
      chatId,
      idMappings,
    );
  }
  if (ctx.adminAuth) {
    return Result.err(
      PermissionError.create(
        "Admin message reads require owner-approved elevation",
        {
          chatId,
          hint: "--dangerously-allow-message-read",
        },
      ) as SignetError,
    );
  }
  return Result.ok(undefined);
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
      const resolved = await resolveIdentitySelector(
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
    handler: async (input, ctx) => {
      const elevationResult = authorizeAdminReadAccess(
        ctx,
        input.chatId,
        deps.idMappings,
      );
      if (Result.isError(elevationResult)) {
        return elevationResult;
      }

      // Credential scope enforcement: verify the caller can read
      // messages in this conversation before hitting the SDK.
      // Fail closed: if credentialId is present but credentialLookup
      // is not wired, deny access rather than silently bypassing.
      if (ctx.credentialId) {
        if (!deps.credentialLookup) {
          return Result.err(
            NotFoundError.create("conversation", input.chatId) as SignetError,
          );
        }
        const credResult = await deps.credentialLookup(ctx.credentialId);
        if (Result.isError(credResult)) {
          return Result.err(
            NotFoundError.create("conversation", input.chatId) as SignetError,
          );
        }
        const credential = credResult.value;
        const scopedGroupIds = credential.config.chatIds.map((chatId) =>
          resolveGroupId(deps.idMappings, chatId),
        );
        const targetGroupId = resolveGroupId(deps.idMappings, input.chatId);
        if (!scopedGroupIds.includes(targetGroupId)) {
          return Result.err(
            NotFoundError.create("conversation", input.chatId) as SignetError,
          );
        }
        const effectiveScopes = resolveEffectiveScopes(credential.config);
        if (!effectiveScopes.has("read-messages")) {
          return Result.err(
            NotFoundError.create("conversation", input.chatId) as SignetError,
          );
        }
      }

      const resolved = await resolveIdentitySelector(
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
    handler: async (input, ctx) => {
      const notFound = () =>
        Result.err(
          NotFoundError.create("message", input.messageId) as SignetError,
        );

      const elevationResult = authorizeAdminReadAccess(
        ctx,
        input.chatId,
        deps.idMappings,
      );
      if (Result.isError(elevationResult)) {
        return elevationResult;
      }

      // Credential scope enforcement: verify scope BEFORE any data
      // access to prevent timing side-channels that leak message
      // existence. Always return not_found to maintain information
      // opacity. Fail closed when credentialLookup is unwired.
      if (ctx.credentialId) {
        if (!deps.credentialLookup) {
          return notFound();
        }
        const credResult = await deps.credentialLookup(ctx.credentialId);
        if (Result.isError(credResult)) {
          return notFound();
        }

        const credential = credResult.value;

        // Resolve credential's conv_ chatIds to XMTP groupIds
        const scopedGroupIds = credential.config.chatIds.map((chatId) =>
          resolveGroupId(deps.idMappings, chatId),
        );

        const expectedGroupId = resolveGroupId(deps.idMappings, input.chatId);
        if (!scopedGroupIds.includes(expectedGroupId)) {
          return notFound();
        }

        const effectiveScopes = resolveEffectiveScopes(credential.config);
        if (!effectiveScopes.has("read-messages")) {
          return notFound();
        }
      }

      const resolved = await resolveIdentitySelector(
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
        return notFound();
      }

      // Validate the message belongs to the requested chat.
      // This prevents ID space drift and cross-conversation fishing.
      const expectedGroupId = resolveGroupId(deps.idMappings, input.chatId);
      if (lookupResult.value.groupId !== expectedGroupId) {
        return notFound();
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
      const resolved = await resolveIdentitySelector(
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
      const resolved = await resolveIdentitySelector(
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
      const resolved = await resolveIdentitySelector(
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
