import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import { InternalError, ValidationError } from "@xmtp/signet-schemas";
import type { AdminJwtPayload } from "@xmtp/signet-keys";
import type {
  ActionRegistry,
  CredentialManager,
  CredentialRecord,
  HandlerContext,
  SignerProvider,
} from "@xmtp/signet-contracts";
import type { AdminDispatcher } from "../admin/dispatcher.js";
import {
  buildHttpActionRoutes,
  matchHttpActionRoute,
  type HttpActionRoute,
} from "./action-routes.js";
import type { AuditLog } from "../audit/log.js";
import {
  createAdminReadElevationManager,
  type AdminReadElevationApprover,
  type AdminReadElevationManager,
} from "../admin/read-elevation.js";

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
  readonly registry: ActionRegistry;
  readonly credentialManager: CredentialManager;
  readonly signetId: string;
  readonly signerProvider: SignerProvider;
  readonly verifyAdminJwt: (
    token: string,
  ) => Promise<Result<AdminJwtPayload, SignetError>>;
  readonly readElevationManager?: AdminReadElevationManager;
  readonly readElevationApprover?: AdminReadElevationApprover;
  readonly auditLog?: AuditLog;
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

function mergeTransportControls(
  rawParams: Record<string, unknown>,
  validatedParams: Record<string, unknown>,
): Record<string, unknown> {
  const dangerousMessageReadFlag = rawParams["dangerouslyAllowMessageRead"];
  if (
    dangerousMessageReadFlag !== true &&
    dangerousMessageReadFlag !== "true"
  ) {
    return validatedParams;
  }

  return {
    ...validatedParams,
    dangerouslyAllowMessageRead: dangerousMessageReadFlag,
  };
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
  let actionRoutes: readonly HttpActionRoute[] = [];
  const readElevationManager =
    deps.readElevationManager ??
    createAdminReadElevationManager({
      ...(deps.readElevationApprover
        ? { approver: deps.readElevationApprover }
        : {}),
      ...(deps.auditLog ? { auditLog: deps.auditLog } : {}),
    });

  function makeHandlerContext(options?: {
    adminAuth?: { adminKeyFingerprint: string };
    credential?: Pick<CredentialRecord, "credentialId" | "operatorId">;
    adminReadElevation?: HandlerContext["adminReadElevation"];
  }): HandlerContext {
    const base: HandlerContext = {
      signetId: deps.signetId,
      signerProvider: deps.signerProvider,
      requestId: crypto.randomUUID(),
      signal: AbortSignal.timeout(30_000),
    };
    return {
      ...base,
      ...(options?.adminAuth ? { adminAuth: options.adminAuth } : {}),
      ...(options?.credential
        ? {
            credentialId: options.credential.credentialId,
            operatorId: options.credential.operatorId,
          }
        : {}),
      ...(options?.adminReadElevation
        ? { adminReadElevation: options.adminReadElevation }
        : {}),
    };
  }

  async function parseActionParams(
    req: Request,
    inputSource: HttpActionRoute["inputSource"],
  ): Promise<Result<Record<string, unknown>, ValidationError>> {
    if (inputSource === "query") {
      const url = new URL(req.url);
      const params: Record<string, unknown> = {};

      for (const key of new Set(url.searchParams.keys())) {
        const values = url.searchParams.getAll(key);
        params[key] = values.length > 1 ? values : (values[0] ?? "");
      }

      return Result.ok(params);
    }

    try {
      const text = await req.text();
      if (text.length === 0) {
        return Result.ok({});
      }
      return Result.ok(JSON.parse(text) as Record<string, unknown>);
    } catch {
      return Result.err(ValidationError.create("body", "Invalid JSON body"));
    }
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

    const paramsResult = deps.dispatcher.validate(method, params);
    if (Result.isError(paramsResult)) {
      return errorResponse(
        paramsResult.error.category,
        paramsResult.error.message,
        paramsResult.error.context ?? null,
      );
    }

    const elevationResult = await readElevationManager.resolveForRequest({
      method,
      params: mergeTransportControls(params, paramsResult.value),
      adminFingerprint: verifyResult.value.iss,
      sessionKey: `${verifyResult.value.iss}:${verifyResult.value.jti}`,
    });
    if (Result.isError(elevationResult)) {
      return errorResponse(
        elevationResult.error.category,
        elevationResult.error.message,
        elevationResult.error.context ?? null,
      );
    }

    const ctx = makeHandlerContext({
      adminAuth: {
        adminKeyFingerprint: verifyResult.value.iss,
      },
      adminReadElevation: elevationResult.value,
    });

    const actionResult = await deps.dispatcher.dispatchValidated(
      method,
      paramsResult.value,
      ctx,
    );

    if (actionResult.ok) {
      return successResponse(actionResult.data);
    }

    return errorResponse(
      actionResult.error.category,
      actionResult.error.message,
      actionResult.error.context ?? null,
    );
  }

  async function handleCredentialRoute(
    req: Request,
    method: string,
  ): Promise<Response> {
    const token = extractBearerToken(req);
    if (token === null) {
      return errorResponse("auth", "Missing credential token", null);
    }

    // Verify the credential token is valid
    const credentialResult = await deps.credentialManager.lookupByToken(token);
    if (!credentialResult.isOk()) {
      return errorResponse("auth", "Invalid credential token", null);
    }

    const credential = credentialResult.value;

    // Accept both "credential.info" and bare "info" on the credential route.
    const bareMethod = method.startsWith("credential.")
      ? method.slice("credential.".length)
      : method;

    switch (bareMethod) {
      case "info": {
        return successResponse({
          credentialId: credential.id,
          operatorId: credential.config.operatorId,
          status: credential.status,
          config: credential.config,
          issuedAt: credential.issuedAt,
          expiresAt: credential.expiresAt,
        });
      }

      default:
        return errorResponse(
          "not_found",
          `Unknown credential method: ${method}`,
          {
            method,
          },
        );
    }
  }

  async function handleActionRoute(
    req: Request,
    route: HttpActionRoute,
  ): Promise<Response> {
    const token = extractBearerToken(req);
    if (token === null) {
      return errorResponse(
        "auth",
        route.auth === "admin"
          ? "Missing authorization token"
          : "Missing credential token",
        null,
      );
    }

    if (route.auth === "admin") {
      const verifyResult = await deps.verifyAdminJwt(token);
      if (Result.isError(verifyResult)) {
        return errorResponse(
          "auth",
          verifyResult.error.message,
          verifyResult.error.context ?? null,
        );
      }

      const paramsResult = await parseActionParams(req, route.inputSource);
      if (!paramsResult.isOk()) {
        return errorResponse(
          paramsResult.error.category,
          paramsResult.error.message,
          paramsResult.error.context ?? null,
        );
      }

      const parseResult = route.spec.input.safeParse(paramsResult.value);
      if (!parseResult.success) {
        const firstIssue = parseResult.error.issues[0];
        const field = firstIssue?.path.join(".") ?? "params";
        const reason = firstIssue?.message ?? "Validation failed";
        const error = ValidationError.create(field, reason, {
          issues: parseResult.error.issues,
        });
        return errorResponse(
          error.category,
          error.message,
          error.context ?? null,
        );
      }

      const elevationResult = await readElevationManager.resolveForRequest({
        method: route.spec.id,
        params: paramsResult.value,
        adminFingerprint: verifyResult.value.iss,
        sessionKey: `${verifyResult.value.iss}:${verifyResult.value.jti}`,
      });
      if (Result.isError(elevationResult)) {
        return errorResponse(
          elevationResult.error.category,
          elevationResult.error.message,
          elevationResult.error.context ?? null,
        );
      }

      const ctx = makeHandlerContext({
        adminAuth: {
          adminKeyFingerprint: verifyResult.value.iss,
        },
        adminReadElevation: elevationResult.value,
      });
      try {
        const result = await route.spec.handler(parseResult.data, ctx);
        if (result.isOk()) {
          return successResponse(result.value);
        }

        return errorResponse(
          result.error.category,
          result.error.message,
          result.error.context ?? null,
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const internalError = InternalError.create(`Handler threw: ${message}`);
        return errorResponse(
          internalError.category,
          internalError.message,
          internalError.context ?? null,
        );
      }
    }

    const credentialResult = await deps.credentialManager.lookupByToken(token);
    if (!credentialResult.isOk()) {
      return errorResponse("auth", "Invalid credential token", null);
    }

    const paramsResult = await parseActionParams(req, route.inputSource);
    if (!paramsResult.isOk()) {
      return errorResponse(
        paramsResult.error.category,
        paramsResult.error.message,
        paramsResult.error.context ?? null,
      );
    }

    const parseResult = route.spec.input.safeParse(paramsResult.value);
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      const field = firstIssue?.path.join(".") ?? "params";
      const reason = firstIssue?.message ?? "Validation failed";
      const error = ValidationError.create(field, reason, {
        issues: parseResult.error.issues,
      });
      return errorResponse(
        error.category,
        error.message,
        error.context ?? null,
      );
    }

    const ctx = makeHandlerContext({
      credential: {
        credentialId: credentialResult.value.credentialId,
        operatorId: credentialResult.value.operatorId,
      },
    });

    try {
      const result = await route.spec.handler(parseResult.data, ctx);
      if (result.isOk()) {
        return successResponse(result.value);
      }

      return errorResponse(
        result.error.category,
        result.error.message,
        result.error.context ?? null,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const internalError = InternalError.create(`Handler threw: ${message}`);
      return errorResponse(
        internalError.category,
        internalError.message,
        internalError.context ?? null,
      );
    }
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

    // Credential routes: POST /v1/credential/:method
    const credentialMatch = path.match(/^\/v1\/credential\/(.+)$/);
    const credentialMethod = credentialMatch?.[1];
    if (credentialMethod !== undefined && req.method === "POST") {
      return handleCredentialRoute(req, credentialMethod);
    }

    const actionRoute = matchHttpActionRoute(actionRoutes, req.method, path);
    if (actionRoute !== undefined) {
      return handleActionRoute(req, actionRoute);
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
        const routesResult = buildHttpActionRoutes(deps.registry);
        if (!routesResult.isOk()) {
          return Result.err(routesResult.error);
        }
        actionRoutes = routesResult.value;

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
