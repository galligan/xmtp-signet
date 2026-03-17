import type { SignetEvent } from "@xmtp/signet-schemas";
import type { ServerWebSocket } from "bun";

/** Wire data for an incoming auth frame from the handler SDK. */
interface AuthFrameData {
  type: "auth";
  token: string;
  lastSeenSeq: number | null;
}

/** Wire data for a harness request. */
interface RequestData {
  type: string;
  requestId: string;
  [key: string]: unknown;
}

/** Options for mock server behavior. */
export interface MockServerOptions {
  /** How the server handles auth. Default: "accept" */
  authBehavior?: "accept" | "reject" | "no-response";
  /** Whether to auto-respond to requests. Default: true */
  autoRespond?: boolean;
  /** Valid token(s) to accept. Default: "test-token" */
  validToken?: string;
}

/** Handle for the per-connection state. */
interface ConnectionState {
  ws: ServerWebSocket<{ connectionId: string }>;
  authenticated: boolean;
  seq: number;
  lastSeenSeq: number | null;
}

/** Mock signet server that implements the WS wire protocol. */
export interface MockSignetServer {
  readonly port: number;
  readonly connections: number;
  stop(): Promise<void>;
}

export interface TestHarness {
  handler: import("../types.js").SignetHandler;
  server: MockSignetServer;
  /** Push an event to all authenticated connections. */
  emitEvent: (event: SignetEvent) => void;
  /** Drop all connections (simulate transport failure). */
  dropConnection: () => void;
  /** Close all connections with a specific code. */
  closeWith: (code: number, reason: string) => void;
  /** Send a backpressure frame to all authenticated connections. */
  sendBackpressure: (frame: { buffered: number; limit: number }) => void;
  /** Clean up server and handler. */
  cleanup: () => Promise<void>;
}

/**
 * Create a mock signet server on a random port.
 * Returns a Bun.serve() instance that simulates the signet wire protocol.
 */
