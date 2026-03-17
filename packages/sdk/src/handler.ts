import { Result } from "better-result";
import {
  AuthError,
  InternalError,
  NotFoundError,
  PermissionError,
  ValidationError,
} from "@xmtp/signet-schemas";
import type { SignetEvent, SignetError } from "@xmtp/signet-schemas";
import type { SignetHandlerConfig } from "./config.js";
import type {
  SignetHandler,
  HandlerState,
  SessionInfo,
  MessageContent,
  MessageSent,
  ReactionSent,
  Conversation,
  ConversationInfo,
  StateChangeCallback,
  ErrorCallback,
} from "./types.js";
import { createEventStream } from "./event-stream.js";
import type { EventStream } from "./event-stream.js";
import { createRequestTracker } from "./request-tracker.js";
import type { RequestTracker } from "./request-tracker.js";
import { isRetryable, createReconnectionTracker } from "./reconnection.js";
import type { ReconnectionTracker } from "./reconnection.js";
import { createHeartbeatMonitor } from "./heartbeat-monitor.js";
import type { HeartbeatMonitor } from "./heartbeat-monitor.js";

/** Authenticated frame from the signet. */
interface AuthenticatedFrameData {
  type: "authenticated";
  connectionId: string;
  session: {
    sessionId: string;
    agentInboxId: string;
    sessionKeyFingerprint: string;
    issuedAt: string;
    expiresAt: string;
  };
  view: Record<string, unknown>;
  grant: Record<string, unknown>;
  resumedFromSeq: number | null;
}

/** Auth error frame from the signet. */
interface AuthErrorFrameData {
  type: "auth_error";
  code: number;
  message: string;
}

/** Sequenced event frame from the signet. */
interface SequencedFrameData {
  seq: number;
  event: SignetEvent;
}

/** Backpressure frame from the signet. */
interface BackpressureFrameData {
  type: "backpressure";
  buffered: number;
  limit: number;
}

/** Request response frame from the signet. */
interface ResponseFrameData {
  ok: boolean;
  requestId: string;
  data?: unknown;
  error?: {
    code: number;
    category: string;
    message: string;
    context: Record<string, unknown> | null;
  };
}

/**
 * Validate that a value is an object containing the expected string fields.
 * Returns the value narrowed to a Record, or null if validation fails.
 */
function hasStringFields<K extends string>(
  value: unknown,
  fields: readonly K[],
): Record<K, string> | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  for (const field of fields) {
    if (typeof obj[field] !== "string") return null;
  }
  return obj as Record<K, string>;
}

