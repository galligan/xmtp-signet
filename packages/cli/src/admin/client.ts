import { Result } from "better-result";
import {
  AuthError,
  CancelledError,
  GrantDeniedError,
  InternalError,
  NetworkError,
  NotFoundError,
  PermissionError,
  SessionExpiredError,
  TimeoutError,
  ValidationError,
  type ActionError,
  type SignetError,
} from "@xmtp/signet-schemas";
import { JSON_RPC_ERRORS } from "./protocol.js";

/**
 * Client for communicating with the AdminServer over a Unix domain socket.
 * Sends an auth frame first, then JSON-RPC 2.0 requests.
 */
export interface AdminClient {
  /** Connect to the admin socket and authenticate with a JWT. */
  connect(token: string): Promise<Result<void, AuthError | InternalError>>;

  /** Send a JSON-RPC 2.0 request and return the typed result. */
  request<T>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<Result<T, SignetError>>;

  /** Close the underlying socket connection. */
  close(): Promise<void>;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: SignetError) => void;
};

type SocketHandle = {
  write(data: string | Uint8Array): number;
  end(): void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSignetError(value: unknown): value is SignetError {
  return (
    isRecord(value) &&
    typeof value["_tag"] === "string" &&
    typeof value["code"] === "number" &&
    typeof value["category"] === "string" &&
    "context" in value
  );
}

function toSignetErrorFromActionError(error: ActionError): SignetError {
  const context = error.context ?? undefined;

  switch (error._tag) {
    case "ValidationError":
      return new ValidationError(error.message, {
        field:
          typeof context?.["field"] === "string" ? context["field"] : "params",
        reason:
          typeof context?.["reason"] === "string"
            ? context["reason"]
            : error.message,
        ...context,
      });
    case "NotFoundError":
      return new NotFoundError(error.message, {
        resourceType:
          typeof context?.["resourceType"] === "string"
            ? context["resourceType"]
            : "resource",
        resourceId:
          typeof context?.["resourceId"] === "string"
            ? context["resourceId"]
            : error.message,
        ...context,
      });
    case "PermissionError":
      return new PermissionError(error.message, context ?? null);
    case "GrantDeniedError":
      if (
        typeof context?.["operation"] === "string" &&
        typeof context?.["grantType"] === "string"
      ) {
        return new GrantDeniedError(error.message, {
          operation: context["operation"],
          grantType: context["grantType"],
          ...context,
        });
      }
      return new PermissionError(error.message, context ?? null);
    case "AuthError":
      return new AuthError(error.message, context ?? null);
    case "SessionExpiredError":
      return new SessionExpiredError(error.message, {
        sessionId:
          typeof context?.["sessionId"] === "string"
            ? context["sessionId"]
            : "unknown",
        ...context,
      });
    case "TimeoutError":
      return new TimeoutError(error.message, {
        operation:
          typeof context?.["operation"] === "string"
            ? context["operation"]
            : "request",
        timeoutMs:
          typeof context?.["timeoutMs"] === "number" ? context["timeoutMs"] : 0,
        ...context,
      });
    case "CancelledError":
      return CancelledError.create(error.message);
    case "NetworkError":
      return new NetworkError(error.message, {
        endpoint:
          typeof context?.["endpoint"] === "string"
            ? context["endpoint"]
            : "admin-socket",
        reason:
          typeof context?.["reason"] === "string"
            ? context["reason"]
            : error.message,
        ...context,
      });
    default:
      return new InternalError(error.message, context ?? null);
  }
}

function toSignetErrorFromJsonRpc(error: {
  code: number;
  message: string;
  data?: unknown;
}): SignetError {
  if (
    isRecord(error.data) &&
    typeof error.data["_tag"] === "string" &&
    typeof error.data["category"] === "string" &&
    typeof error.data["message"] === "string" &&
    ("context" in error.data
      ? error.data["context"] === null || isRecord(error.data["context"])
      : true)
  ) {
    return toSignetErrorFromActionError({
      _tag: error.data["_tag"],
      category: error.data["category"] as ActionError["category"],
      message: error.data["message"],
      context:
        ("context" in error.data
          ? (error.data["context"] as ActionError["context"])
          : null) ?? null,
    });
  }

  switch (error.code) {
    case JSON_RPC_ERRORS.AUTH_FAILED:
      return AuthError.create(error.message);
    case JSON_RPC_ERRORS.PERMISSION_DENIED:
      return PermissionError.create(error.message);
    case JSON_RPC_ERRORS.NOT_FOUND:
    case JSON_RPC_ERRORS.METHOD_NOT_FOUND:
      return NotFoundError.create("Method", error.message);
    case JSON_RPC_ERRORS.INVALID_PARAMS:
    case JSON_RPC_ERRORS.INVALID_REQUEST:
    case JSON_RPC_ERRORS.PARSE_ERROR:
      return ValidationError.create("rpc", error.message);
    default:
      return InternalError.create(error.message);
  }
}

function normalizeUnknownError(error: unknown): SignetError {
  if (isSignetError(error)) {
    return error;
  }
  if (error instanceof Error) {
    return InternalError.create(error.message);
  }
  return InternalError.create(String(error));
}

/**
 * Create an AdminClient that connects to the admin Unix socket,
 * authenticates with a JWT, and sends JSON-RPC 2.0 requests.
 */
export function createAdminClient(socketPath: string): AdminClient {
  let socket: SocketHandle | undefined;
  let nextId = 1;
  let buffer = "";
  const pending = new Map<string, PendingRequest>();

  function rejectAll(error: SignetError): void {
    for (const request of pending.values()) {
      request.reject(error);
    }
    pending.clear();
  }

  function processLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }

    if (!isRecord(parsed)) {
      return;
    }

    const resultField = parsed["result"];
    if (
      parsed["id"] === undefined &&
      isRecord(resultField) &&
      resultField["authenticated"] === true
    ) {
      const authRequest = pending.get("auth");
      if (authRequest !== undefined) {
        pending.delete("auth");
        authRequest.resolve(undefined);
      }
      return;
    }

    if (
      (parsed["id"] === undefined || parsed["id"] === null) &&
      isRecord(parsed["error"])
    ) {
      const authRequest = pending.get("auth");
      if (authRequest !== undefined) {
        pending.delete("auth");
        authRequest.reject(
          toSignetErrorFromJsonRpc({
            code:
              typeof parsed["error"]["code"] === "number"
                ? parsed["error"]["code"]
                : JSON_RPC_ERRORS.AUTH_FAILED,
            message:
              typeof parsed["error"]["message"] === "string"
                ? parsed["error"]["message"]
                : "Authentication failed",
            data: parsed["error"]["data"],
          }),
        );
      }
      return;
    }

    if (parsed["id"] === undefined) {
      return;
    }

    const pendingRequest = pending.get(String(parsed["id"]));
    if (pendingRequest === undefined) {
      return;
    }
    pending.delete(String(parsed["id"]));

    if (isRecord(parsed["error"])) {
      pendingRequest.reject(
        toSignetErrorFromJsonRpc({
          code:
            typeof parsed["error"]["code"] === "number"
              ? parsed["error"]["code"]
              : JSON_RPC_ERRORS.INTERNAL_ERROR,
          message:
            typeof parsed["error"]["message"] === "string"
              ? parsed["error"]["message"]
              : "RPC error",
          data: parsed["error"]["data"],
        }),
      );
      return;
    }

    pendingRequest.resolve(parsed["result"]);
  }

  return {
    async connect(
      token: string,
    ): Promise<Result<void, AuthError | InternalError>> {
      try {
        const authPromise = new Promise<void>((resolve, reject) => {
          pending.set("auth", {
            resolve: resolve as (value: unknown) => void,
            reject: reject as (error: SignetError) => void,
          });
        });

        socket = await Bun.connect({
          unix: socketPath,
          socket: {
            data(_socket, data) {
              buffer += new TextDecoder().decode(data);

              let newlineIndex = buffer.indexOf("\n");
              while (newlineIndex !== -1) {
                const line = buffer.slice(0, newlineIndex).trim();
                buffer = buffer.slice(newlineIndex + 1);

                if (line.length > 0) {
                  processLine(line);
                }

                newlineIndex = buffer.indexOf("\n");
              }
            },
            error(_socket, error) {
              rejectAll(
                InternalError.create(
                  error instanceof Error ? error.message : String(error),
                ),
              );
            },
            close() {
              rejectAll(InternalError.create("Connection closed"));
            },
            open() {},
          },
        });

        socket.write(
          JSON.stringify({
            type: "admin_auth",
            token,
          }) + "\n",
        );

        await authPromise;
        return Result.ok(undefined);
      } catch (error) {
        // Close and nullify socket on failure to prevent writes
        // to an unauthenticated connection
        if (socket !== undefined) {
          try {
            socket.end();
          } catch {
            // Ignore close errors during error handling
          }
          socket = undefined;
        }

        const signetError = normalizeUnknownError(error);
        if (signetError.category === "auth") {
          return Result.err(AuthError.create(signetError.message));
        }
        return Result.err(
          InternalError.create("Failed to connect to admin socket", {
            cause: signetError.message,
          }),
        );
      }
    },

    async request<T>(
      method: string,
      params?: Record<string, unknown>,
    ): Promise<Result<T, SignetError>> {
      if (socket === undefined) {
        return Result.err(
          InternalError.create("Not connected to admin socket"),
        );
      }

      const id = nextId++;

      try {
        const responsePromise = new Promise<unknown>((resolve, reject) => {
          pending.set(String(id), {
            resolve,
            reject: reject as (error: SignetError) => void,
          });
        });

        socket.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            method,
            params: params ?? {},
          }) + "\n",
        );

        const response = await responsePromise;

        if (
          isRecord(response) &&
          response["ok"] === true &&
          "data" in response
        ) {
          return Result.ok(response["data"] as T);
        }

        if (
          isRecord(response) &&
          response["ok"] === false &&
          isRecord(response["error"]) &&
          typeof response["error"]["_tag"] === "string" &&
          typeof response["error"]["category"] === "string" &&
          typeof response["error"]["message"] === "string"
        ) {
          return Result.err(
            toSignetErrorFromActionError({
              _tag: response["error"]["_tag"],
              category: response["error"][
                "category"
              ] as ActionError["category"],
              message: response["error"]["message"],
              context: isRecord(response["error"]["context"])
                ? response["error"]["context"]
                : response["error"]["context"] === null
                  ? null
                  : null,
            }),
          );
        }

        return Result.ok(response as T);
      } catch (error) {
        return Result.err(normalizeUnknownError(error));
      }
    },

    async close(): Promise<void> {
      if (socket !== undefined) {
        socket.end();
        socket = undefined;
      }
    },
  };
}
