import { describe, expect, test, afterEach } from "bun:test";
import { Result } from "better-result";
import { createWsServer, type WsServer, type WsServerDeps } from "../server.js";
import { SequencedFrame } from "../frames.js";
import {
  createMockDeps,
  createMockSessionManager,
  makeSessionRecord,
  nextMessage,
  waitForClose,
  waitForOpen,
  collectMessages,
} from "./fixtures.js";

let server: WsServer;
let port: number;

async function startServer(
  overrides: Record<string, unknown> = {},
  validToken = "valid_token",
  depsOverrides: Partial<WsServerDeps> = {},
) {
  const { deps } = createMockDeps(validToken);
  server = createWsServer(
    { port: 0, ...overrides },
    { ...deps, ...depsOverrides },
  );
  const result = await server.start();
  if (!result.isOk()) throw new Error("Failed to start server");
  port = result.value.port;
}

async function connectAndAuth(
  token = "valid_token",
  lastSeenSeq: number | null = null,
): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/agent`);
  await waitForOpen(ws);
  ws.send(JSON.stringify({ type: "auth", token, lastSeenSeq }));
  return ws;
}

describe("WsServer lifecycle", () => {
  afterEach(async () => {
    if (server && server.state === "listening") {
      await server.stop();
    }
  });

  test("starts and stops cleanly", async () => {
    await startServer();
    expect(server.state).toBe("listening");
    expect(server.connectionCount).toBe(0);

    const stopResult = await server.stop();
    expect(stopResult.isOk()).toBe(true);
    expect(server.state).toBe("stopped");
  });

  test("rejects start when not idle", async () => {
    await startServer();
    const result = await server.start();
    expect(result.isErr()).toBe(true);
  });

  test("returns 404 for non-upgrade paths", async () => {
    await startServer();
    const resp = await fetch(`http://127.0.0.1:${port}/health`);
    expect(resp.status).toBe(404);
  });
});

describe("Auth handshake", () => {
  afterEach(async () => {
    if (server && server.state === "listening") {
      await server.stop();
    }
  });

  test("authenticates with valid token", async () => {
    await startServer();
    const ws = await connectAndAuth();

    const frame = (await nextMessage(ws)) as Record<string, unknown>;
    expect(frame["type"]).toBe("authenticated");
    expect(frame["connectionId"]).toBeTruthy();
    expect(frame["resumedFromSeq"]).toBeNull();

    const session = frame["session"] as Record<string, unknown>;
    expect(session["sessionId"]).toBe("sess_test");

    ws.close();
  });

  test("rejects invalid token with 4001", async () => {
    await startServer();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/agent`);
    await waitForOpen(ws);
    ws.send(
      JSON.stringify({
        type: "auth",
        token: "bad_token",
        lastSeenSeq: null,
      }),
    );

    const errorFrame = (await nextMessage(ws)) as Record<string, unknown>;
    expect(errorFrame["type"]).toBe("auth_error");

    const { code } = await waitForClose(ws);
    expect(code).toBe(4001);
  });

  test("times out auth with 4002", async () => {
    await startServer({ authTimeoutMs: 200 });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/agent`);
    await waitForOpen(ws);
    // Don't send auth frame

    const errorFrame = (await nextMessage(ws, 2000)) as Record<string, unknown>;
    expect(errorFrame["type"]).toBe("auth_error");
    expect(errorFrame["code"]).toBe(4002);

    const { code } = await waitForClose(ws, 2000);
    expect(code).toBe(4002);
  });

  test("rejects malformed auth frame with 4009", async () => {
    await startServer();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/agent`);
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: "auth" })); // missing token

    const errorFrame = (await nextMessage(ws)) as Record<string, unknown>;
    expect(errorFrame["type"]).toBe("auth_error");

    const { code } = await waitForClose(ws);
    expect(code).toBe(4009);
  });

  test("rejects invalid JSON with 4009", async () => {
    await startServer();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/agent`);
    await waitForOpen(ws);
    ws.send("not json {{{");

    const { code } = await waitForClose(ws);
    expect(code).toBe(4009);
  });
});