/** Create a SignetHandler. Does NOT connect -- call connect() separately. */
export function createSignetHandler(
  config: SignetHandlerConfig,
): SignetHandler {
  let state: HandlerState = "disconnected";
  let ws: WebSocket | null = null;
  let sessionInfo: SessionInfo | null = null;
  let lastSeenSeq: number | null = null;
  let eventStream: EventStream = createEventStream();
  const requestTracker: RequestTracker = createRequestTracker(
    config.requestTimeoutMs,
  );
  const stateListeners = new Set<StateChangeCallback>();
  const errorListeners = new Set<ErrorCallback>();
  let heartbeatMonitor: HeartbeatMonitor | null = null;
  let reconnectionTracker: ReconnectionTracker | null = null;

  if (config.reconnect.enabled) {
    reconnectionTracker = createReconnectionTracker({
      enabled: config.reconnect.enabled,
      maxAttempts: config.reconnect.maxAttempts,
      baseDelayMs: config.reconnect.baseDelayMs,
      maxDelayMs: config.reconnect.maxDelayMs,
      jitter: config.reconnect.jitter,
    });
  }

  function setState(newState: HandlerState): void {
    const prev = state;
    if (prev === newState) return;
    state = newState;
    for (const listener of stateListeners) {
      listener(newState, prev);
    }
  }

  function emitError(error: SignetError): void {
    for (const listener of errorListeners) {
      listener(error);
    }
  }

  function handleConnectionDead(): void {
    heartbeatMonitor?.stop();
    if (ws) {
      // Close the socket — the close listener will call attemptReconnect().
      ws.close();
    } else {
      // No socket to close, trigger reconnect directly.
      attemptReconnect();
    }
  }

  function attemptReconnect(): void {
    if (!reconnectionTracker || !config.reconnect.enabled) {
      setState("disconnected");
      eventStream.complete();
      return;
    }

    if (reconnectionTracker.exhausted) {
      emitError(InternalError.create("Max reconnection attempts exceeded"));
      setState("disconnected");
      eventStream.complete();
      return;
    }

    setState("reconnecting");
    const delay = reconnectionTracker.nextDelay();
    setTimeout(() => {
      if (state !== "reconnecting") return;
      connectInternal().catch(() => {
        attemptReconnect();
      });
    }, delay);
  }

  function handleFrame(raw: string): void {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      emitError(ValidationError.create("frame", "Invalid JSON from signet"));
      return;
    }

    // Check for backpressure frame
    if (data["type"] === "backpressure") {
      const bp = data as unknown as BackpressureFrameData;
      emitError(
        InternalError.create(
          `Backpressure: ${bp.buffered}/${bp.limit} buffered`,
          { buffered: bp.buffered, limit: bp.limit },
        ),
      );
      return;
    }

    // Check for response frame (has requestId and ok)
    if ("requestId" in data && "ok" in data) {
      const resp = data as unknown as ResponseFrameData;
      if (resp.ok) {
        requestTracker.resolve(resp.requestId, Result.ok(resp.data));
      } else {
        const errMsg = resp.error?.message ?? "Request failed";
        const errCtx = resp.error?.context ?? undefined;
        const category = resp.error?.category;

        let signetError: SignetError;
        switch (category) {
          case "auth":
            signetError = AuthError.create(errMsg, errCtx);
            break;
          case "validation":
            signetError = ValidationError.create("response", errMsg);
            break;
          case "not_found":
            signetError = NotFoundError.create("resource", errMsg);
            break;
          case "permission":
            signetError = PermissionError.create(errMsg, errCtx);
            break;
          default:
            signetError = InternalError.create(errMsg, errCtx);
            break;
        }

        requestTracker.resolve(resp.requestId, Result.err(signetError));
      }
      return;
    }

    // Check for sequenced event frame (has seq + event)
    if ("seq" in data && "event" in data) {
      const frame = data as unknown as SequencedFrameData;
      lastSeenSeq = frame.seq;

      // Record heartbeat events for dead-connection detection
      if (
        typeof frame.event === "object" &&
        frame.event !== null &&
        "type" in frame.event &&
        frame.event.type === "heartbeat"
      ) {
        heartbeatMonitor?.recordHeartbeat();
      }

      eventStream.push(frame.event);
      return;
    }
  }

  async function connectInternal(): Promise<Result<void, SignetError>> {
    setState("connecting");

    return new Promise((resolve) => {
      const socket = new WebSocket(config.url);
      ws = socket;

      let authHandled = false;

      // Auth timeout: if signet accepts the WebSocket but never sends an
      // auth response, reject rather than hanging forever.
      const authTimeout = setTimeout(() => {
        if (!authHandled) {
          authHandled = true;
          socket.close(4000, "Auth timeout");
          setState("closed");
          resolve(
            Result.err(
              InternalError.create(
                `Auth response not received within ${config.requestTimeoutMs}ms`,
              ),
            ),
          );
        }
      }, config.requestTimeoutMs);

      socket.addEventListener("open", () => {
        setState("authenticating");
        socket.send(
          JSON.stringify({
            type: "auth",
            token: config.token,
            lastSeenSeq,
          }),
        );
      });

      socket.addEventListener("message", (event) => {
        const raw =
          typeof event.data === "string" ? event.data : event.data.toString();

        if (!authHandled) {
          // First message should be auth response
          let data: Record<string, unknown>;
          try {
            data = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            clearTimeout(authTimeout);
            setState("closed");
            resolve(
              Result.err(AuthError.create("Invalid auth response from signet")),
            );
            return;
          }

          if (data["type"] === "authenticated") {
            authHandled = true;
            clearTimeout(authTimeout);
            const authData = data as unknown as AuthenticatedFrameData;
            sessionInfo = {
              connectionId: authData.connectionId,
              sessionId: authData.session.sessionId,
              agentInboxId: authData.session.agentInboxId,
              view: authData.view,
              grant: authData.grant,
              expiresAt: authData.session.expiresAt,
            };

            // Start heartbeat monitoring
            heartbeatMonitor = createHeartbeatMonitor({
              intervalMs: 30_000,
              missedBeforeDead: 3,
            });
            heartbeatMonitor.start(handleConnectionDead);

            // Reset reconnection counter on successful connect
            reconnectionTracker?.reset();

            setState("connected");
            resolve(Result.ok(undefined));
          } else if (data["type"] === "auth_error") {
            authHandled = true;
            clearTimeout(authTimeout);
            const authErr = data as unknown as AuthErrorFrameData;
            setState("closed");
            resolve(
              Result.err(
                AuthError.create(authErr.message, {
                  code: authErr.code,
                }),
              ),
            );
          }
          return;
        }

        // Post-auth messages
        handleFrame(raw);
      });

      socket.addEventListener("close", (event) => {
        heartbeatMonitor?.stop();

        if (!authHandled) {
          authHandled = true;
          clearTimeout(authTimeout);
          if (!isRetryable(event.code)) {
            setState("closed");
            resolve(
              Result.err(
                AuthError.create(
                  event.reason || "Connection closed during auth",
                ),
              ),
            );
          } else {
            // Connection failed during auth, try reconnect
            requestTracker.rejectAll(InternalError.create("Connection lost"));
            attemptReconnect();
            resolve(
              Result.err(InternalError.create("Connection lost during auth")),
            );
          }
          return;
        }

        // Post-auth close
        ws = null;
        requestTracker.rejectAll(InternalError.create("Connection closed"));

        if (!isRetryable(event.code)) {
          setState("closed");
          eventStream.complete();
        } else if (state !== "closed") {
          attemptReconnect();
        }
      });

      socket.addEventListener("error", () => {
        // Error events are followed by close events, handled above
      });
    });
  }

  async function sendRequest(
    request: Record<string, unknown>,
  ): Promise<Result<unknown, SignetError>> {
    if (state !== "connected" || !ws) {
      return Result.err(
        ValidationError.create("state", "Not connected to signet"),
      );
    }

    const requestId = crypto.randomUUID();
    const promise = requestTracker.track(requestId);

    ws.send(JSON.stringify({ ...request, requestId }));

    return promise;
  }

  const handler: SignetHandler = {
    async connect(): Promise<Result<void, SignetError>> {
      if (state === "closed") {
        return Result.err(
          ValidationError.create(
            "state",
            "Handler is closed and cannot be reused",
          ),
        );
      }
      if (state === "connected") {
        return Result.ok(undefined);
      }
      if (
        state === "connecting" ||
        state === "authenticating" ||
        state === "reconnecting"
      ) {
        return Result.err(
          ValidationError.create(
            "state",
            `Connection already in progress (state: ${state})`,
          ),
        );
      }
      // Create fresh event stream on connect
      eventStream = createEventStream();
      return connectInternal();
    },

    async disconnect(): Promise<Result<void, SignetError>> {
      heartbeatMonitor?.stop();
      requestTracker.rejectAll(InternalError.create("Disconnecting"));

      if (ws) {
        ws.close(1000, "Client disconnect");
        ws = null;
      }

      setState("closed");
      eventStream.complete();
      return Result.ok(undefined);
    },

    get events(): AsyncIterable<SignetEvent> {
      return eventStream;
    },

    async sendMessage(
      groupId: string,
      content: MessageContent,
    ): Promise<Result<MessageSent, SignetError>> {
      const contentType =
        content.type === "text" ? "xmtp.org/text:1.0" : content.contentType;
      const payload =
        content.type === "text" ? { text: content.text } : content.content;

      const result = await sendRequest({
        type: "send_message",
        groupId,
        contentType,
        content: payload,
      });

      if (result.isErr()) return Result.err(result.error);
      const data = hasStringFields(result.value, [
        "messageId",
        "groupId",
        "sentAt",
      ]);
      if (data === null) {
        return Result.err(
          ValidationError.create(
            "response",
            "Missing required fields: messageId, groupId, sentAt",
          ),
        );
      }
      return Result.ok({
        messageId: data.messageId,
        groupId: data.groupId,
        sentAt: data.sentAt,
      });
    },

    async sendReaction(
      groupId: string,
      messageId: string,
      reaction: string,
    ): Promise<Result<ReactionSent, SignetError>> {
      const result = await sendRequest({
        type: "send_reaction",
        groupId,
        messageId,
        action: "added",
        content: reaction,
      });

      if (result.isErr()) return Result.err(result.error);
      const data = hasStringFields(result.value, [
        "messageId",
        "groupId",
        "sentAt",
      ]);
      if (data === null) {
        return Result.err(
          ValidationError.create(
            "response",
            "Missing required fields: messageId, groupId, sentAt",
          ),
        );
      }
      return Result.ok({
        messageId: data.messageId,
        groupId: data.groupId,
        sentAt: data.sentAt,
      });
    },

    async listConversations(): Promise<Result<Conversation[], SignetError>> {
      const result = await sendRequest({
        type: "list_conversations",
      });

      if (result.isErr()) return Result.err(result.error);
      if (!Array.isArray(result.value)) {
        return Result.err(
          ValidationError.create(
            "response",
            "Expected array for list_conversations response",
          ),
        );
      }
      return Result.ok(result.value as Conversation[]);
    },

    async getConversationInfo(
      groupId: string,
    ): Promise<Result<ConversationInfo, SignetError>> {
      const result = await sendRequest({
        type: "get_conversation_info",
        groupId,
      });

      if (result.isErr()) return Result.err(result.error);
      if (typeof result.value !== "object" || result.value === null) {
        return Result.err(
          ValidationError.create(
            "response",
            "Expected object for get_conversation_info response",
          ),
        );
      }
      return Result.ok(result.value as ConversationInfo);
    },

    get session(): SessionInfo | null {
      return sessionInfo;
    },

    get state(): HandlerState {
      return state;
    },

    onStateChange(callback: StateChangeCallback): () => void {
      stateListeners.add(callback);
      return () => {
        stateListeners.delete(callback);
      };
    },

    onError(callback: ErrorCallback): () => void {
      errorListeners.add(callback);
      return () => {
        errorListeners.delete(callback);
      };
    },
  };

  return handler;
}
