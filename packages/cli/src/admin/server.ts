import { Result } from "better-result";
import {
  InternalError,
  AuthError,
  type ValidationError,
} from "@xmtp/signet-schemas";
import type { HandlerContext } from "@xmtp/signet-contracts";
import type { AdminDispatcher } from "./dispatcher.js";
import {
  AdminAuthFrameSchema,
  JsonRpcRequestSchema,
  JSON_RPC_ERRORS,
  type AdminJwtPayload,
} from "./protocol.js";
import type { AdminServerConfig } from "../config/schema.js";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Admin Unix socket server with JWT authentication and JSON-RPC dispatch. */
export interface AdminServer {
  /** Begin listening on the Unix domain socket. */
  start(): Promise<Result<void, InternalError>>;

  /** Stop listening and clean up the socket file. */
  stop(): Promise<Result<void, InternalError>>;

  /** Current server state. */
  readonly state: "idle" | "listening" | "stopped";
}

/** Dependencies injected into the AdminServer. */
export interface AdminServerDeps {
  readonly keyManager: {
    admin: {
      verifyJwt(
        token: string,
      ): Promise<Result<AdminJwtPayload, AuthError | ValidationError>>;
    };
  };
  readonly dispatcher: AdminDispatcher;
  readonly signetId: string;
  readonly signerProvider: HandlerContext["signerProvider"];
}

// ---------------------------------------------------------------------------
// Per-connection state
// ---------------------------------------------------------------------------