export function createMockServer(options: MockServerOptions = {}): {
  server: MockSignetServer;
  emitEvent: (event: SignetEvent) => void;
  dropConnection: () => void;
  closeWith: (code: number, reason: string) => void;
  sendBackpressure: (frame: { buffered: number; limit: number }) => void;
  url: string;
} {
  const {
    authBehavior = "accept",
    autoRespond = true,
    validToken = "test-token",
  } = options;

  const activeConnections = new Map<string, ConnectionState>();

  const bunServer = Bun.serve({
    port: 0,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/v1/agent") {
        const connectionId = crypto.randomUUID();
        const upgraded = server.upgrade(req, {
          data: { connectionId },
        });
        if (!upgraded) {
          return new Response("Upgrade failed", { status: 500 });
        }
        return undefined;
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(ws: ServerWebSocket<{ connectionId: string }>) {
        activeConnections.set(ws.data.connectionId, {
          ws,
          authenticated: false,
          seq: 0,
          lastSeenSeq: null,
        });
      },
      message(
        ws: ServerWebSocket<{ connectionId: string }>,
        message: string | Buffer,
      ) {
        const conn = activeConnections.get(ws.data.connectionId);
        if (!conn) return;

        let data: Record<string, unknown>;
        try {
          data = JSON.parse(
            typeof message === "string" ? message : message.toString(),
          ) as Record<string, unknown>;
        } catch {
          ws.close(4009, "Invalid JSON");
          return;
        }

        if (!conn.authenticated) {
          // Expect auth frame
          const authData = data as unknown as AuthFrameData;
          if (authData.type !== "auth") {
            ws.close(4009, "Expected auth frame");
            return;
          }

          conn.lastSeenSeq = authData.lastSeenSeq;

          if (authBehavior === "reject") {
            ws.send(
              JSON.stringify({
                type: "auth_error",
                code: 4001,
                message: "Invalid token",
              }),
            );
            ws.close(4001, "Auth failed");
            return;
          }

          if (authBehavior === "no-response") {
            // Don't respond at all
            return;
          }

          if (authData.token !== validToken) {
            ws.send(
              JSON.stringify({
                type: "auth_error",
                code: 4001,
                message: "Invalid token",
              }),
            );
            ws.close(4001, "Auth failed");
            return;
          }

          conn.authenticated = true;
          ws.send(
            JSON.stringify({
              type: "authenticated",
              connectionId: ws.data.connectionId,
              session: {
                sessionId: "sess_test",
                agentInboxId: "agent_inbox_1",
                sessionKeyFingerprint: "fp_test",
                issuedAt: "2024-01-01T00:00:00Z",
                expiresAt: "2025-01-01T00:00:00Z",
              },
              view: {
                mode: "full",
                contentTypeAllowlist: ["xmtp.org/text:1.0"],
              },
              grant: {
                messaging: {
                  send: true,
                  reply: true,
                  react: true,
                  draftOnly: false,
                },
              },
              resumedFromSeq: authData.lastSeenSeq,
            }),
          );
          return;
        }

        // Authenticated -- handle requests
        if (autoRespond) {
          const reqData = data as unknown as RequestData;
          if (reqData.requestId) {
            ws.send(
              JSON.stringify({
                ok: true,
                requestId: reqData.requestId,
                data: {
                  messageId: `msg_${reqData.requestId}`,
                  groupId: (reqData.groupId as string) ?? "g_unknown",
                  sentAt: new Date().toISOString(),
                },
              }),
            );
          }
        }
      },
      close(ws: ServerWebSocket<{ connectionId: string }>) {
        activeConnections.delete(ws.data.connectionId);
      },
    },
  });

  const port = bunServer.port;
  const url = `ws://127.0.0.1:${port}/v1/agent`;

  function emitEvent(event: SignetEvent): void {
    for (const conn of activeConnections.values()) {
      if (conn.authenticated) {
        conn.seq += 1;
        conn.ws.send(
          JSON.stringify({
            seq: conn.seq,
            event,
          }),
        );
      }
    }
  }

  function dropConnection(): void {
    for (const conn of activeConnections.values()) {
      // Close with abnormal closure to trigger reconnection
      conn.ws.close(1006, "Abnormal closure");
    }
  }

  function closeWith(code: number, reason: string): void {
    for (const conn of activeConnections.values()) {
      conn.ws.close(code, reason);
    }
  }

  function sendBackpressure(frame: { buffered: number; limit: number }): void {
    for (const conn of activeConnections.values()) {
      if (conn.authenticated) {
        conn.ws.send(
          JSON.stringify({
            type: "backpressure",
            buffered: frame.buffered,
            limit: frame.limit,
          }),
        );
      }
    }
  }

  const server: MockSignetServer = {
    get port() {
      return port;
    },
    get connections() {
      return activeConnections.size;
    },
    async stop() {
      for (const conn of activeConnections.values()) {
        conn.ws.close(1001, "Server stopping");
      }
      activeConnections.clear();
      bunServer.stop(true);
    },
  };

  return {
    server,
    emitEvent,
    dropConnection,
    closeWith,
    sendBackpressure,
    url,
  };
}

/** Helper: wait for a handler to reach a specific state. */
export function waitForState(
  handler: import("../types.js").SignetHandler,
  targetState: import("../types.js").HandlerState,
  timeoutMs = 5000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (handler.state === targetState) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      unsub();
      reject(
        new Error(
          `Timed out waiting for state '${targetState}', current: '${handler.state}'`,
        ),
      );
    }, timeoutMs);
    const unsub = handler.onStateChange((newState) => {
      if (newState === targetState) {
        clearTimeout(timer);
        unsub();
        resolve();
      }
    });
  });
}

/** Helper: take N items from an async iterable. */
export async function take<T>(
  iterable: AsyncIterable<T>,
  count: number,
): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
    if (items.length >= count) break;
  }
  return items;
}

/** Create a full test harness: mock server + handler. */
export function createTestHandler(options?: {
  config?: Partial<import("../config.js").SignetHandlerConfig>;
  serverOptions?: MockServerOptions;
}): TestHarness {
  const { createSignetHandler } = require("../handler.js") as {
    createSignetHandler: typeof import("../handler.js").createSignetHandler;
  };

  const {
    server,
    emitEvent,
    dropConnection,
    closeWith,
    sendBackpressure,
    url,
  } = createMockServer(options?.serverOptions);

  const handler = createSignetHandler({
    url: options?.config?.url ?? url,
    token: options?.config?.token ?? "test-token",
    reconnect: options?.config?.reconnect ?? { enabled: false },
    requestTimeoutMs: options?.config?.requestTimeoutMs ?? 5000,
  });

  return {
    handler,
    server,
    emitEvent,
    dropConnection,
    closeWith,
    sendBackpressure,
    async cleanup() {
      try {
        await handler.disconnect();
      } catch {
        // ignore
      }
      await server.stop();
    },
  };
}
