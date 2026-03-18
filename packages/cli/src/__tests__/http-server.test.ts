import { describe, test, expect, afterEach } from "bun:test";
import { Result } from "better-result";
import { AuthError } from "@xmtp/signet-schemas";
import type { AdminDispatcher } from "../admin/dispatcher.js";
import {
  createHttpServer,
  type HttpServer,
  type HttpServerDeps,
} from "../http/server.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeDispatcher(overrides?: Partial<AdminDispatcher>): AdminDispatcher {
  return {
    dispatch:
      overrides?.dispatch ??
      (async () => ({
        ok: true as const,
        data: { status: "ok" },
        meta: {
          requestId: "req-1",
          timestamp: new Date().toISOString(),
          durationMs: 1,
        },
      })),
    hasMethod: overrides?.hasMethod ?? (() => true),
  };
}

function makeDeps(overrides?: Partial<HttpServerDeps>): HttpServerDeps {
  return {
    dispatcher: overrides?.dispatcher ?? makeDispatcher(),
    sessionManager:
      overrides?.sessionManager ?? ({} as HttpServerDeps["sessionManager"]),
    verifyAdminJwt:
      overrides?.verifyAdminJwt ?? (async () => Result.ok(undefined)),
    status: overrides?.status ?? (() => ({ state: "running", pid: 1 })),
  };
}

/** Pick a random high port to avoid collisions between parallel tests. */
function randomPort(): number {
  return 10_000 + Math.floor(Math.random() * 50_000);
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
    const port = randomPort();
    server = createHttpServer({ port, host: "127.0.0.1" }, deps);

    const startResult = await server.start();
    expect(Result.isOk(startResult)).toBe(true);

    const res = await fetch(`http://127.0.0.1:${port}/v1/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ ok: true, data: statusData });
  });

  test("POST /v1/admin/:method with valid JWT dispatches to admin", async () => {
    const dispatcher = makeDispatcher({
      dispatch: async () => ({
        ok: true as const,
        data: { sessions: [] },
        meta: {
          requestId: "req-1",
          timestamp: new Date().toISOString(),
          durationMs: 1,
        },
      }),
    });
    const deps = makeDeps({ dispatcher });
    const port = randomPort();
    server = createHttpServer({ port, host: "127.0.0.1" }, deps);
    await server.start();

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
    expect(body.data).toEqual({ sessions: [] });
  });

  test("unauthenticated request to /v1/admin returns 401", async () => {
    const deps = makeDeps();
    const port = randomPort();
    server = createHttpServer({ port, host: "127.0.0.1" }, deps);
    await server.start();

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
    const port = randomPort();
    server = createHttpServer({ port, host: "127.0.0.1" }, deps);
    await server.start();

    const res = await fetch(`http://127.0.0.1:${port}/v1/nonexistent`);
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
    const port = randomPort();
    server = createHttpServer({ port, host: "127.0.0.1" }, deps);
    await server.start();

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
    const port = randomPort();
    server = createHttpServer({ port, host: "127.0.0.1" }, deps);
    await server.start();

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
    const port = randomPort();
    server = createHttpServer({ port, host: "127.0.0.1" }, deps);
    await server.start();

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
    const port = randomPort();
    server = createHttpServer({ port, host: "127.0.0.1" }, deps);

    const result = await server.start();
    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value.port).toBe(port);
    }
  });

  test("stop transitions state to stopped", async () => {
    const deps = makeDeps();
    const port = randomPort();
    server = createHttpServer({ port, host: "127.0.0.1" }, deps);
    await server.start();

    expect(server.state).toBe("listening");
    const stopResult = await server.stop();
    expect(Result.isOk(stopResult)).toBe(true);
    expect(server.state).toBe("stopped");
  });
});
