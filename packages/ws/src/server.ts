import type { ServerWebSocket } from "bun";
import { z } from "zod";
import { Result } from "better-result";
import type { SignetEvent, SignetError } from "@xmtp/signet-schemas";
import {
  HarnessRequest as HarnessRequestSchema,
  InternalError as InternalErrorClass,
} from "@xmtp/signet-schemas";
import type {
  SignetCore,
  CredentialRecord,
  SealManager,
} from "@xmtp/signet-contracts";
import type { WsServerConfig } from "./config.js";
import { WsServerConfigSchema } from "./config.js";
import {
  type ConnectionData,
  type CredentialReplayState,
  createConnectionState,
  transition,
} from "./connection-state.js";
import { ConnectionRegistry } from "./connection-registry.js";
import { CircularBuffer } from "./replay-buffer.js";
import {
  AuthFrame,
  type AuthErrorFrame,
  type SequencedFrame,
} from "./frames.js";
import { handleAuth, type TokenLookup } from "./auth-handler.js";
import { routeRequest, type RequestHandler } from "./request-router.js";
import { sequenceEvent } from "./event-broadcaster.js";
import { WS_CLOSE_CODES } from "./close-codes.js";

/** Lifecycle states for the websocket server. */
export type WsServerState = "idle" | "listening" | "draining" | "stopped";

/**
 * Callback to look up a credential by its ID.
 * Injected by the composition root -- the WS layer works with the
 * runtime-enriched CredentialRecord, not the raw schema type.
 */
export type CredentialLookup = (
  credentialId: string,
) => Promise<Result<CredentialRecord, SignetError>>;

/** Dependencies required to run the websocket transport. */
export interface WsServerDeps {
  readonly core: SignetCore;
  readonly credentialLookup: CredentialLookup;
  readonly sealManager: SealManager;
  readonly tokenLookup: TokenLookup;
  readonly requestHandler: RequestHandler;
  /** Optional event projector for scope-based filtering before broadcast. */
  readonly projectEvent?: (
    event: SignetEvent,
    credential: CredentialRecord,
  ) => SignetEvent | null;
}

/** Public lifecycle and broadcast surface for the websocket transport. */
export interface WsServer {
  start(): Promise<Result<{ port: number }, SignetError>>;
  stop(): Promise<Result<void, SignetError>>;
  readonly state: WsServerState;
  readonly connectionCount: number;
  /** Broadcast an event to all connections for a credential. */
  broadcast(credentialId: string, event: SignetEvent): void;
  /**
   * Invalidate cached credential state for all connections on a credential.
   * Call this when credential policy changes from outside the WS request path
   * (admin, HTTP, MCP, expiry, revocation) so broadcasts project correctly.
   */
  invalidateCredential(credentialId: string): Promise<void>;
}

/**
 * Create the websocket server that fronts the signet harness transport.
 */
