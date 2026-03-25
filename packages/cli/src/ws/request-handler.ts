import { Result } from "better-result";
import {
  AuthError,
  InternalError,
  NotFoundError,
  PermissionError,
  resolveScopeSet,
} from "@xmtp/signet-schemas";
import type {
  SignetError,
  SignetEvent,
  HarnessRequest,
  ConfirmActionRequest,
  SendMessageRequest,
  UpdateScopesRequest,
  RevealContentRequest,
  RevealGrant,
  ScopeSetType,
  MessageSealBindingType,
} from "@xmtp/signet-schemas";
import type {
  CredentialManager,
  CredentialRecord,
  SealManager,
} from "@xmtp/signet-contracts";
import type { MessageProvenanceMetadata } from "@xmtp/signet-contracts";
import { validateSendMessage, projectMessage } from "@xmtp/signet-policy";
import type { RawMessage } from "@xmtp/signet-policy";
import type { RequestHandler } from "@xmtp/signet-ws";
import type { InternalCredentialManager } from "@xmtp/signet-sessions";
import type { PendingActionStore } from "@xmtp/signet-sessions";

/** Minimal message shape needed for reveal replay. */
export interface ReplayMessage {
  readonly messageId: string;
  readonly groupId: string;
  readonly senderInboxId: string;
  readonly contentType: string;
  readonly content: unknown;
  readonly sentAt: string;
  readonly threadId: string | null;
}

/** Dependencies required to route harness requests through the WS transport. */
export interface HarnessRequestHandlerDeps {
  readonly ensureCoreReady: () => Promise<Result<void, SignetError>>;
  readonly sendMessage: (
    groupId: string,
    contentType: string,
    content: unknown,
  ) => Promise<Result<{ messageId: string }, SignetError>>;
  readonly credentialManager: Pick<
    CredentialManager,
    "lookup" | "lookupByToken"
  >;
  readonly internalCredentialManager?: InternalCredentialManager;
  readonly pendingActions?: PendingActionStore;
  readonly broadcast?: (credentialId: string, event: SignetEvent) => void;
  readonly listMessages?: (
    groupId: string,
    options?: {
      limit?: number;
      before?: string;
      after?: string;
      direction?: "ascending" | "descending";
    },
  ) => Promise<Result<readonly ReplayMessage[], SignetError>>;
  /** Seal manager for provenance lookup on outbound messages. */
  readonly sealManager?: Pick<SealManager, "current">;
  /** Optional message binding creator for v1 seal provenance. */
  readonly createMessageBinding?: (
    messageId: string,
    sealId: string,
    credential: CredentialRecord,
  ) => Promise<Result<MessageSealBindingType, SignetError>>;
  /** Action expiry TTL in milliseconds. Defaults to 5 minutes. */
  readonly actionExpiryMs?: number;
  /** Optional callback for logging expired actions. */
  readonly onActionExpired?: (action: {
    actionId: string;
    credentialId: string;
    actionType: string;
    createdAt: string;
    expiresAt: string;
  }) => void;
}

/**
 * Resolve a credential's effective scopes. Returns the resolved scope set.
 */
function resolveScopes(credential: CredentialRecord): ReadonlySet<string> {
  return resolveScopeSet(credential.effectiveScopes);
}

/** Resolve the credential's scoped chat IDs from its persisted config. */
function resolveChatIds(credential: CredentialRecord): readonly string[] {
  return credential.config.chatIds;
}

/**
 * Create the WS harness request handler.
 *
 * The handler stays transport-only: it validates request shape,
 * delegates to credential/core services, and returns typed results.
 */