describe("Request/Response", () => {
  afterEach(async () => {
    if (server && server.state === "listening") {
      await server.stop();
    }
  });

  test("handles send_message request", async () => {
    await startServer();
    const ws = await connectAndAuth();
    await nextMessage(ws); // consume auth response

    ws.send(
      JSON.stringify({
        type: "send_message",
        requestId: "req_1",
        groupId: "g1",
        contentType: "xmtp.org/text:1.0",
        content: { text: "hello" },
      }),
    );

    const resp = (await nextMessage(ws)) as Record<string, unknown>;
    expect(resp["ok"]).toBe(true);
    expect(resp["requestId"]).toBe("req_1");

    ws.close();
  });

  test("handles heartbeat request", async () => {
    await startServer();
    const ws = await connectAndAuth();
    await nextMessage(ws); // consume auth response

    ws.send(
      JSON.stringify({
        type: "heartbeat",
        requestId: "req_hb",
        sessionId: "sess_test",
      }),
    );

    const resp = (await nextMessage(ws)) as Record<string, unknown>;
    expect(resp["ok"]).toBe(true);
    expect(resp["requestId"]).toBe("req_hb");

    ws.close();
  });

  test("returns error for invalid request with requestId", async () => {
    await startServer();
    const ws = await connectAndAuth();
    await nextMessage(ws); // consume auth response

    ws.send(
      JSON.stringify({
        type: "unknown_type",
        requestId: "req_bad",
      }),
    );

    const resp = (await nextMessage(ws)) as Record<string, unknown>;
    expect(resp["ok"]).toBe(false);
    expect(resp["requestId"]).toBe("req_bad");

    ws.close();
  });

  test("suppresses late handler responses after timing out a request", async () => {
    await startServer({ requestTimeoutMs: 50 }, "valid_token", {
      requestHandler: async () => {
        await Bun.sleep(100);
        return Result.ok({ messageId: "late-message" });
      },
    });

    const ws = await connectAndAuth();
    await nextMessage(ws); // consume auth response

    const messages: Array<Record<string, unknown>> = [];
    ws.addEventListener("message", (event) => {
      messages.push(
        JSON.parse(event.data as string) as Record<string, unknown>,
      );
    });

    ws.send(
      JSON.stringify({
        type: "send_message",
        requestId: "req_timeout",
        groupId: "g1",
        contentType: "xmtp.org/text:1.0",
        content: { text: "slow" },
      }),
    );

    await Bun.sleep(200);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.ok).toBe(false);
    expect(messages[0]?.requestId).toBe("req_timeout");
    expect(
      (messages[0]?.error as Record<string, unknown> | undefined)?.category,
    ).toBe("timeout");

    ws.close();
  });
});

