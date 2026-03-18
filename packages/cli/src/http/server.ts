import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import { InternalError } from "@xmtp/signet-schemas";
import type { SessionManager } from "@xmtp/signet-contracts";
import type { AdminDispatcher } from "../admin/dispatcher.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the HTTP API server. */
export interface HttpServerConfig {
  readonly port: number;
  readonly host: string;
}

/** Dependencies required to serve HTTP admin and status routes. */
export interface HttpServerDeps {
  readonly dispatcher: AdminDispatcher;
  readonly sessionManager: SessionManager;
  readonly verifyAdminJwt: (
    token: string,
  ) => Promise<Result<void, SignetError>>;
  readonly status: () => unknown | Promise<unknown>;
}

/** Minimal lifecycle surface for the HTTP API server. */
export interface HttpServer {
  start(): Promise<Result<{ port: number }, SignetError>>;
  stop(): Promise<Result<void, SignetError>>;
  readonly state: "idle" | "listening" | "stopped";
}

// ---------------------------------------------------------------------------
// Error category -> HTTP status mapping
// ---------------------------------------------------------------------------

const CATEGORY_STATUS: Record<string, number> = {
  validation: 400,
  auth: 401,
  permission: 403,
  not_found: 404,
  timeout: 408,
  cancelled: 499,
  internal: 500,
};

function categoryToStatus(category: string): number {
  return CATEGORY_STATUS[category] ?? 500;
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function successResponse(data: unknown): Response {
  return jsonResponse({ ok: true, data }, 200);
}

function errorResponse(
  category: string,
  message: string,
  context: unknown,
): Response {
  return jsonResponse(
    { ok: false, error: { category, message, context } },
    categoryToStatus(category),
  );
}

// ---------------------------------------------------------------------------
// Auth extraction
// ---------------------------------------------------------------------------

function extractBearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization");
  if (header === null) return null;
  if (!header.startsWith("Bearer ")) return null;
  return header.slice(7);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create the HTTP API server used for admin and health endpoints.
 */
export function createHttpServer(
  config: HttpServerConfig,
  deps: HttpServerDeps,
): HttpServer {
  let serverState: "idle" | "listening" | "stopped" = "idle";
  let bunServer: ReturnType<typeof Bun.serve> | undefined;

  function makeHandlerContext(adminAuth?: {
    adminKeyFingerprint: string;
  }): import("@xmtp/signet-contracts").HandlerContext {
    const base = {
      signetId: "signet",
      signerProvider:
        {} as import("@xmtp/signet-contracts").HandlerContext["signerProvider"],
      requestId: crypto.randomUUID(),
      signal: AbortSignal.timeout(30_000),
    };
    if (adminAuth !== undefined) {
      return { ...base, adminAuth };
    }
    return base;
  }

  async function handleAdminRoute(
    req: Request,
    method: string,
  ): Promise<Response> {
    const token = extractBearerToken(req);
    if (token === null) {
      return errorResponse("auth", "Missing authorization token", null);
    }

    const verifyResult = await deps.verifyAdminJwt(token);
    if (Result.isError(verifyResult)) {
      return errorResponse(
        "auth",
        verifyResult.error.message,
        verifyResult.error.context ?? null,
      );
    }

    let params: Record<string, unknown> = {};
    try {
      const text = await req.text();
      if (text.length > 0) {
        params = JSON.parse(text) as Record<string, unknown>;
      }
    } catch {
      return errorResponse("validation", "Invalid JSON body", null);
    }

    const ctx = makeHandlerContext({ adminKeyFingerprint: "http-admin" });

    const actionResult = await deps.dispatcher.dispatch(method, params, ctx);

    if (actionResult.ok) {
      return successResponse(actionResult.data);
    }

    return errorResponse(
      actionResult.error.category,
      actionResult.error.message,
      actionResult.error.context ?? null,
    );
  }

  async function handleSessionRoute(
    req: Request,
    _method: string,
  ): Promise<Response> {
    const token = extractBearerToken(req);
    if (token === null) {
      return errorResponse("auth", "Missing session token", null);
    }

    // Session routing will be wired when session handlers are HTTP-capable
    return errorResponse(
      "not_found",
      "Session HTTP routes not yet implemented",
      null,
    );
  }

  async function handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // Health endpoint -- no auth required
    if (path === "/v1/health" && req.method === "GET") {
      return successResponse(await deps.status());
    }

    // Admin routes: POST /v1/admin/:method
    const adminMatch = path.match(/^\/v1\/admin\/(.+)$/);
    const adminMethod = adminMatch?.[1];
    if (adminMethod !== undefined && req.method === "POST") {
      return handleAdminRoute(req, adminMethod);
    }

    // Session routes: POST /v1/session/:method
    const sessionMatch = path.match(/^\/v1\/session\/(.+)$/);
    const sessionMethod = sessionMatch?.[1];
    if (sessionMethod !== undefined && req.method === "POST") {
      return handleSessionRoute(req, sessionMethod);
    }

    return errorResponse(
      "not_found",
      `Route not found: ${req.method} ${path}`,
      null,
    );
  }

  return {
    async start(): Promise<Result<{ port: number }, SignetError>> {
      if (serverState !== "idle") {
        return Result.err(
          InternalError.create(
            `Cannot start HTTP server in state '${serverState}'`,
          ),
        );
      }

      try {
        bunServer = Bun.serve({
          port: config.port,
          hostname: config.host,
          async fetch(req) {
            return handleRequest(req);
          },
        });

        serverState = "listening";
        return Result.ok({ port: bunServer.port ?? config.port });
      } catch (e) {
        serverState = "idle";
        return Result.err(
          InternalError.create("Failed to start HTTP server", {
            cause: String(e),
          }),
        );
      }
    },

    async stop(): Promise<Result<void, SignetError>> {
      if (serverState !== "listening") {
        return Result.err(
          InternalError.create(
            `Cannot stop HTTP server in state '${serverState}'`,
          ),
        );
      }

      try {
        if (bunServer !== undefined) {
          bunServer.stop(true);
          bunServer = undefined;
        }
        serverState = "stopped";
        return Result.ok(undefined);
      } catch (e) {
        return Result.err(
          InternalError.create("Failed to stop HTTP server", {
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