interface ConnectionState {
  authenticated: boolean;
  adminFingerprint: string | null;
  buffer: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create an AdminServer that listens on a Unix domain socket,
 * authenticates via admin JWT, and dispatches JSON-RPC 2.0 requests
 * through the AdminDispatcher.
 */
export function createAdminServer(
  config: AdminServerConfig,
  deps: AdminServerDeps,
): AdminServer {
  let serverState: "idle" | "listening" | "stopped" = "idle";
  let listener: ReturnType<typeof Bun.listen> | undefined;
  const socketPath = config.socketPath ?? "/tmp/xmtp-signet/admin.sock";

  const connectionStates = new WeakMap<object, ConnectionState>();

  function getOrCreateState(socket: object): ConnectionState {
    let state = connectionStates.get(socket);
    if (state === undefined) {
      state = {
        authenticated: false,
        adminFingerprint: null,
        buffer: "",
      };
      connectionStates.set(socket, state);
    }
    return state;
  }

  function makeJsonRpcError(
    id: number | string | null,
    code: number,
    message: string,
    data?: unknown,
  ): string {
    const response: Record<string, unknown> = {
      jsonrpc: "2.0",
      id,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    };
    return JSON.stringify(response) + "\n";
  }

  function makeJsonRpcSuccess(id: number | string, result: unknown): string {
    return (
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        result,
      }) + "\n"
    );
  }

  function makeHandlerContext(fingerprint: string): HandlerContext {
    return {
      signetId: deps.signetId,
      signerProvider: deps.signerProvider,
      requestId: crypto.randomUUID(),
      signal: AbortSignal.timeout(30_000),
      adminAuth: { adminKeyFingerprint: fingerprint },
    };
  }

  async function handleLine(
    socket: { write(data: string | Uint8Array): number },
    line: string,
    connState: ConnectionState,
  ): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      socket.write(
        makeJsonRpcError(null, JSON_RPC_ERRORS.PARSE_ERROR, "Parse error"),
      );
      return;
    }

    // First message must be auth frame
    if (!connState.authenticated) {
      const authResult = AdminAuthFrameSchema.safeParse(parsed);
      if (!authResult.success) {
        socket.write(
          makeJsonRpcError(
            null,
            JSON_RPC_ERRORS.AUTH_FAILED,
            "Expected admin_auth frame as first message",
          ),
        );
        return;
      }

      const verifyResult = await deps.keyManager.admin.verifyJwt(
        authResult.data.token,
      );
      if (Result.isError(verifyResult)) {
        socket.write(
          makeJsonRpcError(
            null,
            JSON_RPC_ERRORS.AUTH_FAILED,
            verifyResult.error.message,
          ),
        );
        return;
      }

      connState.authenticated = true;
      connState.adminFingerprint = verifyResult.value.iss;
      // Send auth success acknowledgment
      socket.write(
        JSON.stringify({ jsonrpc: "2.0", result: { authenticated: true } }) +
          "\n",
      );
      return;
    }

    // Authenticated: expect JSON-RPC request
    const rpcResult = JsonRpcRequestSchema.safeParse(parsed);
    if (!rpcResult.success) {
      socket.write(
        makeJsonRpcError(
          null,
          JSON_RPC_ERRORS.INVALID_REQUEST,
          "Invalid JSON-RPC request",
        ),
      );
      return;
    }

    const request = rpcResult.data;
    if (!deps.dispatcher.hasMethod(request.method)) {
      socket.write(
        makeJsonRpcError(
          request.id,
          JSON_RPC_ERRORS.METHOD_NOT_FOUND,
          `Method '${request.method}' not found`,
        ),
      );
      return;
    }

    const ctx = makeHandlerContext(connState.adminFingerprint ?? "");

    const actionResult = await deps.dispatcher.dispatch(
      request.method,
      request.params,
      ctx,
    );

    if (actionResult.ok) {
      socket.write(makeJsonRpcSuccess(request.id, actionResult));
    } else {
      const errorCode =
        actionResult.error.category === "validation"
          ? JSON_RPC_ERRORS.INVALID_PARAMS
          : actionResult.error.category === "auth"
            ? JSON_RPC_ERRORS.AUTH_FAILED
            : actionResult.error.category === "permission"
              ? JSON_RPC_ERRORS.PERMISSION_DENIED
              : actionResult.error.category === "not_found"
                ? JSON_RPC_ERRORS.NOT_FOUND
                : JSON_RPC_ERRORS.INTERNAL_ERROR;

      socket.write(
        makeJsonRpcError(
          request.id,
          errorCode,
          actionResult.error.message,
          actionResult.error,
        ),
      );
    }
  }

  return {
    async start(): Promise<Result<void, InternalError>> {
      if (serverState !== "idle") {
        return Result.err(
          InternalError.create(`Cannot start server in state '${serverState}'`),
        );
      }

      try {
        // Ensure directory exists
        const dir = dirname(socketPath);
        mkdirSync(dir, { recursive: true });

        // Remove stale socket file
        if (existsSync(socketPath)) {
          unlinkSync(socketPath);
        }

        listener = Bun.listen({
          unix: socketPath,
          socket: {
            open(socket) {
              getOrCreateState(socket);
            },
            data(socket, data) {
              const connState = getOrCreateState(socket);
              const decoder = new TextDecoder();
              connState.buffer += decoder.decode(data);

              // Process complete lines
              let newlineIdx = connState.buffer.indexOf("\n");
              while (newlineIdx !== -1) {
                const line = connState.buffer.slice(0, newlineIdx).trim();
                connState.buffer = connState.buffer.slice(newlineIdx + 1);

                if (line.length > 0) {
                  // Fire and forget -- errors are sent as JSON-RPC errors
                  void handleLine(socket, line, connState);
                }

                newlineIdx = connState.buffer.indexOf("\n");
              }
            },
            close(_socket) {
              // Connection state will be GC'd via WeakMap
            },
            error(_socket, error) {
              // Log but don't crash -- connection will be cleaned up
              console.error("Admin socket connection error:", error);
            },
          },
        });

        serverState = "listening";
        return Result.ok(undefined);
      } catch (e) {
        serverState = "idle";
        return Result.err(
          InternalError.create("Failed to start admin server", {
            cause: String(e),
          }),
        );
      }
    },

    async stop(): Promise<Result<void, InternalError>> {
      if (serverState !== "listening") {
        return Result.err(
          InternalError.create(`Cannot stop server in state '${serverState}'`),
        );
      }

      try {
        if (listener !== undefined) {
          listener.stop();
          listener = undefined;
        }

        // Clean up socket file
        if (existsSync(socketPath)) {
          unlinkSync(socketPath);
        }

        serverState = "stopped";
        return Result.ok(undefined);
      } catch (e) {
        return Result.err(
          InternalError.create("Failed to stop admin server", {
            cause: String(e),
          }),
        );
      }
    },

    get state() {
      return serverState;
    },
  };
}
