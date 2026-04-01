import { Result } from "better-result";
import { z } from "zod";
import type {
  ActionSpec,
  OperatorManager,
  PolicyManager,
  CredentialManager,
} from "@xmtp/signet-contracts";
import { NotFoundError } from "@xmtp/signet-schemas";
import type { SignetError, IdMappingStore } from "@xmtp/signet-schemas";
import type { SqliteIdentityStore } from "./identity-store.js";
import type { ManagedClient } from "./client-registry.js";

/** Dependencies used to build search-related action specs. */
export interface SearchActionDeps {
  readonly identityStore: SqliteIdentityStore;
  readonly getManagedClient: (identityId: string) => ManagedClient | undefined;
  readonly idMappings?: IdMappingStore;
  readonly operatorManager?: OperatorManager;
  readonly policyManager?: PolicyManager;
  readonly credentialManager?: CredentialManager;
}

/** A single message search hit. */
interface MessageSearchHit {
  readonly chatId: string;
  readonly messageId: string;
  readonly senderInboxId: string;
  readonly content: string;
  readonly sentAt: string;
}

/** A single resource search hit. */
interface ResourceSearchHit {
  readonly type: "operator" | "policy" | "credential" | "conversation";
  readonly id: string;
  readonly label: string;
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

function widenActionSpec<TInput, TOutput>(
  spec: ActionSpec<TInput, TOutput, SignetError>,
): ActionSpec<unknown, unknown, SignetError> {
  return spec as ActionSpec<unknown, unknown, SignetError>;
}

const DEFAULT_LIMIT = 20;
const MESSAGES_PER_CONVERSATION = 100;

/** Create ActionSpecs for search operations. */
export function createSearchActions(
  deps: SearchActionDeps,
): ActionSpec<unknown, unknown, SignetError>[] {
  const searchMessages: ActionSpec<
    {
      query: string;
      chatId?: string | undefined;
      limit?: number | undefined;
      identityLabel?: string | undefined;
    },
    { query: string; matches: readonly MessageSearchHit[]; total: number },
    SignetError
  > = {
    id: "search.messages",
    description: "Search messages across conversations",
    intent: "read",
    idempotent: true,
    input: z.object({
      query: z.string().min(1),
      chatId: z.string().optional(),
      limit: z.number().int().positive().optional(),
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

      const maxResults = input.limit ?? DEFAULT_LIMIT;
      const queryLower = input.query.toLowerCase();
      const matches: MessageSearchHit[] = [];

      if (input.chatId) {
        // Search a single conversation
        const groupId = resolveGroupId(deps.idMappings, input.chatId);
        const listResult = await managed.client.listMessages(groupId, {
          limit: MESSAGES_PER_CONVERSATION,
        });
        if (Result.isError(listResult)) return listResult;

        for (const msg of listResult.value) {
          if (matches.length >= maxResults) break;
          if (
            typeof msg.content === "string" &&
            msg.content.toLowerCase().includes(queryLower)
          ) {
            matches.push({
              chatId: input.chatId,
              messageId: msg.messageId,
              senderInboxId: msg.senderInboxId,
              content: msg.content,
              sentAt: msg.sentAt,
            });
          }
        }
      } else {
        // Search across all conversations
        const groupsResult = await managed.client.listGroups();
        if (Result.isError(groupsResult)) return groupsResult;

        for (const group of groupsResult.value) {
          if (matches.length >= maxResults) break;

          const listResult = await managed.client.listMessages(group.groupId, {
            limit: MESSAGES_PER_CONVERSATION,
          });
          if (Result.isError(listResult)) continue;

          // Use local chatId if available, otherwise the raw groupId
          const chatId =
            deps.idMappings?.getLocal(group.groupId) ?? group.groupId;

          for (const msg of listResult.value) {
            if (matches.length >= maxResults) break;
            if (
              typeof msg.content === "string" &&
              msg.content.toLowerCase().includes(queryLower)
            ) {
              matches.push({
                chatId,
                messageId: msg.messageId,
                senderInboxId: msg.senderInboxId,
                content: msg.content,
                sentAt: msg.sentAt,
              });
            }
          }
        }
      }

      return Result.ok({
        query: input.query,
        matches,
        total: matches.length,
      });
    },
    cli: {
      command: "search:messages",
    },
    mcp: {
      toolName: "search_messages",
    },
    http: {
      auth: "admin",
    },
  };

  const searchResources: ActionSpec<
    {
      query: string;
      type?: "operator" | "policy" | "credential" | "conversation" | undefined;
      limit?: number | undefined;
    },
    { query: string; matches: readonly ResourceSearchHit[]; total: number },
    SignetError
  > = {
    id: "search.resources",
    description:
      "Search operators, policies, credentials, and conversations by name or ID",
    intent: "read",
    idempotent: true,
    input: z.object({
      query: z.string().min(1),
      type: z
        .enum(["operator", "policy", "credential", "conversation"])
        .optional(),
      limit: z.number().int().positive().optional(),
    }),
    handler: async (input) => {
      const maxResults = input.limit ?? DEFAULT_LIMIT;
      const queryLower = input.query.toLowerCase();
      const matches: ResourceSearchHit[] = [];

      const shouldSearch = (type: string): boolean =>
        input.type === undefined || input.type === type;

      // Search operators
      if (shouldSearch("operator") && deps.operatorManager) {
        const listResult = await deps.operatorManager.list();
        if (Result.isOk(listResult)) {
          for (const op of listResult.value) {
            if (matches.length >= maxResults) break;
            if (
              op.id.toLowerCase().includes(queryLower) ||
              op.config.label.toLowerCase().includes(queryLower)
            ) {
              matches.push({
                type: "operator",
                id: op.id,
                label: op.config.label,
              });
            }
          }
        }
      }

      // Search policies
      if (shouldSearch("policy") && deps.policyManager) {
        const listResult = await deps.policyManager.list();
        if (Result.isOk(listResult)) {
          for (const policy of listResult.value) {
            if (matches.length >= maxResults) break;
            if (
              policy.id.toLowerCase().includes(queryLower) ||
              policy.config.label.toLowerCase().includes(queryLower)
            ) {
              matches.push({
                type: "policy",
                id: policy.id,
                label: policy.config.label,
              });
            }
          }
        }
      }

      // Search credentials
      if (shouldSearch("credential") && deps.credentialManager) {
        const listResult = await deps.credentialManager.list();
        if (Result.isOk(listResult)) {
          for (const cred of listResult.value) {
            if (matches.length >= maxResults) break;
            const credId = cred.credentialId ?? cred.id;
            const opId = cred.operatorId ?? cred.config.operatorId;
            if (
              credId.toLowerCase().includes(queryLower) ||
              opId.toLowerCase().includes(queryLower)
            ) {
              matches.push({
                type: "credential",
                id: credId,
                label: `operator:${opId}`,
              });
            }
          }
        }
      }

      // Search conversations
      if (shouldSearch("conversation")) {
        const resolved = await resolveIdentity(deps.identityStore, undefined);
        if (Result.isOk(resolved)) {
          const managed = deps.getManagedClient(resolved.value.identityId);
          if (managed) {
            const groupsResult = await managed.client.listGroups();
            if (Result.isOk(groupsResult)) {
              for (const group of groupsResult.value) {
                if (matches.length >= maxResults) break;
                const chatId =
                  deps.idMappings?.getLocal(group.groupId) ?? group.groupId;
                if (
                  chatId.toLowerCase().includes(queryLower) ||
                  group.groupId.toLowerCase().includes(queryLower) ||
                  group.name.toLowerCase().includes(queryLower)
                ) {
                  matches.push({
                    type: "conversation",
                    id: chatId,
                    label: group.name || chatId,
                  });
                }
              }
            }
          }
        }
      }

      return Result.ok({
        query: input.query,
        matches,
        total: matches.length,
      });
    },
    cli: {
      command: "search:resources",
    },
    mcp: {
      toolName: "search_resources",
    },
    http: {
      auth: "admin",
    },
  };

  return [widenActionSpec(searchMessages), widenActionSpec(searchResources)];
}
