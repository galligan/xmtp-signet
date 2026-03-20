import { Result } from "better-result";
import {
  AuthError,
  InternalError,
  NotFoundError,
  PermissionError,
} from "@xmtp/signet-schemas";
import type {
  SignetError,
  SignetEvent,
  HarnessRequest,
  ConfirmActionRequest,
  SendMessageRequest,
  UpdateViewRequest,
  RevealContentRequest,
  RevealGrant,
} from "@xmtp/signet-schemas";
import type { SessionManager, SessionRecord } from "@xmtp/signet-contracts";
import { validateSendMessage, projectMessage } from "@xmtp/signet-policy";
import type { RawMessage } from "@xmtp/signet-policy";
import type { RequestHandler } from "@xmtp/signet-ws";
import type { InternalSessionManager } from "@xmtp/signet-sessions";
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

/** Default expiry for pending actions: 5 minutes. */
const PENDING_ACTION_TTL_MS = 5 * 60 * 1000;

/** Dependencies required to route harness requests through the WS transport. */
export interface HarnessRequestHandlerDeps {
  readonly ensureCoreReady: () => Promise<Result<void, SignetError>>;
  readonly sendMessage: (
    groupId: string,
    contentType: string,
    content: unknown,
  ) => Promise<Result<{ messageId: string }, SignetError>>;
  readonly sessionManager: Pick<
    SessionManager,
    "heartbeat" | "lookup" | "getRevealState"
  >;
  readonly internalSessionManager?: InternalSessionManager;
  readonly pendingActions?: PendingActionStore;
  readonly broadcast?: (sessionId: string, event: SignetEvent) => void;
  readonly listMessages?: (
    groupId: string,
    options?: {
      limit?: number;
      before?: string;
      after?: string;
      direction?: "ascending" | "descending";
    },
  ) => Promise<Result<readonly ReplayMessage[], SignetError>>;
}

/**
 * Create the WS harness request handler.
 *
 * The handler stays transport-only: it validates request shape,
 * delegates to session/core services, and returns typed results.
 */