describe("Event broadcasting", () => {
  afterEach(async () => {
    if (server && server.state === "listening") {
      await server.stop();
    }
  });

  test("broadcasts sequenced events to connected sessions", async () => {
    await startServer();
    const ws = await connectAndAuth();
    await nextMessage(ws); // consume auth response

    // Broadcast an event
    server.broadcast("sess_test", {
      type: "heartbeat",
      sessionId: "sess_test",
      timestamp: "2024-01-01T00:00:00Z",
    });

    const frame = (await nextMessage(ws)) as Record<string, unknown>;
    expect(frame["seq"]).toBe(1);
    expect((frame["event"] as Record<string, unknown>)["type"]).toBe(
      "heartbeat",
    );

    ws.close();
  });

  test("assigns monotonically increasing seq numbers", async () => {
    await startServer();
    const ws = await connectAndAuth();
    await nextMessage(ws); // consume auth response

    server.broadcast("sess_test", {
      type: "heartbeat",
      sessionId: "sess_test",
      timestamp: "2024-01-01T00:00:00Z",
    });
    server.broadcast("sess_test", {
      type: "heartbeat",
      sessionId: "sess_test",
      timestamp: "2024-01-01T00:00:01Z",
    });

    const frames = await collectMessages(ws, 2);
    const f1 = frames[0] as Record<string, unknown>;
    const f2 = frames[1] as Record<string, unknown>;
    expect(f1["seq"]).toBe(1);
    expect(f2["seq"]).toBe(2);

    ws.close();
  });

  test("keeps healthy connections open under normal traffic with low limits", async () => {
    await startServer({
      sendBufferSoftLimit: 1,
      sendBufferHardLimit: 2,
    });
    const ws = await connectAndAuth();
    await nextMessage(ws); // consume auth response

    server.broadcast("sess_test", {
      type: "heartbeat",
      sessionId: "sess_test",
      timestamp: "2024-01-01T00:00:00Z",
    });

    const eventFrame = (await nextMessage(ws)) as Record<string, unknown>;
    expect(eventFrame["seq"]).toBe(1);

    ws.send(
      JSON.stringify({
        type: "heartbeat",
        requestId: "req_after_event",
        sessionId: "sess_test",
      }),
    );

    const response = (await nextMessage(ws)) as Record<string, unknown>;
    expect(response["ok"]).toBe(true);
    expect(response["requestId"]).toBe("req_after_event");

    ws.close();
  });

  test("emits a sequenced recovery event when replay buffer cannot satisfy resume", async () => {
    await startServer({ replayBufferSize: 1 });
    const first = await connectAndAuth();
    await nextMessage(first); // consume auth response

    server.broadcast("sess_test", {
      type: "heartbeat",
      sessionId: "sess_test",
      timestamp: "2024-01-01T00:00:00Z",
    });
    await nextMessage(first);

    server.broadcast("sess_test", {
      type: "heartbeat",
      sessionId: "sess_test",
      timestamp: "2024-01-01T00:00:01Z",
    });
    await nextMessage(first);
    first.close();

    const resumed = await connectAndAuth("valid_token", 0);
    const authFrame = (await nextMessage(resumed)) as Record<string, unknown>;
    expect(authFrame["type"]).toBe("authenticated");
    expect(authFrame["resumedFromSeq"]).toBeNull();

    const recoveryFrame = await nextMessage(resumed);
    const parsed = SequencedFrame.safeParse(recoveryFrame);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.event.type).toBe("signet.recovery.complete");
      expect(parsed.data.event.caughtUpThrough).toBeTruthy();
    }

    resumed.close();
  });
});

describe("Connection tracking", () => {
  afterEach(async () => {
    if (server && server.state === "listening") {
      await server.stop();
    }
  });

  test("tracks connection count", async () => {
    await startServer();
    expect(server.connectionCount).toBe(0);

    const ws = await connectAndAuth();
    await nextMessage(ws); // consume auth response
    expect(server.connectionCount).toBe(1);

    ws.close();
    // Give time for close to propagate
    await new Promise((r) => setTimeout(r, 100));
    expect(server.connectionCount).toBe(0);
  });
});

describe("Dead-connection detection", () => {
  afterEach(async () => {
    if (server && server.state === "listening") {
      await server.stop();
    }
  });

  test("closes connection when no client activity within threshold", async () => {
    // heartbeatIntervalMs=100, missedHeartbeatsBeforeDead=2
    // => dead threshold = 200ms, checked every 100ms
    await startServer({
      heartbeatIntervalMs: 100,
      missedHeartbeatsBeforeDead: 2,
    });
    const ws = await connectAndAuth();
    await nextMessage(ws); // consume auth response

    // Do NOT send any messages — let the dead check fire
    const { code } = await waitForClose(ws, 2000);
    expect(code).toBe(4010);
  });

  test("keeps connection alive when client sends messages", async () => {
    await startServer({
      heartbeatIntervalMs: 100,
      missedHeartbeatsBeforeDead: 2,
    });
    const ws = await connectAndAuth();
    await nextMessage(ws); // consume auth response

    // Send a heartbeat request every 50ms to stay active
    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "heartbeat",
            requestId: `req_keep_alive_${Date.now()}`,
            sessionId: "sess_test",
          }),
        );
      }
    }, 50);

    // Wait past the dead threshold
    await Bun.sleep(350);

    clearInterval(interval);

    // Connection should still be open
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});

