import { Result } from "better-result";
import {
  AuthError,
  InternalError,
  PermissionError,
} from "@xmtp-broker/schemas";
import type {
  BrokerError,
  HarnessRequest,
  SendMessageRequest,
} from "@xmtp-broker/schemas";
import type { SessionManager, SessionRecord } from "@xmtp-broker/contracts";
import { validateSendMessage } from "@xmtp-broker/policy";
import type { RequestHandler } from "@xmtp-broker/ws";

export interface HarnessRequestHandlerDeps {
  readonly ensureCoreReady: () => Promise<Result<void, BrokerError>>;
  readonly sendMessage: (
    groupId: string,
    contentType: string,
    content: unknown,
  ) => Promise<Result<{ messageId: string }, BrokerError>>;
  readonly sessionManager: Pick<SessionManager, "heartbeat">;
}

export function createWsRequestHandler(
  deps: HarnessRequestHandlerDeps,
): RequestHandler {
  async function handleSendMessage(
    request: SendMessageRequest,
    session: SessionRecord,
  ): Promise<Result<{ messageId: string }, BrokerError>> {
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
  ): Promise<Result<null, BrokerError>> {
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

  return async (
    request: HarnessRequest,
    session: SessionRecord,
  ): Promise<Result<unknown, BrokerError>> => {
    switch (request.type) {
      case "send_message":
        return handleSendMessage(request, session);
      case "heartbeat":
        return handleHeartbeat(request, session);
      default:
        return Result.err(
          InternalError.create(
            `Harness request type '${request.type}' is not supported in Phase 2B`,
          ),
        );
    }
  };
}

export const createHarnessRequestHandler: typeof createWsRequestHandler =
  createWsRequestHandler;
