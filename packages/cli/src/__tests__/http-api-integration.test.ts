import { describe, test, expect, afterEach } from "bun:test";
import { Result } from "better-result";
import type { AdminJwtPayload } from "@xmtp/signet-keys";
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
    credentialManager:
      overrides?.credentialManager ??
      ({} as HttpServerDeps["credentialManager"]),
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
    status: overrides?.status ?? (() => ({ state: "running", pid: 1 })),
  };
}

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

describe("HTTP API integration", () => {
  test("health endpoint returns 200 with ok: true", async () => {
    const deps = makeDeps({
      status: () => ({ state: "running", pid: 42 }),
    });
    const port = randomPort();
    server = createHttpServer({ port, host: "127.0.0.1" }, deps);
    await server.start();

    const res = await fetch(`http://127.0.0.1:${port}/v1/health`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.state).toBe("running");
  });

  test("admin endpoint with valid auth dispatches and returns result", async () => {
    const dispatcher = makeDispatcher({
      dispatch: async () => ({
        ok: true as const,
        data: { activeCredentials: 3 },
        meta: {
          requestId: "req-admin",
          timestamp: new Date().toISOString(),
          durationMs: 2,
        },
      }),
    });
    const deps = makeDeps({ dispatcher });
    const port = randomPort();
    server = createHttpServer({ port, host: "127.0.0.1" }, deps);
    await server.start();

    const res = await fetch(`http://127.0.0.1:${port}/v1/admin/broker.status`, {
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
    expect(body.data).toEqual({ activeCredentials: 3 });
  });

  test("unauthenticated admin request returns 401", async () => {
    const deps = makeDeps();
    const port = randomPort();
    server = createHttpServer({ port, host: "127.0.0.1" }, deps);
    await server.start();

    const res = await fetch(`http://127.0.0.1:${port}/v1/admin/broker.status`, {
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
});