export function createWsRequestHandler(
  deps: HarnessRequestHandlerDeps,
): RequestHandler {
  async function handleSendMessage(
    request: SendMessageRequest,
    credential: CredentialRecord,
  ): Promise<
    Result<
      | {
          messageId: string;
          provenance: MessageProvenanceMetadata | null;
        }
      | { pending: true; actionId: string },
      SignetError
    >
  > {
    const scopes = resolveScopes(credential);
    const chatIds = resolveChatIds(credential);

    const validation = validateSendMessage(request, scopes, chatIds);
    if (validation.isErr()) {
      return validation;
    }

    const readyResult = await deps.ensureCoreReady();
    if (readyResult.isErr()) {
      return readyResult;
    }

    // Fail-closed: re-check credential state after core readiness.
    // The credential may have been revoked during the ensureCoreReady() await.
    const freshResult = await deps.credentialManager.lookup(
      credential.credentialId,
    );
    if (freshResult.isErr()) {
      return freshResult;
    }
    if (freshResult.value.status !== "active") {
      return Result.err(
        AuthError.create(
          `Credential is ${freshResult.value.status} -- cannot send messages`,
        ),
      );
    }

    const sendResult = await deps.sendMessage(
      request.groupId,
      request.contentType,
      request.content,
    );
    if (sendResult.isErr()) {
      return sendResult;
    }

    // Attach provenance metadata if a credential-scoped seal exists and
    // the runtime can bind the outbound message to that seal.
    let provenance: MessageProvenanceMetadata | null = null;
    if (deps.sealManager && deps.createMessageBinding) {
      const sealResult = await deps.sealManager.current(
        credential.credentialId,
        request.groupId,
      );
      if (sealResult.isOk() && sealResult.value !== null) {
        const envelope = sealResult.value;
        const bindingResult = await deps.createMessageBinding(
          sendResult.value.messageId,
          envelope.chain.current.sealId,
          credential,
        );
        if (bindingResult.isErr()) {
          return bindingResult;
        }
        provenance = {
          credentialId: envelope.chain.current.credentialId,
          operatorId: envelope.chain.current.operatorId,
          ...bindingResult.value,
        };
      }
    }

    return Result.ok({
      messageId: sendResult.value.messageId,
      provenance,
    });
  }

  async function handleHeartbeat(
    request: Extract<HarnessRequest, { type: "heartbeat" }>,
    credential: CredentialRecord,
  ): Promise<Result<null, SignetError>> {
    if (request.credentialId !== credential.credentialId) {
      return Result.err(
        AuthError.create(
          "Heartbeat credential does not match authenticated credential",
          {
            authenticatedCredentialId: credential.credentialId,
            requestedCredentialId: request.credentialId,
          },
        ),
      );
    }

    if (!deps.internalCredentialManager) {
      // No heartbeat support without internal manager
      return Result.ok(null);
    }

    const result = deps.internalCredentialManager.recordHeartbeat(
      credential.credentialId,
    );
    if (result.isErr()) {
      return result;
    }

    return Result.ok(null);
  }

  async function handleRevealContent(
    request: RevealContentRequest,
    credential: CredentialRecord,
  ): Promise<Result<RevealGrant, SignetError>> {
    const { reveal } = request;

    if (!deps.internalCredentialManager) {
      return Result.err(
        InternalError.create("Internal credential manager not available"),
      );
    }

    const storeResult = deps.internalCredentialManager.getRevealState(
      credential.credentialId,
    );
    if (Result.isError(storeResult)) {
      return storeResult;
    }

    const store = storeResult.value;
    const grant: RevealGrant = {
      revealId: reveal.revealId,
      grantedAt: new Date().toISOString(),
      grantedBy: reveal.requestedBy,
      expiresAt: reveal.expiresAt,
    };

    store.grant(grant, reveal);

    // Replay historical messages through the projection pipeline
    if (deps.listMessages && deps.broadcast) {
      const messagesResult = await deps.listMessages(reveal.groupId);
      if (messagesResult.isOk()) {
        const scopes = resolveScopes(credential);
        const chatIds = resolveChatIds(credential);
        // In v1, content types are not restricted at the credential level.
        for (const msg of messagesResult.value) {
          const isRevealed = store.isRevealed(
            msg.messageId,
            msg.groupId,
            msg.threadId,
            msg.senderInboxId,
            msg.contentType,
            msg.sentAt,
          );
          if (!isRevealed) continue;

          const rawMessage: RawMessage = {
            messageId: msg.messageId,
            groupId: msg.groupId,
            senderInboxId: msg.senderInboxId,
            contentType: msg.contentType,
            content: msg.content,
            sentAt: msg.sentAt,
            sealId: null,
            threadId: msg.threadId,
            isHistorical: true,
          };
          // Include the message's content type in the allowlist to pass
          // the content-type filter (v1 doesn't restrict content types).
          const msgAllowlist = new Set<string>([msg.contentType]);
          const projection = projectMessage(
            rawMessage,
            scopes,
            chatIds,
            msgAllowlist,
            true,
          );
          if (projection.action === "emit") {
            deps.broadcast(credential.credentialId, {
              type: "message.revealed",
              messageId: msg.messageId,
              groupId: msg.groupId,
              contentType: msg.contentType,
              content: projection.event.content,
              revealId: grant.revealId,
            });
          }
        }
      }
    }

    return Result.ok(grant);
  }

  async function handleUpdateScopes(
    request: UpdateScopesRequest,
    credential: CredentialRecord,
  ): Promise<Result<unknown, SignetError>> {
    if (!deps.internalCredentialManager) {
      return Result.err(
        InternalError.create("Internal credential manager not available"),
      );
    }

    const newScopes: ScopeSetType = {
      allow: request.allow ?? credential.effectiveScopes.allow,
      deny: request.deny ?? credential.effectiveScopes.deny,
    };

    const materialityResult = deps.internalCredentialManager.checkMateriality(
      credential.credentialId,
      newScopes,
    );
    if (Result.isError(materialityResult)) {
      return materialityResult;
    }

    const check = materialityResult.value;

    if (check.requiresReauthorization) {
      deps.internalCredentialManager.setCredentialStatus(
        credential.credentialId,
        "pending",
      );
      return Result.ok({
        updated: false,
        material: true,
        reason: check.reason,
      });
    }

    const updateResult = deps.internalCredentialManager.updateCredentialScopes(
      credential.credentialId,
      newScopes,
    );
    if (Result.isError(updateResult)) {
      return updateResult;
    }

    return Result.ok({
      updated: true,
      material: check.isMaterial,
      reason: check.isMaterial ? check.reason : null,
    });
  }

  async function handleConfirmAction(
    request: ConfirmActionRequest,
    credential: CredentialRecord,
  ): Promise<Result<unknown, SignetError>> {
    if (!deps.pendingActions) {
      return Result.err(
        InternalError.create("Pending action store not available"),
      );
    }

    const pending = deps.pendingActions.get(request.actionId);
    if (pending === null) {
      return Result.err(
        NotFoundError.create("PendingAction", request.actionId),
      );
    }

    if (pending.credentialId !== credential.credentialId) {
      return Result.err(
        PermissionError.create(
          "Pending action does not belong to this credential",
          {
            actionId: request.actionId,
            credentialId: credential.credentialId,
          },
        ),
      );
    }

    // Reject expired pending actions
    if (
      pending.expiresAt &&
      new Date(pending.expiresAt).getTime() < Date.now()
    ) {
      deps.pendingActions.deny(request.actionId);
      deps.onActionExpired?.({
        actionId: pending.actionId,
        credentialId: pending.credentialId,
        actionType: pending.actionType,
        createdAt: pending.createdAt,
        expiresAt: pending.expiresAt,
      });
      return Result.err(
        PermissionError.create("Pending action has expired", {
          actionId: request.actionId,
          expiresAt: pending.expiresAt,
        }),
      );
    }

    if (!request.confirmed) {
      deps.pendingActions.deny(request.actionId);
      return Result.ok({ denied: true, actionId: request.actionId });
    }

    // Re-validate queued send_message against current credential policy
    if (pending.actionType === "send_message") {
      const payload = pending.payload as {
        groupId: string;
        contentType: string;
        content: unknown;
      };

      // Re-run scope validation
      const scopes = resolveScopes(credential);
      const revalidation = validateSendMessage(
        { groupId: payload.groupId },
        scopes,
        resolveChatIds(credential),
      );
      if (revalidation.isErr()) {
        deps.pendingActions.deny(request.actionId);
        return revalidation;
      }
    }

    const action = deps.pendingActions.confirm(request.actionId);
    if (action === null) {
      return Result.err(
        NotFoundError.create("PendingAction", request.actionId),
      );
    }

    // Execute the original action
    if (action.actionType === "send_message") {
      const payload = action.payload as {
        groupId: string;
        contentType: string;
        content: unknown;
      };

      const readyResult = await deps.ensureCoreReady();
      if (readyResult.isErr()) {
        return readyResult;
      }

      return deps.sendMessage(
        payload.groupId,
        payload.contentType,
        payload.content,
      );
    }

    return Result.err(
      InternalError.create(`Unknown pending action type: ${action.actionType}`),
    );
  }

  return async (
    request: HarnessRequest,
    credential: CredentialRecord,
  ): Promise<Result<unknown, SignetError>> => {
    // Guard: reject non-heartbeat requests when the credential's heartbeat
    // is stale. This enforces liveness -- the harness must maintain its
    // heartbeat cadence to keep sending requests.
    if (
      request.type !== "heartbeat" &&
      deps.internalCredentialManager &&
      typeof deps.internalCredentialManager.isHeartbeatStale === "function"
    ) {
      try {
        const staleResult = deps.internalCredentialManager.isHeartbeatStale(
          credential.credentialId,
        );
        if (staleResult.isOk() && staleResult.value) {
          return Result.err(
            AuthError.create(
              "Credential heartbeat is stale -- send a heartbeat before making requests",
            ),
          );
        }
      } catch {
        // Staleness check failed -- proceed rather than blocking the request
      }
    }

    switch (request.type) {
      case "send_message":
        return handleSendMessage(request, credential);
      case "heartbeat":
        return handleHeartbeat(request, credential);
      case "reveal_content":
        return handleRevealContent(request, credential);
      case "update_scopes":
        return handleUpdateScopes(request, credential);
      case "confirm_action":
        return handleConfirmAction(request, credential);
      default:
        return Result.err(
          InternalError.create(
            `Harness request type '${request.type}' is not supported`,
          ),
        );
    }
  };
}

/** Alias for the WS harness request handler used by older call sites. */
export const createHarnessRequestHandler: typeof createWsRequestHandler =
  createWsRequestHandler;
