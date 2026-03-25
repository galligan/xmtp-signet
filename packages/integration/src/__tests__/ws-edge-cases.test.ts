/**
 * WebSocket edge case integration tests.
 *
 * Validates transport-level behaviors: auth timeout, invalid tokens,
 * backpressure, replay, and graceful shutdown using a real WsServer.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { rm } from "node:fs/promises";
import { WS_CLOSE_CODES } from "@xmtp/signet-ws";
import {
  createTestRuntime,
  issueTestCredential,
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

    const closePromise = new Promise<{ code: number }>((resolve) => {
      client.ws.addEventListener("close", (event) => {
        resolve({ code: event.code });
      });
    });

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

    const { token } = await issueTestCredential(runtime);
    const { client } = await connectAndAuth(runtime.wsPort, token);

    const closePromise = new Promise<{ code: number }>((resolve) => {
      client.ws.addEventListener("close", (event) => {
        resolve({ code: event.code });
      });
    });

    client.send({ garbage: true });

    const closeEvent = await closePromise;
    expect(closeEvent.code).toBe(WS_CLOSE_CODES.PROTOCOL_ERROR);
  });

  test("malformed frame with requestId returns error response", async () => {
    const result = await createTestRuntime();
    cleanup = result.cleanup;
    const { runtime } = result;

    const { token } = await issueTestCredential(runtime);
    const { client } = await connectAndAuth(runtime.wsPort, token);

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

    const { token, credentialId } = await issueTestCredential(runtime);

    const { client: client1 } = await connectAndAuth(runtime.wsPort, token);

    runtime.wsServer.broadcast(credentialId, {
      type: "heartbeat",
      credentialId,
      timestamp: new Date().toISOString(),
    });

    const event1 = (await client1.nextMessage()) as Record<string, unknown>;
    expect(event1["seq"]).toBe(1);

    runtime.wsServer.broadcast(credentialId, {
      type: "heartbeat",
      credentialId,
      timestamp: new Date().toISOString(),
    });

    const event2 = (await client1.nextMessage()) as Record<string, unknown>;
    expect(event2["seq"]).toBe(2);

    await client1.close();

    const { client: client2, authFrame } = await connectAndAuth(
      runtime.wsPort,
      token,
      1,
    );
    expect(authFrame["resumedFromSeq"]).toBe(1);

    const replayed = (await client2.nextMessage()) as Record<string, unknown>;
    expect(replayed["seq"]).toBe(2);

    await client2.close();
  });

  test("backpressure soft limit sends warning frame", async () => {
    const result = await createTestRuntime({
      wsConfig: {
        sendBufferSoftLimit: 2,
        sendBufferHardLimit: 100,
        maxFrameSizeBytes: 16 * 1024 * 1024,
      },
    });
    cleanup = result.cleanup;
    const { runtime } = result;

    const { token, credentialId } = await issueTestCredential(runtime);
    const ws = new WebSocket(`ws://127.0.0.1:${runtime.wsPort}/v1/agent`);
    await new Promise<void>((resolve) => {
      ws.addEventListener("open", () => resolve());
    });

    ws.send(JSON.stringify({ type: "auth", token, lastSeenSeq: null }));

    const received: Array<Record<string, unknown>> = [];
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(
        typeof event.data === "string"
          ? event.data
          : new TextDecoder().decode(event.data as ArrayBuffer),
      ) as Record<string, unknown>;
      received.push(data);
    });

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (received.some((m) => m["type"] === "authenticated")) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    const bigPadding = "x".repeat(64 * 1024);
    for (let i = 0; i < 200; i++) {
      runtime.wsServer.broadcast(credentialId, {
        type: "heartbeat",
        credentialId: bigPadding,
        timestamp: new Date().toISOString(),
      });
    }

    await new Promise((r) => setTimeout(r, 500));

    const bpFrame = received.find((f) => f["type"] === "backpressure");
    expect(bpFrame).toBeDefined();
    if (bpFrame) {
      expect(typeof bpFrame["buffered"]).toBe("number");
      expect(bpFrame["limit"]).toBe(100);
    }

    ws.close();
  });

  test("backpressure hard limit closes connection with 4008", async () => {
    const result = await createTestRuntime({
      wsConfig: {
        sendBufferSoftLimit: 1,
        sendBufferHardLimit: 3,
        maxFrameSizeBytes: 16 * 1024 * 1024,
      },
    });
    cleanup = result.cleanup;
    const { runtime } = result;

    const { token, credentialId } = await issueTestCredential(runtime);
    const ws = new WebSocket(`ws://127.0.0.1:${runtime.wsPort}/v1/agent`);
    await new Promise<void>((resolve) => {
      ws.addEventListener("open", () => resolve());
    });

    ws.send(JSON.stringify({ type: "auth", token, lastSeenSeq: null }));

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

    const bigPadding = "x".repeat(256 * 1024);
    for (let i = 0; i < 200; i++) {
      runtime.wsServer.broadcast(credentialId, {
        type: "heartbeat",
        credentialId: bigPadding,
        timestamp: new Date().toISOString(),
      });
    }

    const closeEvent = await closePromise;
    expect(closeEvent.code).toBe(WS_CLOSE_CODES.BACKPRESSURE);
  });

  test("graceful shutdown sends credential.expired to active connections", async () => {
    const result = await createTestRuntime();
    cleanup = null;

    const { runtime } = result;
    const { token } = await issueTestCredential(runtime);
    const { client } = await connectAndAuth(runtime.wsPort, token);

    const closePromise = new Promise<{ code: number }>((resolve) => {
      client.ws.addEventListener("close", (event) => {
        resolve({ code: event.code });
      });
    });

    await runtime.wsServer.stop();

    const frame = (await client.nextMessage(2_000)) as Record<string, unknown>;
    const event = frame["event"] as Record<string, unknown>;
    expect(event["type"]).toBe("credential.expired");
    expect(event["reason"]).toBe("signet_shutdown");

    const closeEvent = await closePromise;
    expect(
      closeEvent.code === WS_CLOSE_CODES.NORMAL ||
        closeEvent.code === WS_CLOSE_CODES.GOING_AWAY,
    ).toBe(true);

    await runtime.signet.stop().catch(() => {});
    runtime.keyManager.close();
    await rm(runtime.dataDir, { recursive: true, force: true });
  });
});