export function createWsRequestHandler(
  deps: HarnessRequestHandlerDeps,
): RequestHandler {
  async function handleSendMessage(
    request: SendMessageRequest,
    session: SessionRecord,
  ): Promise<
    Result<
      { messageId: string } | { pending: true; actionId: string },
      SignetError
    >
  > {
    if (!session.view.contentTypes.includes(request.contentType)) {
      return Result.err(
        PermissionError.create(
          "Message content type is outside the session view",
          {
            sessionId: session.sessionId,
            contentType: request.contentType,
          },
        ),
      );
    }

    const validation = validateSendMessage(
      request,
      session.grant,
      session.view,
    );
    if (validation.isErr()) {
      return validation;
    }

    if (validation.value.draftOnly) {
      if (deps.pendingActions && deps.broadcast) {
        const actionId = crypto.randomUUID();
        const now = new Date();
        deps.pendingActions.add({
          actionId,
          sessionId: session.sessionId,
          actionType: "send_message",
          payload: {
            groupId: request.groupId,
            contentType: request.contentType,
            content: request.content,
          },
          createdAt: now.toISOString(),
          expiresAt: new Date(
            now.getTime() + PENDING_ACTION_TTL_MS,
          ).toISOString(),
        });

        deps.broadcast(session.sessionId, {
          type: "action.confirmation_required",
          actionId,
          actionType: "send_message",
          preview: {
            groupId: request.groupId,
            contentType: request.contentType,
            content: request.content,
          },
        });

        return Result.ok({ pending: true, actionId });
      }

      return Result.err(
        PermissionError.create(
          "Draft-only sessions cannot send live messages",
          { sessionId: session.sessionId, requestType: request.type },
        ),
      );
    }

    const readyResult = await deps.ensureCoreReady();
    if (readyResult.isErr()) {
      return readyResult;
    }

    return deps.sendMessage(
      request.groupId,
      request.contentType,
      request.content,
    );
  }

  async function handleHeartbeat(
    request: Extract<HarnessRequest, { type: "heartbeat" }>,
    session: SessionRecord,
  ): Promise<Result<null, SignetError>> {
    if (request.sessionId !== session.sessionId) {
      return Result.err(
        AuthError.create(
          "Heartbeat session does not match authenticated session",
          {
            authenticatedSessionId: session.sessionId,
            requestedSessionId: request.sessionId,
          },
        ),
      );
    }

    const result = await deps.sessionManager.heartbeat(session.sessionId);
    if (result.isErr()) {
      return result;
    }

    return Result.ok(null);
  }

  async function handleRevealContent(
    request: RevealContentRequest,
    session: SessionRecord,
  ): Promise<Result<RevealGrant, SignetError>> {
    const { reveal } = request;

    // Validate groupId against session's threadScopes
    const matchingScopes = session.view.threadScopes.filter(
      (scope) => scope.groupId === reveal.groupId,
    );
    if (matchingScopes.length === 0) {
      return Result.err(
        PermissionError.create(
          "Reveal group is not within the session's thread scopes",
          { sessionId: session.sessionId, groupId: reveal.groupId },
        ),
      );
    }

    // For thread-scoped reveals, verify the target thread is allowed
    if (reveal.scope === "thread" && reveal.targetId) {
      const threadAllowed = matchingScopes.some(
        (scope) =>
          scope.threadId === null || scope.threadId === reveal.targetId,
      );
      if (!threadAllowed) {
        return Result.err(
          PermissionError.create(
            "Thread is not within the session's thread scopes",
            {
              sessionId: session.sessionId,
              groupId: reveal.groupId,
              threadId: reveal.targetId,
            },
          ),
        );
      }
    }

    const storeResult = deps.sessionManager.getRevealState(session.sessionId);
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
        const allowlist = new Set(session.view.contentTypes);
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

          // Run through the view projection pipeline to enforce
          // scope and content-type filters before emitting.
          const rawMessage: RawMessage = {
            messageId: msg.messageId,
            groupId: msg.groupId,
            senderInboxId: msg.senderInboxId,
            contentType: msg.contentType,
            content: msg.content,
            sentAt: msg.sentAt,
            sealId: null,
            threadId: msg.threadId,
          };
          const projection = projectMessage(
            rawMessage,
            session.view,
            allowlist,
            true,
          );
          if (projection.action === "emit") {
            deps.broadcast(session.sessionId, {
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

  async function handleUpdateView(
    request: UpdateViewRequest,
    session: SessionRecord,
  ): Promise<Result<unknown, SignetError>> {
    if (!deps.internalSessionManager) {
      return Result.err(
        InternalError.create("Internal session manager not available"),
      );
    }

    const materialityResult = deps.internalSessionManager.checkMateriality(
      session.sessionId,
      request.view,
      session.grant,
    );
    if (Result.isError(materialityResult)) {
      return materialityResult;
    }

    const check = materialityResult.value;

    if (check.isMaterial) {
      deps.internalSessionManager.setSessionState(
        session.sessionId,
        "reauthorization-required",
      );
      return Result.ok({
        updated: false,
        material: true,
        reason: check.reason,
      });
    }

    const updateResult = deps.internalSessionManager.updateSessionPolicy(
      session.sessionId,
      request.view,
      session.grant,
    );
    if (Result.isError(updateResult)) {
      return updateResult;
    }

    return Result.ok({ updated: true, material: false, reason: null });
  }

  async function handleConfirmAction(
    request: ConfirmActionRequest,
    session: SessionRecord,
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

    if (pending.sessionId !== session.sessionId) {
      return Result.err(
        PermissionError.create(
          "Pending action does not belong to this session",
          {
            actionId: request.actionId,
            sessionId: session.sessionId,
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

    // Re-validate queued send_message against current session policy
    // (session may have been narrowed since the action was queued)
    if (pending.actionType === "send_message") {
      const payload = pending.payload as {
        groupId: string;
        contentType: string;
        content: unknown;
      };

      // Check content type still allowed
      const allowedTypes = new Set(session.view.contentTypes);
      if (!allowedTypes.has(payload.contentType)) {
        deps.pendingActions.deny(request.actionId);
        return Result.err(
          PermissionError.create(
            "Content type no longer allowed by session view",
            {
              contentType: payload.contentType,
              sessionId: session.sessionId,
            },
          ),
        );
      }

      // Re-run grant/view validation
      const revalidation = validateSendMessage(
        { groupId: payload.groupId, contentType: payload.contentType },
        session.grant,
        session.view,
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
    session: SessionRecord,
  ): Promise<Result<unknown, SignetError>> => {
    switch (request.type) {
      case "send_message":
        return handleSendMessage(request, session);
      case "heartbeat":
        return handleHeartbeat(request, session);
      case "reveal_content":
        return handleRevealContent(request, session);
      case "update_view":
        return handleUpdateView(request, session);
      case "confirm_action":
        return handleConfirmAction(request, session);
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
