import { describe, test, expect, afterEach } from "bun:test";
import { Result } from "better-result";
import { z } from "zod";
import { AuthError } from "@xmtp/signet-schemas";
import type { AdminJwtPayload } from "@xmtp/signet-keys";
import {
  createActionRegistry,
  type ActionSpec,
  type HandlerContext,
} from "@xmtp/signet-contracts";
import type { AdminDispatcher } from "../admin/dispatcher.js";
import { createAdminDispatcher } from "../admin/dispatcher.js";
import {
  createHttpServer,
  type HttpServer,
  type HttpServerDeps,
} from "../http/server.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeReadElevationApprover() {
  let authorizeCalls = 0;
  return {
    get authorizeCalls() {
      return authorizeCalls;
    },
    async authorize() {
      authorizeCalls++;
      return Result.ok(undefined);
    },
    async getApprovalFingerprint() {
      return Result.ok("approval-fingerprint");
    },
  };
}

function makeDispatcher(overrides?: Partial<AdminDispatcher>): AdminDispatcher {
  const dispatchValidated =
    overrides?.dispatchValidated ??
    overrides?.dispatch ??
    (async () => ({
      ok: true as const,
      data: { status: "ok" },
      meta: {
        requestId: "req-1",
        timestamp: new Date().toISOString(),
        durationMs: 1,
      },
    }));
  return {
    validate: overrides?.validate ?? ((_, params) => Result.ok(params)),
    dispatchValidated,
    dispatch: overrides?.dispatch ?? dispatchValidated,
    hasMethod: overrides?.hasMethod ?? (() => true),
  };
}

function makeDeps(overrides?: Partial<HttpServerDeps>): HttpServerDeps {
  return {
    dispatcher: overrides?.dispatcher ?? makeDispatcher(),
    registry: overrides?.registry ?? createActionRegistry(),
    credentialManager:
      overrides?.credentialManager ??
      ({} as HttpServerDeps["credentialManager"]),
    signetId: overrides?.signetId ?? "test-signet",
    signerProvider:
      overrides?.signerProvider ?? ({} as HttpServerDeps["signerProvider"]),
    verifyAdminJwt:
      overrides?.verifyAdminJwt ??
      (async () =>
        Result.ok({
          iss: "admin-fingerprint",
          sub: "admin",
          iat: 1,
          exp: 2,
          jti: "test-jti",
        } satisfies AdminJwtPayload)),
    readElevationApprover: overrides?.readElevationApprover,
    auditLog: overrides?.auditLog,
    status: overrides?.status ?? (() => ({ state: "running", pid: 1 })),
  };
}

function makeHttpActionSpec(
  id: string,
  overrides?: Partial<ActionSpec<unknown, unknown>>,
): ActionSpec<unknown, unknown> {
  return {
    id,
    input: z.object({}).passthrough(),
    handler: async (_input: unknown, _ctx: HandlerContext) =>
      Result.ok(undefined),
    ...overrides,
  };
}

