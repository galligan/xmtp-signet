/**
 * WebSocket edge case integration tests.
 *
 * Validates transport-level behaviors: auth timeout, invalid tokens,
 * backpressure, replay, and graceful shutdown using real WsServer.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { rm } from "node:fs/promises";
import { WS_CLOSE_CODES } from "@xmtp/signet-ws";
import {
  createTestRuntime,
  issueTestSession,
} from "../fixtures/test-runtime.js";
import {
  connectTestClient,
  connectAndAuth,
} from "../fixtures/test-ws-client.js";

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanup) {
    await cleanup();
    cleanup = null;
  }
});

describe("ws-edge-cases", () => {
  test("auth timeout closes connection with 4002", async () => {
    const result = await createTestRuntime({
      wsConfig: { authTimeoutMs: 500 },
    });
    cleanup = result.cleanup;
    const { runtime } = result;

    const client = await connectTestClient(runtime.wsPort);

    // Don't send auth frame; wait for timeout
    const closePromise = new Promise<{ code: number }>((resolve) => {
      client.ws.addEventListener("close", (event) => {
        resolve({ code: event.code });
      });
    });

    // Should get auth_error frame before close
    const errorFrame = (await client.nextMessage(2_000)) as Record<
      string,
      unknown
    >;
    expect(errorFrame["type"]).toBe("auth_error");
    expect(errorFrame["code"]).toBe(WS_CLOSE_CODES.AUTH_TIMEOUT);

    const closeEvent = await closePromise;
    expect(closeEvent.code).toBe(WS_CLOSE_CODES.AUTH_TIMEOUT);
  });

  test("invalid token closes connection with 4001", async () => {
    const result = await createTestRuntime();
    cleanup = result.cleanup;
    const { runtime } = result;

    const client = await connectTestClient(runtime.wsPort, {
      token: "totally-invalid-token",
    });

    const closePromise = new Promise<{ code: number }>((resolve) => {
      client.ws.addEventListener("close", (event) => {
        resolve({ code: event.code });
      });
    });

    const errorFrame = (await client.nextMessage()) as Record<string, unknown>;
    expect(errorFrame["type"]).toBe("auth_error");
    expect(errorFrame["code"]).toBe(WS_CLOSE_CODES.AUTH_FAILED);

    const closeEvent = await closePromise;
    expect(closeEvent.code).toBe(WS_CLOSE_CODES.AUTH_FAILED);
  });

  test("malformed frame without requestId closes with 4009", async () => {
    const result = await createTestRuntime();
    cleanup = result.cleanup;
    const { runtime } = result;

    const { token } = await issueTestSession(runtime);
    const { client } = await connectAndAuth(runtime.wsPort, token);

    const closePromise = new Promise<{ code: number }>((resolve) => {
      client.ws.addEventListener("close", (event) => {
        resolve({ code: event.code });
      });
    });

    // Send completely malformed frame (no type, no requestId)
    client.send({ garbage: true });

    const closeEvent = await closePromise;
    expect(closeEvent.code).toBe(WS_CLOSE_CODES.PROTOCOL_ERROR);
  });

  test("malformed frame with requestId returns error response", async () => {
    const result = await createTestRuntime();
    cleanup = result.cleanup;
    const { runtime } = result;

    const { token } = await issueTestSession(runtime);
    const { client } = await connectAndAuth(runtime.wsPort, token);

    // Send frame with requestId but invalid type
    client.send({ type: "bogus_type", requestId: "req-1" });

    const response = (await client.nextMessage()) as Record<string, unknown>;
    expect(response["ok"]).toBe(false);
    expect(response["requestId"]).toBe("req-1");

    await client.close();
  });

  test("replay buffer works across reconnections", async () => {
    const result = await createTestRuntime({
      wsConfig: { replayBufferSize: 100 },
    });
    cleanup = result.cleanup;
    const { runtime } = result;

    const { token } = await issueTestSession(runtime);

    // First connection
    const { client: client1 } = await connectAndAuth(runtime.wsPort, token);

    // Get session ID from token
    const tokenLookup = runtime.sessionManager.getSessionByToken(token);
    expect(tokenLookup.isOk()).toBe(true);
    if (!tokenLookup.isOk()) return;
    const sessionId = tokenLookup.value.sessionId;

    // Broadcast some events
    runtime.wsServer.broadcast(sessionId, {
      type: "heartbeat",
      sessionId: "test",
      timestamp: new Date().toISOString(),
    });

    const event1 = (await client1.nextMessage()) as Record<string, unknown>;
    expect(event1["seq"]).toBe(1);

    // Broadcast another
    runtime.wsServer.broadcast(sessionId, {
      type: "heartbeat",
      sessionId: "test",
      timestamp: new Date().toISOString(),
    });

    const event2 = (await client1.nextMessage()) as Record<string, unknown>;
    expect(event2["seq"]).toBe(2);

    // Disconnect
    await client1.close();

    // Reconnect with lastSeenSeq = 1 (should replay seq 2)
    const { client: client2, authFrame } = await connectAndAuth(
      runtime.wsPort,
      token,
      1,
    );
    expect(authFrame["resumedFromSeq"]).toBe(1);

    // Should receive replayed event with seq 2
    const replayed = (await client2.nextMessage()) as Record<string, unknown>;
    expect(replayed["seq"]).toBe(2);

    await client2.close();
  });

  test("backpressure soft limit sends warning frame", async () => {
    // Use low limits and large payloads to saturate the kernel send buffer.
    // Backpressure only triggers when Bun's ws.send() returns -1 (kernel
    // buffer full), so we need to overwhelm the loopback TCP buffer by
    // sending faster than the client reads.
    const result = await createTestRuntime({
      wsConfig: {
        sendBufferSoftLimit: 2,
        sendBufferHardLimit: 100,
        // Allow large frames so we can send big payloads
        maxFrameSizeBytes: 16 * 1024 * 1024,
      },
    });
    cleanup = result.cleanup;
    const { runtime } = result;

    const { token } = await issueTestSession(runtime);
    // Connect a raw WebSocket that authenticates but never reads fast
    const ws = new WebSocket(`ws://127.0.0.1:${runtime.wsPort}/v1/agent`);
    await new Promise<void>((resolve) => {
      ws.addEventListener("open", () => resolve());
    });

    // Authenticate
    ws.send(JSON.stringify({ type: "auth", token, lastSeenSeq: null }));

    // Collect messages to look for backpressure frame
    const received: Array<Record<string, unknown>> = [];
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(
        typeof event.data === "string"
          ? event.data
          : new TextDecoder().decode(event.data as ArrayBuffer),
      ) as Record<string, unknown>;
      received.push(data);
    });

    // Wait for auth to complete
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (received.some((m) => m["type"] === "authenticated")) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    const tokenLookup = runtime.sessionManager.getSessionByToken(token);
    expect(tokenLookup.isOk()).toBe(true);
    if (!tokenLookup.isOk()) return;
    const sessionId = tokenLookup.value.sessionId;

    // Flood with large events to fill the kernel send buffer.
    // Each heartbeat event has a large padding field to fill the TCP buffer.
    const bigPadding = "x".repeat(64 * 1024); // 64 KB per event
    for (let i = 0; i < 200; i++) {
      runtime.wsServer.broadcast(sessionId, {
        type: "heartbeat",
        sessionId: bigPadding,
        timestamp: new Date().toISOString(),
      });
    }

    // Give time for messages to arrive
    await new Promise((r) => setTimeout(r, 500));

    const bpFrame = received.find((f) => f["type"] === "backpressure");
    expect(bpFrame).toBeDefined();
    if (bpFrame) {
      expect(typeof bpFrame["buffered"]).toBe("number");
      expect(bpFrame["limit"]).toBe(100); // hard limit
    }

    ws.close();
  });

  test("backpressure hard limit closes connection with 4008", async () => {
    // Low hard limit + large payloads to exceed the threshold quickly
    const result = await createTestRuntime({
      wsConfig: {
        sendBufferSoftLimit: 1,
        sendBufferHardLimit: 3,
        maxFrameSizeBytes: 16 * 1024 * 1024,
      },
    });
    cleanup = result.cleanup;
    const { runtime } = result;

    const { token } = await issueTestSession(runtime);
    const ws = new WebSocket(`ws://127.0.0.1:${runtime.wsPort}/v1/agent`);
    await new Promise<void>((resolve) => {
      ws.addEventListener("open", () => resolve());
    });

    // Authenticate
    ws.send(JSON.stringify({ type: "auth", token, lastSeenSeq: null }));

    // Wait for authenticated frame
    await new Promise<void>((resolve) => {
      const handler = (event: MessageEvent) => {
        const data = JSON.parse(
          typeof event.data === "string"
            ? event.data
            : new TextDecoder().decode(event.data as ArrayBuffer),
        ) as Record<string, unknown>;
        if (data["type"] === "authenticated") {
          ws.removeEventListener("message", handler);
          resolve();
        }
      };
      ws.addEventListener("message", handler);
    });

    const closePromise = new Promise<{ code: number }>((resolve) => {
      ws.addEventListener("close", (event) => {
        resolve({ code: event.code });
      });
    });

    const tokenLookup = runtime.sessionManager.getSessionByToken(token);
    expect(tokenLookup.isOk()).toBe(true);
    if (!tokenLookup.isOk()) return;
    const sessionId = tokenLookup.value.sessionId;

    // Flood with large events to exceed hard limit
    const bigPadding = "x".repeat(256 * 1024); // 256 KB per event
    for (let i = 0; i < 200; i++) {
      runtime.wsServer.broadcast(sessionId, {
        type: "heartbeat",
        sessionId: bigPadding,
        timestamp: new Date().toISOString(),
      });
    }

    const closeEvent = await closePromise;
    expect(closeEvent.code).toBe(WS_CLOSE_CODES.BACKPRESSURE);
  });

  test("graceful shutdown sends session.expired to active connections", async () => {
    const result = await createTestRuntime();
    cleanup = null; // We'll handle cleanup ourselves

    const { runtime } = result;
    const { token } = await issueTestSession(runtime);
    const { client } = await connectAndAuth(runtime.wsPort, token);

    const closePromise = new Promise<{ code: number }>((resolve) => {
      client.ws.addEventListener("close", (event) => {
        resolve({ code: event.code });
      });
    });

    // Stop the server
    await runtime.wsServer.stop();

    // Should receive session.expired event before close
    const event = (await client.nextMessage(2_000)) as Record<string, unknown>;
    expect((event["event"] as Record<string, unknown>)?.["type"]).toBe(
      "session.expired",
    );

    const closeEvent = await closePromise;
    // Server sends GOING_AWAY (1001), but Bun client may normalize to 1000
    expect(
      closeEvent.code === WS_CLOSE_CODES.NORMAL ||
        closeEvent.code === WS_CLOSE_CODES.GOING_AWAY,
    ).toBe(true);

    // Cleanup remaining resources
    await runtime.signet.stop().catch(() => {});
    runtime.keyManager.close();
    await rm(runtime.dataDir, { recursive: true, force: true });
  });
});