export function createWsServer(
  rawConfig: Partial<WsServerConfig>,
  deps: WsServerDeps,
): WsServer {
  const config = WsServerConfigSchema.parse(rawConfig);
  const registry = new ConnectionRegistry();
  /** Per-credential replay state: survives reconnections. */
  const credentialStates = new Map<string, CredentialReplayState>();
  /** Credentials with pending invalidations -- broadcasts queue until all in-flight lookups complete. */
  const pendingInvalidations = new Map<
    string,
    { refcount: number; generation: number; events: SignetEvent[] }
  >();
  /** Monotonic counter — highest generation wins the cache write. */
  let invalidationGen = 0;
  let serverState: WsServerState = "idle";
  let bunServer: ReturnType<typeof Bun.serve<ConnectionData>> | null = null;

  function getOrCreateCredentialState(
    credentialId: string,
  ): CredentialReplayState {
    let state = credentialStates.get(credentialId);
    if (!state) {
      state = {
        buffer: new CircularBuffer<SequencedFrame>(config.replayBufferSize),
        nextSeq: 1,
      };
      credentialStates.set(credentialId, state);
    }
    return state;
  }

  function sendJson(
    ws: ServerWebSocket<ConnectionData>,
    data: unknown,
  ): number {
    const msg = JSON.stringify(data);
    const sendResult = ws.send(msg);
    if (sendResult === -1) {
      ws.data.backpressure.increment();
    }
    return sendResult;
  }

  function sendSequenced(
    ws: ServerWebSocket<ConnectionData>,
    event: SignetEvent,
  ): void {
    const credentialState = ws.data.credentialReplayState;
    if (!credentialState) return;

    const frame = sequenceEvent(credentialState, event);
    sendJson(ws, frame);

    // Check backpressure
    const bpState = ws.data.backpressure.state;
    if (bpState === "exceeded") {
      ws.close(WS_CLOSE_CODES.BACKPRESSURE, "Send buffer hard limit exceeded");
      return;
    }
    if (bpState === "warning" && !ws.data.backpressure.notified) {
      ws.data.backpressure.markNotified();
      sendJson(ws, {
        type: "backpressure",
        buffered: ws.data.backpressure.depth,
        limit: config.sendBufferHardLimit,
      });
      // Re-check after warning send -- the warning itself may push us over
      if (ws.data.backpressure.state === "exceeded") {
        ws.close(
          WS_CLOSE_CODES.BACKPRESSURE,
          "Send buffer hard limit exceeded",
        );
        return;
      }
    }
  }

  function cleanupConnection(ws: ServerWebSocket<ConnectionData>): void {
    const data = ws.data;

    // Clear timers
    if (data.authTimer !== null) {
      clearTimeout(data.authTimer);
      data.authTimer = null;
    }
    if (data.heartbeatTimer !== null) {
      clearInterval(data.heartbeatTimer);
      data.heartbeatTimer = null;
    }

    // Clear in-flight request timers
    for (const [, entry] of data.inFlightRequests) {
      clearTimeout(entry.timer);
    }
    data.inFlightRequests.clear();

    // Remove from registry
    registry.remove(data.connectionId);

    transition(data, "closed");
  }

  function stopHeartbeat(ws: ServerWebSocket<ConnectionData>): void {
    if (ws.data.heartbeatTimer !== null) {
      clearInterval(ws.data.heartbeatTimer);
      ws.data.heartbeatTimer = null;
    }
  }

  function startHeartbeat(ws: ServerWebSocket<ConnectionData>): void {
    const credentialRecord = ws.data.credentialRecord;
    if (!credentialRecord) return;

    const deadThresholdMs =
      config.missedHeartbeatsBeforeDead * config.heartbeatIntervalMs;

    ws.data.heartbeatTimer = setInterval(async () => {
      if (ws.data.phase !== "active") return;

      // Dead-connection detection: close if no inbound activity
      const elapsed = Date.now() - ws.data.lastClientActivity;
      if (elapsed > deadThresholdMs) {
        ws.close(
          WS_CLOSE_CODES.DEAD_CONNECTION,
          "Dead connection: no client activity",
        );
        return;
      }

      // Refresh credential state so idle sockets pick up revocations/narrowing.
      // This ensures broadcasts also see current permissions.
      const currentCredentialId =
        ws.data.credentialRecord?.credentialId ?? credentialRecord.credentialId;
      const lookupResult = await deps.credentialLookup(currentCredentialId);
      if (!lookupResult.isOk()) {
        ws.close(
          WS_CLOSE_CODES.CREDENTIAL_REVOKED,
          "Credential no longer valid",
        );
        stopHeartbeat(ws);
        return;
      }
      const fresh = lookupResult.value;
      ws.data.credentialRecord = fresh;

      if (fresh.status !== "active") {
        const closeCode =
          fresh.status === "revoked"
            ? WS_CLOSE_CODES.SESSION_REVOKED
            : fresh.status === "expired"
              ? WS_CLOSE_CODES.SESSION_EXPIRED
              : WS_CLOSE_CODES.POLICY_CHANGE;
        ws.close(closeCode, `Credential is ${fresh.status}`);
        stopHeartbeat(ws);
        return;
      }

      sendSequenced(ws, {
        type: "heartbeat",
        credentialId: currentCredentialId,
        timestamp: new Date().toISOString(),
      });
    }, config.heartbeatIntervalMs);
  }

  async function handleAuthFrame(
    ws: ServerWebSocket<ConnectionData>,
    frame: unknown,
  ): Promise<void> {
    // Guard: timer may have already fired and closed the connection
    if (ws.data.phase !== "authenticating") return;

    // Clear auth timer
    if (ws.data.authTimer !== null) {
      clearTimeout(ws.data.authTimer);
      ws.data.authTimer = null;
    }

    // Parse the auth frame
    const parsed = AuthFrame.safeParse(frame);
    if (!parsed.success) {
      sendJson(ws, {
        type: "auth_error",
        code: WS_CLOSE_CODES.PROTOCOL_ERROR,
        message: "Invalid auth frame",
      } satisfies AuthErrorFrame);
      ws.close(WS_CLOSE_CODES.PROTOCOL_ERROR, "Invalid auth frame");
      return;
    }

    const authFrame = parsed.data;
    const result = await handleAuth(authFrame, deps.tokenLookup);

    if (!result.isOk()) {
      sendJson(ws, {
        type: "auth_error",
        code: WS_CLOSE_CODES.AUTH_FAILED,
        message: result.error.message,
      } satisfies AuthErrorFrame);
      ws.close(WS_CLOSE_CODES.AUTH_FAILED, "Auth failed");
      return;
    }

    const credential = result.value;

    // Transition to active
    ws.data.credentialRecord = credential;
    ws.data.credentialId = credential.credentialId;
    ws.data.operatorId = credential.operatorId;
    transition(ws.data, "active");

    // Attach credential replay state (shared across reconnections)
    const credentialState = getOrCreateCredentialState(credential.credentialId);
    ws.data.credentialReplayState = credentialState;

    // Register connection
    registry.add(ws);

    // Handle replay
    let resumedFromSeq: number | null = null;
    let needsRecovery = false;
    let replayFrames: readonly SequencedFrame[] = [];

    if (authFrame.lastSeenSeq !== null) {
      const lastSeen = authFrame.lastSeenSeq;
      const oldestFrame = credentialState.buffer.oldest();
      if (oldestFrame !== undefined && oldestFrame.seq > lastSeen + 1) {
        needsRecovery = true;
      } else {
        replayFrames = credentialState.buffer.itemsSince(
          (f: SequencedFrame) => f.seq > lastSeen,
        );

        if (replayFrames.length > 0) {
          resumedFromSeq = lastSeen;
        }
      }
    }

    // Send authenticated frame
    sendJson(ws, {
      type: "authenticated",
      connectionId: ws.data.connectionId,
      credential: {
        credentialId: credential.credentialId,
        operatorId: credential.operatorId,
        fingerprint: tokenFingerprint,
        issuedAt: credential.issuedAt,
        expiresAt: credential.expiresAt,
      },
      effectiveScopes: credential.effectiveScopes,
      resumedFromSeq,
    });

    // Send recovery event if client is too far behind
    if (needsRecovery) {
      sendSequenced(ws, {
        type: "signet.recovery.complete",
        caughtUpThrough: new Date().toISOString(),
      });
    }

    // Replay buffered events
    if (!needsRecovery) {
      for (const replayFrame of replayFrames) {
        sendJson(ws, replayFrame);
      }
    }

    // Start heartbeat
    startHeartbeat(ws);
  }

  async function handleRequestFrame(
    ws: ServerWebSocket<ConnectionData>,
    frame: unknown,
  ): Promise<void> {
    const cachedCredential = ws.data.credentialRecord;
    if (!cachedCredential) {
      ws.close(WS_CLOSE_CODES.PROTOCOL_ERROR, "Not authenticated");
      return;
    }

    // Fresh credential lookup -- fail closed on errors instead of
    // falling back to a stale snapshot that may be revoked/expired.
    const lookupResult = await deps.credentialLookup(
      cachedCredential.credentialId,
    );
    if (!lookupResult.isOk()) {
      ws.close(WS_CLOSE_CODES.CREDENTIAL_REVOKED, "Credential no longer valid");
      stopHeartbeat(ws);
      return;
    }
    const credential = lookupResult.value;
    ws.data.credentialRecord = credential;

    // Reject non-active credentials -- close the socket so the client
    // doesn't stay on a "healthy-looking" connection.
    if (credential.status !== "active") {
      const closeCode =
        credential.status === "revoked"
          ? WS_CLOSE_CODES.SESSION_REVOKED
          : credential.status === "expired"
            ? WS_CLOSE_CODES.SESSION_EXPIRED
            : WS_CLOSE_CODES.POLICY_CHANGE;
      ws.close(closeCode, `Credential is ${credential.status}`);
      stopHeartbeat(ws);
      return;
    }

    // Parse request
    const parsed = HarnessRequestSchema.safeParse(frame);
    if (!parsed.success) {
      // Try to extract requestId for error response
      const FrameWithRequestId = z
        .object({ requestId: z.string() })
        .passthrough();
      const requestIdParsed = FrameWithRequestId.safeParse(frame);
      const maybeId = requestIdParsed.success
        ? requestIdParsed.data.requestId
        : undefined;

      if (typeof maybeId === "string") {
        sendJson(ws, {
          ok: false,
          requestId: maybeId,
          error: {
            code: 1000,
            category: "validation",
            message: "Invalid request frame",
            context: null,
          },
        });
      } else {
        ws.close(WS_CLOSE_CODES.PROTOCOL_ERROR, "Malformed frame");
      }
      return;
    }

    const request = parsed.data;
    const requestId = request.requestId;

    // Set up timeout
    const timeoutTimer = setTimeout(() => {
      ws.data.inFlightRequests.delete(requestId);
      sendJson(ws, {
        ok: false,
        requestId,
        error: {
          code: 1500,
          category: "timeout",
          message: "Request timed out",
          context: {
            operation: request.type,
            timeoutMs: config.requestTimeoutMs,
          },
        },
      });
    }, config.requestTimeoutMs);

    ws.data.inFlightRequests.set(requestId, {
      timer: timeoutTimer,
      sentAt: Date.now(),
    });

    try {
      const response = await routeRequest(
        request,
        credential,
        deps.requestHandler,
      );

      // Re-sync cached credential after mutating requests so broadcasts
      // immediately see updated policy instead of waiting for the next heartbeat.
      if (
        request.type === "update_scopes" ||
        request.type === "reveal_content"
      ) {
        const refreshResult = await deps.credentialLookup(
          credential.credentialId,
        );
        if (refreshResult.isOk()) {
          ws.data.credentialRecord = refreshResult.value;
        }
      }

      const inflight = ws.data.inFlightRequests.get(requestId);
      if (!inflight) {
        return;
      }
      clearTimeout(inflight.timer);
      ws.data.inFlightRequests.delete(requestId);

      sendJson(ws, response);
    } catch {
      const inflight = ws.data.inFlightRequests.get(requestId);
      if (!inflight) {
        return;
      }
      clearTimeout(inflight.timer);
      ws.data.inFlightRequests.delete(requestId);

      sendJson(ws, {
        ok: false,
        requestId,
        error: {
          code: 1400,
          category: "internal",
          message: "Internal error",
          context: null,
        },
      });
    }
  }

  function broadcastToCredential(
    credentialId: string,
    event: SignetEvent,
  ): void {
    // Queue events while any invalidation is in flight -- they'll be
    // replayed with the fresh credential snapshot once all lookups complete.
    const pending = pendingInvalidations.get(credentialId);
    if (pending !== undefined) {
      pending.events.push(event);
      return;
    }

    const connections = registry.getByCredentialId(credentialId);
    for (const ws of connections) {
      if (ws.data.phase === "active") {
        const credential = ws.data.credentialRecord;
        if (!credential) continue;

        // Skip non-active credentials (will be closed on next request)
        if (credential.status !== "active") continue;

        if (deps.projectEvent) {
          const projected = deps.projectEvent(event, credential);
          if (projected === null) continue;
          sendSequenced(ws, projected);
        } else {
          sendSequenced(ws, event);
        }
      }
    }
  }

  const server: WsServer = {
    get state() {
      return serverState;
    },

    get connectionCount() {
      return registry.size;
    },

    broadcast: broadcastToCredential,

    async invalidateCredential(credentialId: string): Promise<void> {
      // Each invalidation gets a generation number. Only the highest
      // generation writes to the cache, so later (narrower) policy
      // always wins over earlier (broader) lookups that resolve late.
      const myGen = ++invalidationGen;
      const existing = pendingInvalidations.get(credentialId);
      if (existing) {
        existing.refcount++;
        existing.generation = myGen;
      } else {
        pendingInvalidations.set(credentialId, {
          refcount: 1,
          generation: myGen,
          events: [],
        });
      }
      try {
        const lookupResult = await deps.credentialLookup(credentialId);

        // Only apply if this is still the latest invalidation for this credential.
        // An earlier broader lookup that resolves after a later narrower one
        // must not overwrite the narrower snapshot.
        const entry = pendingInvalidations.get(credentialId);
        if (!entry || entry.generation !== myGen) return;

        const connections = registry.getByCredentialId(credentialId);
        for (const ws of connections) {
          if (ws.data.phase !== "active") continue;

          if (!lookupResult.isOk()) {
            ws.close(
              WS_CLOSE_CODES.CREDENTIAL_REVOKED,
              "Credential no longer valid",
            );
            stopHeartbeat(ws);
            continue;
          }

          const fresh = lookupResult.value;
          ws.data.credentialRecord = fresh;

          if (fresh.status !== "active") {
            const closeCode =
              fresh.status === "revoked"
                ? WS_CLOSE_CODES.SESSION_REVOKED
                : fresh.status === "expired"
                  ? WS_CLOSE_CODES.SESSION_EXPIRED
                  : WS_CLOSE_CODES.POLICY_CHANGE;
            ws.close(closeCode, `Credential is ${fresh.status}`);
            stopHeartbeat(ws);
          }
        }
      } finally {
        const entry = pendingInvalidations.get(credentialId);
        if (entry) {
          entry.refcount--;
          if (entry.refcount <= 0) {
            // Last invalidation done -- drain queued events with fresh snapshot
            const queued = entry.events;
            pendingInvalidations.delete(credentialId);
            for (const event of queued) {
              broadcastToCredential(credentialId, event);
            }
          }
        }
      }
    },

    async start() {
      if (serverState !== "idle") {
        return Result.err(
          InternalErrorClass.create("Server is not in idle state"),
        );
      }

      try {
        bunServer = Bun.serve<ConnectionData>({
          port: config.port,
          hostname: config.host,
          fetch(req, srv) {
            const url = new URL(req.url);
            if (url.pathname === "/v1/agent") {
              const data = createConnectionState(
                config.sendBufferSoftLimit,
                config.sendBufferHardLimit,
              );
              const upgraded = srv.upgrade(req, { data });
              if (!upgraded) {
                return new Response("Upgrade failed", { status: 400 });
              }
              return undefined;
            }
            return new Response("Not found", { status: 404 });
          },
          websocket: {
            open(ws) {
              if (serverState === "draining" || serverState === "stopped") {
                ws.close(WS_CLOSE_CODES.GOING_AWAY, "Server shutting down");
                return;
              }

              // Start auth timeout
              ws.data.authTimer = setTimeout(() => {
                if (ws.data.phase === "authenticating") {
                  sendJson(ws, {
                    type: "auth_error",
                    code: WS_CLOSE_CODES.AUTH_TIMEOUT,
                    message: "Auth timeout",
                  } satisfies AuthErrorFrame);
                  ws.close(WS_CLOSE_CODES.AUTH_TIMEOUT, "Auth timeout");
                }
              }, config.authTimeoutMs);
            },

            message(ws, message) {
              if (ws.data.phase === "closed") return;

              // Track client activity for dead-connection detection
              const now = Date.now();
              ws.data.lastClientActivity = now;

              // Rate limiting (when enabled)
              if (config.rateLimitMaxMessages !== null) {
                if (
                  now - ws.data.messageWindowStart >=
                  config.rateLimitWindowMs
                ) {
                  // Window expired, reset
                  ws.data.messageCount = 1;
                  ws.data.messageWindowStart = now;
                } else {
                  ws.data.messageCount++;
                  if (ws.data.messageCount > config.rateLimitMaxMessages) {
                    ws.close(
                      WS_CLOSE_CODES.RATE_LIMITED,
                      "Rate limit exceeded",
                    );
                    return;
                  }
                }
              }

              let frame: unknown;
              try {
                frame = JSON.parse(
                  typeof message === "string"
                    ? message
                    : new TextDecoder().decode(message),
                );
              } catch {
                ws.close(WS_CLOSE_CODES.PROTOCOL_ERROR, "Invalid JSON");
                return;
              }

              if (ws.data.phase === "authenticating") {
                void handleAuthFrame(ws, frame);
                return;
              }

              if (ws.data.phase === "active") {
                void handleRequestFrame(ws, frame);
                return;
              }

              // draining: ignore new requests
            },

            close(ws, _code, _reason) {
              cleanupConnection(ws);
            },

            drain(ws) {
              // Bun fires drain once when the kernel buffer drains,
              // not once per send -- reset depth to 0.
              ws.data.backpressure.reset();
            },

            maxPayloadLength: config.maxFrameSizeBytes,
            idleTimeout: Math.ceil(
              (config.missedHeartbeatsBeforeDead * config.heartbeatIntervalMs) /
                1_000,
            ),
          },
        });

        serverState = "listening";
        const assignedPort = bunServer.port;
        if (assignedPort === undefined) {
          return Result.err(
            InternalErrorClass.create("Server started but port is undefined"),
          );
        }
        return Result.ok({ port: assignedPort });
      } catch (error: unknown) {
        return Result.err(
          InternalErrorClass.create(
            `Failed to start server: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    },

    async stop() {
      if (serverState !== "listening") {
        return Result.err(InternalErrorClass.create("Server is not listening"));
      }

      serverState = "draining";

      // Send credential.expired to all active connections
      const allConnections = registry.getAll();
      for (const ws of allConnections) {
        if (ws.data.phase === "active" && ws.data.credentialRecord) {
          sendSequenced(ws, {
            type: "credential.expired",
            credentialId: ws.data.credentialRecord.credentialId,
            reason: "signet_shutdown",
          });
          transition(ws.data, "draining");
        }
      }

      // Wait for in-flight requests to complete
      await new Promise<void>((resolve) => {
        const deadline = setTimeout(() => {
          resolve();
        }, config.drainTimeoutMs);

        const checkInflight = () => {
          let hasInflight = false;
          for (const ws of registry.getAll()) {
            if (ws.data.inFlightRequests.size > 0) {
              hasInflight = true;
              break;
            }
          }
          if (!hasInflight) {
            clearTimeout(deadline);
            resolve();
          } else {
            setTimeout(checkInflight, 50);
          }
        };

        checkInflight();
      });

      // Close all connections (close before cleanup so close code is sent)
      const remaining = registry.getAll();
      for (const ws of remaining) {
        ws.close(WS_CLOSE_CODES.GOING_AWAY, "Server shutting down");
      }

      // Allow close frames to flush before stopping the server
      await new Promise((r) => setTimeout(r, 50));

      for (const ws of remaining) {
        cleanupConnection(ws);
      }

      // Clean up credential states
      credentialStates.clear();

      // Stop the server (false = don't force-close remaining connections)
      if (bunServer) {
        bunServer.stop(false);
        bunServer = null;
      }

      serverState = "stopped";
      return Result.ok(undefined);
    },
  };

  return server;
}