async function startTestServer(deps: HttpServerDeps): Promise<number> {
  server = createHttpServer({ port: 0, host: "127.0.0.1" }, deps);
  const result = await server.start();
  expect(Result.isOk(result)).toBe(true);
  if (!Result.isOk(result)) {
    throw new Error(result.error.message);
  }
  return result.value.port;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let server: HttpServer | undefined;

afterEach(async () => {
  if (server !== undefined && server.state === "listening") {
    await server.stop();
  }
  server = undefined;
});

describe("HttpServer", () => {
  test("GET /v1/health returns status without auth", async () => {
    const statusData = { state: "running", pid: 42 };
    const deps = makeDeps({ status: () => statusData });
    const port = await startTestServer(deps);

    const res = await fetch(`http://127.0.0.1:${port}/v1/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ ok: true, data: statusData });
  });

  test("POST /v1/admin/:method with valid JWT dispatches to admin", async () => {
    let seenFingerprint: string | null = null;
    const dispatcher = makeDispatcher({
      dispatch: async (_method, _params, ctx) => {
        seenFingerprint = ctx.adminAuth?.adminKeyFingerprint ?? null;
        return {
          ok: true as const,
          data: { credentials: [] },
          meta: {
            requestId: "req-1",
            timestamp: new Date().toISOString(),
            durationMs: 1,
          },
        };
      },
    });
    const deps = makeDeps({ dispatcher });
    const port = await startTestServer(deps);

    const res = await fetch(`http://127.0.0.1:${port}/v1/admin/signet.status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-admin-jwt",
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ credentials: [] });
    expect(seenFingerprint).toBe("admin-fingerprint");
  });

  test("POST /v1/admin/:method can attach and reuse admin read elevation", async () => {
    const approver = makeReadElevationApprover();
    const registry = createActionRegistry();
    registry.register({
      id: "message.list",
      description: "List messages in a conversation",
      intent: "read",
      input: z.object({
        chatId: z.string(),
      }),
      handler: async (_input, ctx) =>
        Result.ok({
          approvalId: ctx.adminReadElevation?.approvalId ?? null,
          chatIds: ctx.adminReadElevation?.scope.chatIds ?? [],
        }),
      cli: {
        command: "message:list",
      },
      http: {
        auth: "admin",
      },
    });
    const dispatcher = createAdminDispatcher(registry);
    const deps = makeDeps({
      dispatcher,
      registry,
      readElevationApprover: approver,
    });
    const port = await startTestServer(deps);

    const first = await fetch(
      `http://127.0.0.1:${port}/v1/admin/message.list`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-admin-jwt",
        },
        body: JSON.stringify({
          chatId: "conv_http_admin",
          dangerouslyAllowMessageRead: true,
        }),
      },
    );
    const second = await fetch(
      `http://127.0.0.1:${port}/v1/admin/message.list`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-admin-jwt",
        },
        body: JSON.stringify({
          chatId: "conv_http_admin",
          dangerouslyAllowMessageRead: true,
        }),
      },
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(firstBody.data.chatIds).toEqual(["conv_http_admin"]);
    expect(secondBody.data.approvalId).toBe(firstBody.data.approvalId);
    expect(approver.authorizeCalls).toBe(1);
  });

  test("POST /v1/admin/:method validates dangerous reads before prompting", async () => {
    const approver = makeReadElevationApprover();
    const registry = createActionRegistry();
    registry.register({
      id: "message.info",
      description: "Read a message",
      intent: "read",
      input: z.object({
        chatId: z.string(),
        messageId: z.string(),
      }),
      handler: async () => Result.ok({ ok: true }),
      cli: {
        command: "message:info",
      },
    });
    const dispatcher = createAdminDispatcher(registry);
    const deps = makeDeps({
      dispatcher,
      readElevationApprover: approver,
    });
    const port = await startTestServer(deps);

    const res = await fetch(`http://127.0.0.1:${port}/v1/admin/message.info`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-admin-jwt",
      },
      body: JSON.stringify({
        chatId: "conv_http_invalid_before_prompt",
        dangerouslyAllowMessageRead: true,
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.category).toBe("validation");
    expect(approver.authorizeCalls).toBe(0);
  });

  test("derived admin action route executes directly from the registry", async () => {
    const registry = createActionRegistry();
    registry.register(
      makeHttpActionSpec("credential.list", {
        description: "List credentials",
        intent: "read",
        input: z.object({
          operatorId: z.string().optional(),
        }),
        handler: async (input, ctx) =>
          Result.ok({
            adminKeyFingerprint: ctx.adminAuth?.adminKeyFingerprint ?? null,
            operatorId: (input as { operatorId?: string }).operatorId ?? null,
          }),
        http: {
          auth: "admin",
        },
      }),
    );

    const deps = makeDeps({ registry });
    const port = await startTestServer(deps);

    const res = await fetch(
      `http://127.0.0.1:${port}/v1/actions/credential/list?operatorId=op_123`,
      {
        headers: {
          Authorization: "Bearer valid-admin-jwt",
        },
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({
      adminKeyFingerprint: "admin-fingerprint",
      operatorId: "op_123",
    });
  });

  test("derived admin message route attaches elevation when dangerous read is requested", async () => {
    const approver = makeReadElevationApprover();
    const registry = createActionRegistry();
    registry.register(
      makeHttpActionSpec("message.info", {
        description: "Read a message",
        intent: "read",
        input: z.object({
          chatId: z.string(),
          messageId: z.string(),
        }),
        handler: async (_input, ctx) =>
          Result.ok({
            approvalId: ctx.adminReadElevation?.approvalId ?? null,
            approvalKeyFingerprint:
              ctx.adminReadElevation?.approvalKeyFingerprint ?? null,
          }),
        http: {
          auth: "admin",
        },
      }),
    );

    const deps = makeDeps({
      registry,
      readElevationApprover: approver,
    });
    const port = await startTestServer(deps);

    const res = await fetch(
      `http://127.0.0.1:${port}/v1/actions/message/info?chatId=conv_http_route&messageId=msg_123&dangerouslyAllowMessageRead=true`,
      {
        headers: {
          Authorization: "Bearer valid-admin-jwt",
        },
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.approvalId).toContain("approval_");
    expect(body.data.approvalKeyFingerprint).toBe("approval-fingerprint");
    expect(approver.authorizeCalls).toBe(1);
  });

  test("derived admin action route authenticates before validating params", async () => {
    const registry = createActionRegistry();
    registry.register(
      makeHttpActionSpec("message.info", {
        description: "Read a message",
        intent: "read",
        input: z.object({
          chatId: z.string(),
          messageId: z.string(),
        }),
        http: {
          auth: "admin",
        },
      }),
    );

    const deps = makeDeps({
      registry,
      verifyAdminJwt: async () => Result.err(AuthError.create("Invalid JWT")),
    });
    const port = await startTestServer(deps);

    const res = await fetch(
      `http://127.0.0.1:${port}/v1/actions/message/info`,
      {
        headers: {
          Authorization: "Bearer bad-jwt",
        },
      },
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.category).toBe("auth");
  });

  test("derived credential action route executes directly from the registry", async () => {
    const registry = createActionRegistry();
    registry.register(
      makeHttpActionSpec("reveal.list", {
        description: "List active reveals",
        intent: "read",
        idempotent: true,
        input: z.object({
          credentialId: z.string(),
        }),
        handler: async (input, ctx) =>
          Result.ok({
            authenticatedCredentialId: ctx.credentialId ?? null,
            requestedCredentialId: (input as { credentialId: string })
              .credentialId,
          }),
        http: {
          auth: "credential",
        },
      }),
    );

    const deps = makeDeps({
      registry,
      credentialManager: {
        lookupByToken: async () =>
          Result.ok({
            id: "cred_123",
            config: {
              operatorId: "op_123",
              chatIds: [],
              allow: [],
              deny: [],
            },
            inboxIds: [],
            credentialId: "cred_123",
            operatorId: "op_123",
            effectiveScopes: {
              allow: [],
              deny: [],
            },
            status: "active",
            issuedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            issuedBy: "owner",
            isExpired: false,
            lastHeartbeat: new Date().toISOString(),
          }),
      } as HttpServerDeps["credentialManager"],
    });
    const port = await startTestServer(deps);

    const res = await fetch(
      `http://127.0.0.1:${port}/v1/actions/reveal/list?credentialId=cred_123`,
      {
        headers: {
          Authorization: "Bearer credential-token",
        },
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({
      authenticatedCredentialId: "cred_123",
      requestedCredentialId: "cred_123",
    });
  });

  test("derived credential action route authenticates before validating params", async () => {
    const registry = createActionRegistry();
    registry.register(
      makeHttpActionSpec("reveal.list", {
        description: "List active reveals",
        intent: "read",
        input: z.object({
          credentialId: z.string(),
        }),
        http: {
          auth: "credential",
        },
      }),
    );

    const deps = makeDeps({
      registry,
      credentialManager: {
        lookupByToken: async () =>
          Result.err(AuthError.create("Invalid credential token")),
      } as HttpServerDeps["credentialManager"],
    });
    const port = await startTestServer(deps);

    const res = await fetch(`http://127.0.0.1:${port}/v1/actions/reveal/list`, {
      headers: {
        Authorization: "Bearer bad-credential-token",
      },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.category).toBe("auth");
  });

  test("unauthenticated request to /v1/admin returns 401", async () => {
    const deps = makeDeps();
    const port = await startTestServer(deps);

    const res = await fetch(`http://127.0.0.1:${port}/v1/admin/signet.status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.category).toBe("auth");
  });

  test("unknown route returns 404", async () => {
    const deps = makeDeps();
    const port = await startTestServer(deps);

    const res = await fetch(`http://127.0.0.1:${port}/v1/nonexistent`);
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.category).toBe("not_found");
  });

  test("legacy /v1/session route is not exposed", async () => {
    const deps = makeDeps();
    const port = await startTestServer(deps);

    const res = await fetch(`http://127.0.0.1:${port}/v1/session/info`, {
      method: "POST",
      headers: {
        Authorization: "Bearer credential-token",
      },
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.category).toBe("not_found");
  });

  test("session-prefixed credential method is rejected", async () => {
    const deps = makeDeps({
      credentialManager: {
        lookupByToken: async () =>
          Result.ok({
            id: "cred_123",
            config: {
              operatorId: "op_123",
              chatIds: [],
              allow: [],
              deny: [],
            },
            inboxIds: [],
            status: "active",
            issuedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            issuedBy: "owner",
          }),
      } as HttpServerDeps["credentialManager"],
    });
    const port = await startTestServer(deps);

    const res = await fetch(
      `http://127.0.0.1:${port}/v1/credential/session.info`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer credential-token",
        },
      },
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.category).toBe("not_found");
  });

  test("POST /v1/admin with invalid method returns not_found from dispatcher", async () => {
    const dispatcher = makeDispatcher({
      dispatch: async () => ({
        ok: false as const,
        error: {
          _tag: "NotFoundError",
          category: "not_found" as const,
          message: "Method 'no.such' not found",
          context: null,
        },
        meta: {
          requestId: "req-1",
          timestamp: new Date().toISOString(),
          durationMs: 1,
        },
      }),
      hasMethod: () => false,
    });
    const deps = makeDeps({ dispatcher });
    const port = await startTestServer(deps);

    const res = await fetch(`http://127.0.0.1:${port}/v1/admin/no.such`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-admin-jwt",
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.category).toBe("not_found");
  });

  test("admin JWT verification failure returns 401", async () => {
    const deps = makeDeps({
      verifyAdminJwt: async () => Result.err(AuthError.create("Invalid JWT")),
    });
    const port = await startTestServer(deps);

    const res = await fetch(`http://127.0.0.1:${port}/v1/admin/signet.status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer bad-jwt",
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.category).toBe("auth");
  });

  test("error category maps to correct HTTP status codes", async () => {
    // validation -> 400
    const validationDispatcher = makeDispatcher({
      dispatch: async () => ({
        ok: false as const,
        error: {
          _tag: "ValidationError",
          category: "validation" as const,
          message: "Bad input",
          context: null,
        },
        meta: {
          requestId: "req-1",
          timestamp: new Date().toISOString(),
          durationMs: 1,
        },
      }),
    });
    const deps = makeDeps({ dispatcher: validationDispatcher });
    const port = await startTestServer(deps);

    const res = await fetch(`http://127.0.0.1:${port}/v1/admin/test.action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-admin-jwt",
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  test("start returns port on success", async () => {
    const deps = makeDeps();
    server = createHttpServer({ port: 0, host: "127.0.0.1" }, deps);

    const result = await server.start();
    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value.port).toBeGreaterThan(0);
    }
  });

  test("stop transitions state to stopped", async () => {
    const deps = makeDeps();
    await startTestServer(deps);

    expect(server.state).toBe("listening");
    const stopResult = await server.stop();
    expect(Result.isOk(stopResult)).toBe(true);
    expect(server.state).toBe("stopped");
  });
});
