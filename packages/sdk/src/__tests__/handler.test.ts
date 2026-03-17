import { describe, test, expect, afterEach } from "bun:test";
import {
  AuthError,
  InternalError,
  PermissionError,
} from "@xmtp/signet-schemas";
import type { HandlerState } from "../types.js";
import {
  createMockServer,
  createTestHandler,
  waitForState,
  type TestHarness,
} from "./mock-server.js";
import { createSignetHandler } from "../handler.js";

let harness: TestHarness;

afterEach(async () => {
  if (harness) {
    await harness.cleanup();
  }
});

describe("Handler lifecycle", () => {
  test("initial state is disconnected", () => {
    harness = createTestHandler();
    expect(harness.handler.state).toBe("disconnected");
  });

  test("session is null before connect", () => {
    harness = createTestHandler();
    expect(harness.handler.session).toBeNull();
  });

  test("connect transitions to connected", async () => {
    harness = createTestHandler();
    const result = await harness.handler.connect();
    expect(result.isOk()).toBe(true);
    expect(harness.handler.state).toBe("connected");
  });

  test("session is populated after connect", async () => {
    harness = createTestHandler();
    await harness.handler.connect();
    const session = harness.handler.session;
    expect(session).not.toBeNull();
    expect(session?.sessionId).toBe("sess_test");
    expect(session?.agentInboxId).toBe("agent_inbox_1");
    expect(session?.expiresAt).toBeTruthy();
  });

  test("auth failure transitions to closed", async () => {
    harness = createTestHandler({
      serverOptions: { authBehavior: "reject" },
    });
    const result = await harness.handler.connect();
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(AuthError);
    }
    expect(harness.handler.state).toBe("closed");
  });

  test("disconnect transitions to closed", async () => {
    harness = createTestHandler();
    await harness.handler.connect();
    const result = await harness.handler.disconnect();
    expect(result.isOk()).toBe(true);
    expect(harness.handler.state).toBe("closed");
  });

  test("state change callbacks fire in order", async () => {
    harness = createTestHandler();
    const states: HandlerState[] = [];
    harness.handler.onStateChange((s) => states.push(s));

    await harness.handler.connect();
    expect(states).toEqual(["connecting", "authenticating", "connected"]);
  });

  test("unsubscribe stops callbacks", async () => {
    harness = createTestHandler();
    const states: HandlerState[] = [];
    const unsub = harness.handler.onStateChange((s) => states.push(s));

    unsub();
    await harness.handler.connect();
    expect(states).toHaveLength(0);
  });
});

describe("Disconnected rejection", () => {
  test("sendMessage while disconnected returns error", async () => {
    harness = createTestHandler();
    const result = await harness.handler.sendMessage("g1", {
      type: "text",
      text: "nope",
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.category).toBe("validation");
    }
  });
});

describe("Backpressure", () => {
  test("backpressure frame emits error via onError", async () => {
    harness = createTestHandler();
    await harness.handler.connect();

    const errors: Array<{ category: string }> = [];
    harness.handler.onError((e) => errors.push(e));

    harness.sendBackpressure({ buffered: 200, limit: 256 });
    // Give the event loop a tick
    await Bun.sleep(50);

    expect(errors).toHaveLength(1);
    expect(harness.handler.state).toBe("connected");
  });
});

describe("Non-retryable close codes", () => {
  test("close code 4004 transitions to closed without reconnection", async () => {
    harness = createTestHandler({
      config: {
        reconnect: { enabled: true, baseDelayMs: 50, maxDelayMs: 200 },
      },
    });
    await harness.handler.connect();

    harness.closeWith(4004, "session revoked");
    await waitForState(harness.handler, "closed");
    expect(harness.handler.state).toBe("closed");
  });
});

describe("Auth timeout", () => {
  test("connect rejects when server never sends auth response", async () => {
    const mock = createMockServer({ authBehavior: "no-response" });
    const handler = createSignetHandler({
      url: mock.url,
      token: "test-token",
      reconnect: {
        enabled: false,
        maxAttempts: 0,
        baseDelayMs: 100,
        maxDelayMs: 100,
        jitter: false,
      },
      requestTimeoutMs: 500,
    });

    const result = await handler.connect();
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(InternalError);
      expect(result.error.message).toContain("500ms");
    }

    await handler.disconnect();
    await mock.server.stop();
  });
});

describe("Error category preservation", () => {
  test("permission error from signet returns PermissionError", async () => {
    // Custom server that responds to requests with a permission error
    const bunServer = Bun.serve({
      port: 0,
      fetch(req, server) {
        server.upgrade(req, { data: {} });
        return undefined;
      },
      websocket: {
        open() {},
        message(ws, message) {
          const data = JSON.parse(
            typeof message === "string" ? message : message.toString(),
          ) as Record<string, unknown>;

          if (data["type"] === "auth") {
            ws.send(
              JSON.stringify({
                type: "authenticated",
                connectionId: "conn_1",
                session: {
                  sessionId: "sess_test",
                  agentInboxId: "agent_1",
                  sessionKeyFingerprint: "fp_1",
                  issuedAt: "2024-01-01T00:00:00Z",
                  expiresAt: "2025-01-01T00:00:00Z",
                },
                view: {},
                grant: {},
                resumedFromSeq: null,
              }),
            );
            return;
          }

          // Respond to all requests with a permission error
          if ("requestId" in data) {
            ws.send(
              JSON.stringify({
                ok: false,
                requestId: data["requestId"],
                error: {
                  code: 4003,
                  category: "permission",
                  message: "Not allowed to send to this group",
                  context: null,
                },
              }),
            );
          }
        },
        close() {},
      },
    });

    const handler = createSignetHandler({
      url: `ws://127.0.0.1:${bunServer.port}/`,
      token: "test-token",
      reconnect: {
        enabled: false,
        maxAttempts: 0,
        baseDelayMs: 100,
        maxDelayMs: 100,
        jitter: false,
      },
      requestTimeoutMs: 5000,
    });

    await handler.connect();
    const result = await handler.sendMessage("g1", {
      type: "text",
      text: "hello",
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(PermissionError);
      expect(result.error.category).toBe("permission");
    }

    await handler.disconnect();
    bunServer.stop(true);
  });
});