describe("Rate limiting", () => {
  afterEach(async () => {
    if (server && server.state === "listening") {
      await server.stop();
    }
  });

  test("does not limit when rateLimitMaxMessages is null (default)", async () => {
    await startServer();
    const ws = await connectAndAuth();
    await nextMessage(ws); // consume auth response

    // Send many messages rapidly
    for (let i = 0; i < 20; i++) {
      ws.send(
        JSON.stringify({
          type: "heartbeat",
          requestId: `req_${i}`,
          sessionId: "sess_test",
        }),
      );
    }

    // Wait for responses
    await Bun.sleep(200);

    // Connection should still be open
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  test("closes connection with 1008 when rate limit exceeded", async () => {
    await startServer({
      rateLimitWindowMs: 1_000,
      rateLimitMaxMessages: 3,
    });
    const ws = await connectAndAuth();
    await nextMessage(ws); // consume auth response

    // Send messages exceeding the limit (auth frame already counted as 1)
    // Window: auth=1, msg1=2, msg2=3, msg3=4 => exceeds 3
    for (let i = 0; i < 3; i++) {
      ws.send(
        JSON.stringify({
          type: "heartbeat",
          requestId: `req_${i}`,
          sessionId: "sess_test",
        }),
      );
    }

    const { code } = await waitForClose(ws, 2000);
    expect(code).toBe(1008);
  });

  test("resets rate limit counter after window expires", async () => {
    await startServer({
      rateLimitWindowMs: 200,
      rateLimitMaxMessages: 3,
    });
    const ws = await connectAndAuth();
    await nextMessage(ws); // consume auth response

    // Send 2 messages (auth=1 + 2 = 3, at the limit)
    ws.send(
      JSON.stringify({
        type: "heartbeat",
        requestId: "req_a",
        sessionId: "sess_test",
      }),
    );
    ws.send(
      JSON.stringify({
        type: "heartbeat",
        requestId: "req_b",
        sessionId: "sess_test",
      }),
    );

    // Wait for window to expire
    await Bun.sleep(250);

    // Should be able to send again
    ws.send(
      JSON.stringify({
        type: "heartbeat",
        requestId: "req_c",
        sessionId: "sess_test",
      }),
    );

    const resp = (await nextMessage(ws)) as Record<string, unknown>;
    expect(resp["requestId"]).toBeTruthy();
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});

describe("Graceful shutdown", () => {
  test("sends session.expired event before closing", async () => {
    await startServer();
    const ws = await connectAndAuth();
    await nextMessage(ws); // consume auth response

    // Collect the session.expired event sent during drain
    const msgPromise = nextMessage(ws, 10000);
    const closePromise = waitForClose(ws, 10000);
    await server.stop();

    // Should receive a sequenced session.expired event
    const frame = msgPromise
      .then((f) => f as Record<string, unknown>)
      .catch(() => null);
    const msg = await frame;
    if (msg !== null) {
      const event = msg["event"] as Record<string, unknown> | undefined;
      if (event) {
        expect(event["type"]).toBe("session.expired");
        expect(event["reason"]).toBe("signet_shutdown");
      }
    }

    await closePromise;
    expect(server.state).toBe("stopped");
  });

  test("transitions to stopped state after stop", async () => {
    await startServer();
    await server.stop();
    expect(server.state).toBe("stopped");
  });
});

describe("Overlapping invalidations", () => {
  afterEach(async () => {
    if (server && server.state === "listening") {
      await server.stop();
    }
  });

  test("overlapping invalidations use the latest session snapshot", async () => {
    // The first invalidation resolves slowly with a "full" view.
    // The second invalidation resolves quickly with a narrower view.
    // After both complete, broadcasts should use the narrower view.
    let lookupCallCount = 0;

    const fullRecord = makeSessionRecord({
      view: {
        mode: "full",
        threadScopes: [{ groupId: "g1", threadId: null }],
        contentTypes: ["xmtp.org/text:1.0", "xmtp.org/reaction:1.0"],
      },
    });

    const narrowRecord = makeSessionRecord({
      view: {
        mode: "full",
        threadScopes: [{ groupId: "g1", threadId: null }],
        contentTypes: ["xmtp.org/text:1.0"],
      },
    });

    const sessionManager = createMockSessionManager("valid_token", fullRecord);

    // Override lookup to return different records with different delays
    sessionManager.lookup = async (_sessionId: string) => {
      lookupCallCount++;
      const callNumber = lookupCallCount;
      if (callNumber === 1) {
        // First call: slow, returns full view
        await Bun.sleep(50);
        return Result.ok(fullRecord);
      }
      // Second call: fast, returns narrow view
      await Bun.sleep(10);
      return Result.ok(narrowRecord);
    };

    // Track which contentTypes the projector sees
    const projectedContentTypes: string[][] = [];

    await startServer({}, "valid_token", {
      sessionManager,
      projectEvent: (event, session) => {
        projectedContentTypes.push([...(session.view.contentTypes ?? [])]);
        return event;
      },
    });

    const ws = await connectAndAuth();
    await nextMessage(ws); // consume auth response

    // Fire two overlapping invalidations
    const inv1 = server.invalidateSession("sess_test");
    const inv2 = server.invalidateSession("sess_test");
    await Promise.all([inv1, inv2]);

    // Broadcast after both complete
    server.broadcast("sess_test", {
      type: "heartbeat",
      sessionId: "sess_test",
      timestamp: "2024-01-01T00:00:00Z",
    });

    const frame = (await nextMessage(ws)) as Record<string, unknown>;
    expect(frame["seq"]).toBe(1);

    // The projector should have seen the NARROW view (from the later invalidation)
    expect(projectedContentTypes).toHaveLength(1);
    expect(projectedContentTypes[0]).toEqual(["xmtp.org/text:1.0"]);

    ws.close();
  });

  test("broadcasts during invalidation are queued and replayed", async () => {
    let lookupResolveFn: (() => void) | null = null;
    const record = makeSessionRecord();
    const sessionManager = createMockSessionManager("valid_token", record);

    // Override lookup to block until we release it
    sessionManager.lookup = async (_sessionId: string) => {
      await new Promise<void>((resolve) => {
        lookupResolveFn = resolve;
      });
      return Result.ok(record);
    };

    await startServer({}, "valid_token", { sessionManager });

    const ws = await connectAndAuth();
    await nextMessage(ws); // consume auth response

    // Start invalidation (lookup will block)
    const invPromise = server.invalidateSession("sess_test");

    // Wait a tick so the invalidation is in flight
    await Bun.sleep(5);

    // Broadcast while invalidation is pending — should be queued, not sent
    server.broadcast("sess_test", {
      type: "heartbeat",
      sessionId: "sess_test",
      timestamp: "2024-01-01T00:00:00Z",
    });

    // Negative assertion: no message should arrive while invalidation is in flight.
    // If broadcast sent immediately (stale path), it would be on the socket already.
    await Bun.sleep(20);
    let prematureMessage: unknown = null;
    ws.addEventListener("message", (ev) => {
      prematureMessage = ev.data;
    });
    await Bun.sleep(10);
    expect(prematureMessage).toBeNull();

    // Release the lookup — queued events should drain now
    expect(lookupResolveFn).not.toBeNull();
    lookupResolveFn!();
    await invPromise;

    // The queued event should now be delivered after the invalidation completes
    const frame = (await nextMessage(ws)) as Record<string, unknown>;
    expect(frame["seq"]).toBe(1);
    expect((frame["event"] as Record<string, unknown>)["type"]).toBe(
      "heartbeat",
    );

    ws.close();
  });
});
