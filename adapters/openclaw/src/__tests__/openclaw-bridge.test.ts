import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Result } from "better-result";
import { InternalError, type SignetEvent } from "@xmtp/signet-schemas";
import { WS_CLOSE_CODES } from "@xmtp/signet-ws";
import { createOpenClawCheckpointStore } from "../bridge/index.js";
import { createOpenClawReadOnlyBridge } from "../bridge/index.js";

const tempDirs: string[] = [];
const TEST_CREDENTIAL_ID = "cred_0000000000000001";
const TEST_OPERATOR_ID = "op_0000000000000001";
const TEST_FINGERPRINT = `sha256:${"a".repeat(64)}`;

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      rm(dir, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

interface ReplayFrame {
  readonly seq: number;
  readonly event: SignetEvent;
}

function createReplayAwareServer(options?: {
  readonly initialFrames?: readonly ReplayFrame[];
  readonly closeAfterAuth?: {
    readonly code: number;
    readonly reason: string;
  };
  readonly closeOnOpenAttempt?: {
    readonly afterConnection: number;
    readonly code: number;
    readonly reason: string;
  };
}) {
  const frames: ReplayFrame[] = [...(options?.initialFrames ?? [])];
  let nextSeq =
    frames.length === 0 ? 1 : Math.max(...frames.map((frame) => frame.seq)) + 1;
  let connectionCount = 0;
  const connections = new Map<
    string,
    {
      ws: Bun.ServerWebSocket<{ connectionId: string }>;
      authenticated: boolean;
    }
  >();

  const server = Bun.serve({
    port: 0,
    fetch(req, bunServer) {
      const url = new URL(req.url);
      if (url.pathname !== "/v1/agent") {
        return new Response("not found", { status: 404 });
      }
      const connectionId = crypto.randomUUID();
      const upgraded = bunServer.upgrade(req, {
        data: { connectionId },
      });
      return upgraded
        ? undefined
        : new Response("upgrade failed", { status: 500 });
    },
    websocket: {
      open(ws) {
        connectionCount += 1;
        connections.set(ws.data.connectionId, {
          ws,
          authenticated: false,
        });
        if (
          options?.closeOnOpenAttempt &&
          connectionCount >= options.closeOnOpenAttempt.afterConnection
        ) {
          ws.close(
            options.closeOnOpenAttempt.code,
            options.closeOnOpenAttempt.reason,
          );
        }
      },
      message(ws, message) {
        const connection = connections.get(ws.data.connectionId);
        if (!connection) {
          return;
        }
        const data = JSON.parse(
          typeof message === "string" ? message : message.toString(),
        ) as {
          type: string;
          token?: string;
          lastSeenSeq?: number | null;
        };

        if (data.type !== "auth") {
          ws.close(4009, "Expected auth frame");
          return;
        }

        connection.authenticated = true;
        ws.send(
          JSON.stringify({
            type: "authenticated",
            connectionId: ws.data.connectionId,
            credential: {
              credentialId: TEST_CREDENTIAL_ID,
              operatorId: TEST_OPERATOR_ID,
              fingerprint: TEST_FINGERPRINT,
              issuedAt: "2026-04-18T00:00:00.000Z",
              expiresAt: "2026-04-19T00:00:00.000Z",
            },
            effectiveScopes: {
              allow: ["stream-messages"],
              deny: [],
            },
            resumedFromSeq: data.lastSeenSeq ?? null,
          }),
        );

        for (const frame of frames.filter(
          (candidate) => candidate.seq > (data.lastSeenSeq ?? 0),
        )) {
          ws.send(JSON.stringify(frame));
        }

        if (options?.closeAfterAuth) {
          ws.close(options.closeAfterAuth.code, options.closeAfterAuth.reason);
        }
      },
      close(ws) {
        connections.delete(ws.data.connectionId);
      },
    },
  });

  return {
    server,
    url: `ws://127.0.0.1:${server.port}/v1/agent`,
    emit(event: SignetEvent) {
      const frame: ReplayFrame = {
        seq: nextSeq,
        event,
      };
      nextSeq += 1;
      frames.push(frame);
      for (const connection of connections.values()) {
        if (connection.authenticated) {
          connection.ws.send(JSON.stringify(frame));
        }
      }
      return frame;
    },
    async stop() {
      for (const connection of connections.values()) {
        connection.ws.close(1001, "server stopping");
      }
      connections.clear();
      server.stop(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

async function nextDelivery<T>(stream: AsyncIterable<T>): Promise<T> {
  const iterator = stream[Symbol.asyncIterator]();
  const result = await iterator.next();
  if (result.done) {
    throw new Error("Expected delivery but stream completed");
  }
  return result.value;
}

async function expectToSettle(
  promise: Promise<unknown>,
  label: string,
): Promise<void> {
  await Promise.race([
    promise.then(() => undefined),
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${label} timed out`));
      }, 1_000);
    }),
  ]);
}

async function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs = 1_000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start >= timeoutMs) {
      throw new Error(`${label} timed out`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("OpenClaw read-only bridge", () => {
  test("delivers sequenced events and persists credential checkpoints", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-bridge-"));
    tempDirs.push(root);

    const mock = createReplayAwareServer();
    const bridge = createOpenClawReadOnlyBridge({
      adapter: "openclaw",
      credentialId: TEST_CREDENTIAL_ID,
      wsUrl: mock.url,
      token: "test-token",
      checkpointsDir: join(root, "checkpoints"),
      deliveryMode: "local",
      reconnect: {
        enabled: true,
        maxAttempts: 3,
        baseDelayMs: 10,
        maxDelayMs: 20,
        jitter: false,
      },
    });

    const startResult = await bridge.start();
    expect(startResult.isOk()).toBe(true);

    mock.emit({
      type: "heartbeat",
      credentialId: TEST_CREDENTIAL_ID,
      timestamp: "2026-04-18T00:00:00.000Z",
    });

    const delivery = await nextDelivery(bridge.deliveries);
    expect(delivery.dedupeKey).toBe(`${TEST_CREDENTIAL_ID}:1`);
    expect(delivery.event.type).toBe("heartbeat");
    expect(bridge.metrics.lastSeq).toBe(1);
    expect(bridge.metrics.deliveredCount).toBe(1);
    expect(bridge.metrics.checkpointPath).toContain(
      `${TEST_CREDENTIAL_ID}.json`,
    );

    await expectToSettle(bridge.stop(), "bridge.stop");
    await expectToSettle(mock.stop(), "mock.stop");
  });

  test("resumes from the last checkpoint and skips replayed duplicates", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-bridge-"));
    tempDirs.push(root);

    const firstServer = createReplayAwareServer();
    const firstBridge = createOpenClawReadOnlyBridge({
      adapter: "openclaw",
      credentialId: TEST_CREDENTIAL_ID,
      wsUrl: firstServer.url,
      token: "test-token",
      checkpointsDir: join(root, "checkpoints"),
      deliveryMode: "local",
      reconnect: {
        enabled: true,
        maxAttempts: 3,
        baseDelayMs: 10,
        maxDelayMs: 20,
        jitter: false,
      },
    });

    const firstStart = await firstBridge.start();
    expect(firstStart.isOk()).toBe(true);

    firstServer.emit({
      type: "heartbeat",
      credentialId: TEST_CREDENTIAL_ID,
      timestamp: "2026-04-18T00:00:00.000Z",
    });
    firstServer.emit({
      type: "heartbeat",
      credentialId: TEST_CREDENTIAL_ID,
      timestamp: "2026-04-18T00:00:01.000Z",
    });

    const firstDelivery = await nextDelivery(firstBridge.deliveries);
    const secondDelivery = await nextDelivery(firstBridge.deliveries);
    expect(firstDelivery.seq).toBe(1);
    expect(secondDelivery.seq).toBe(2);

    await expectToSettle(firstBridge.stop(), "firstBridge.stop");
    await expectToSettle(firstServer.stop(), "firstServer.stop");

    const secondServer = createReplayAwareServer({
      initialFrames: [
        {
          seq: 1,
          event: {
            type: "heartbeat",
            credentialId: TEST_CREDENTIAL_ID,
            timestamp: "2026-04-18T00:00:00.000Z",
          },
        },
        {
          seq: 2,
          event: {
            type: "heartbeat",
            credentialId: TEST_CREDENTIAL_ID,
            timestamp: "2026-04-18T00:00:01.000Z",
          },
        },
      ],
    });

    const secondBridge = createOpenClawReadOnlyBridge({
      adapter: "openclaw",
      credentialId: TEST_CREDENTIAL_ID,
      wsUrl: secondServer.url,
      token: "test-token",
      checkpointsDir: join(root, "checkpoints"),
      deliveryMode: "local",
      reconnect: {
        enabled: true,
        maxAttempts: 3,
        baseDelayMs: 10,
        maxDelayMs: 20,
        jitter: false,
      },
    });

    const secondStart = await secondBridge.start();
    expect(secondStart.isOk()).toBe(true);

    const freshFrame = secondServer.emit({
      type: "heartbeat",
      credentialId: TEST_CREDENTIAL_ID,
      timestamp: "2026-04-18T00:00:02.000Z",
    });

    const resumedDelivery = await nextDelivery(secondBridge.deliveries);
    expect(resumedDelivery.seq).toBe(freshFrame.seq);
    expect(secondBridge.metrics.dedupedCount).toBe(0);
    expect(secondBridge.metrics.lastSeq).toBe(3);

    await expectToSettle(secondBridge.stop(), "secondBridge.stop");
    await expectToSettle(secondServer.stop(), "secondServer.stop");
  });

  test("ignores checkpoints for other credentials when resuming", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-bridge-"));
    tempDirs.push(root);

    const store = createOpenClawCheckpointStore({
      checkpointsDir: join(root, "checkpoints"),
    });
    await store.save({
      credentialId: "cred_0000000000000002",
      lastSeq: 99,
      updatedAt: "2026-04-18T00:00:00.000Z",
    });

    const server = createReplayAwareServer({
      initialFrames: [
        {
          seq: 1,
          event: {
            type: "heartbeat",
            credentialId: TEST_CREDENTIAL_ID,
            timestamp: "2026-04-18T00:00:00.000Z",
          },
        },
      ],
    });

    const bridge = createOpenClawReadOnlyBridge({
      adapter: "openclaw",
      credentialId: TEST_CREDENTIAL_ID,
      wsUrl: server.url,
      token: "test-token",
      checkpointsDir: join(root, "checkpoints"),
      deliveryMode: "local",
      reconnect: {
        enabled: true,
        maxAttempts: 3,
        baseDelayMs: 10,
        maxDelayMs: 20,
        jitter: false,
      },
    });

    const startResult = await bridge.start();
    expect(startResult.isOk()).toBe(true);

    const delivery = await nextDelivery(bridge.deliveries);
    expect(delivery.seq).toBe(1);
    expect(bridge.metrics.dedupedCount).toBe(0);

    await expectToSettle(bridge.stop(), "bridge.stop");
    await expectToSettle(server.stop(), "server.stop");
  });

  test("stops the bridge when checkpoint persistence fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-bridge-"));
    tempDirs.push(root);

    const server = createReplayAwareServer();
    const bridge = createOpenClawReadOnlyBridge(
      {
        adapter: "openclaw",
        credentialId: TEST_CREDENTIAL_ID,
        wsUrl: server.url,
        token: "test-token",
        checkpointsDir: join(root, "checkpoints"),
        deliveryMode: "local",
        reconnect: {
          enabled: true,
          maxAttempts: 3,
          baseDelayMs: 10,
          maxDelayMs: 20,
          jitter: false,
        },
      },
      {
        checkpointStoreFactory(config) {
          const base = createOpenClawCheckpointStore(config);
          return {
            ...base,
            async save() {
              return Result.err(InternalError.create("disk full"));
            },
          };
        },
      },
    );

    const observedErrors: string[] = [];
    bridge.onError((error) => {
      observedErrors.push(error.message);
    });

    const startResult = await bridge.start();
    expect(startResult.isOk()).toBe(true);

    server.emit({
      type: "heartbeat",
      credentialId: TEST_CREDENTIAL_ID,
      timestamp: "2026-04-18T00:00:00.000Z",
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(bridge.state).toBe("closed");
    expect(bridge.metrics.deliveredCount).toBe(0);
    expect(
      observedErrors.some((message) => message.includes("disk full")),
    ).toBe(true);

    await expectToSettle(bridge.stop(), "bridge.stop");
    await expectToSettle(server.stop(), "server.stop");
  });

  test("closes without reconnecting on non-retryable signet close codes", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-bridge-"));
    tempDirs.push(root);

    const server = createReplayAwareServer({
      closeAfterAuth: {
        code: WS_CLOSE_CODES.AUTH_FAILED,
        reason: "Credential revoked",
      },
    });
    const bridge = createOpenClawReadOnlyBridge({
      adapter: "openclaw",
      credentialId: TEST_CREDENTIAL_ID,
      wsUrl: server.url,
      token: "test-token",
      checkpointsDir: join(root, "checkpoints"),
      deliveryMode: "local",
      reconnect: {
        enabled: true,
        maxAttempts: 3,
        baseDelayMs: 10,
        maxDelayMs: 20,
        jitter: false,
      },
    });

    const observedErrors: string[] = [];
    bridge.onError((error) => {
      observedErrors.push(error.message);
    });

    const startResult = await bridge.start();
    expect(startResult.isOk()).toBe(true);

    await waitFor(() => bridge.state === "closed", "bridge close");
    expect(bridge.metrics.reconnectCount).toBe(0);
    expect(observedErrors).toContain("Credential revoked");

    await expectToSettle(bridge.stop(), "bridge.stop");
    await expectToSettle(server.stop(), "server.stop");
  });

  test("closes cleanly when reconnect is disabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-bridge-"));
    tempDirs.push(root);

    const server = createReplayAwareServer({
      closeAfterAuth: {
        code: WS_CLOSE_CODES.NORMAL,
        reason: "signet restart",
      },
    });
    const bridge = createOpenClawReadOnlyBridge({
      adapter: "openclaw",
      credentialId: TEST_CREDENTIAL_ID,
      wsUrl: server.url,
      token: "test-token",
      checkpointsDir: join(root, "checkpoints"),
      deliveryMode: "local",
      reconnect: {
        enabled: false,
        maxAttempts: 3,
        baseDelayMs: 10,
        maxDelayMs: 20,
        jitter: false,
      },
    });

    const observedErrors: string[] = [];
    bridge.onError((error) => {
      observedErrors.push(error.message);
    });

    const startResult = await bridge.start();
    expect(startResult.isOk()).toBe(true);

    await waitFor(() => bridge.state === "closed", "bridge close");
    expect(observedErrors).toContain("OpenClaw bridge reconnect is disabled");
    expect(bridge.metrics.reconnectCount).toBe(0);

    await expectToSettle(bridge.stop(), "bridge.stop");
    await expectToSettle(server.stop(), "server.stop");
  });

  test("stops after exhausting retryable reconnect attempts", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-bridge-"));
    tempDirs.push(root);

    const server = createReplayAwareServer({
      closeAfterAuth: {
        code: WS_CLOSE_CODES.NORMAL,
        reason: "transient disconnect",
      },
      closeOnOpenAttempt: {
        afterConnection: 2,
        code: WS_CLOSE_CODES.NORMAL,
        reason: "retry auth never established",
      },
    });
    const bridge = createOpenClawReadOnlyBridge({
      adapter: "openclaw",
      credentialId: TEST_CREDENTIAL_ID,
      wsUrl: server.url,
      token: "test-token",
      checkpointsDir: join(root, "checkpoints"),
      deliveryMode: "local",
      reconnect: {
        enabled: true,
        maxAttempts: 1,
        baseDelayMs: 10,
        maxDelayMs: 20,
        jitter: false,
      },
    });

    const observedErrors: string[] = [];
    bridge.onError((error) => {
      observedErrors.push(error.message);
    });

    const startResult = await bridge.start();
    expect(startResult.isOk()).toBe(true);

    await waitFor(() => bridge.state === "closed", "bridge close");
    expect(bridge.metrics.reconnectCount).toBe(1);
    expect(observedErrors).toContain(
      "OpenClaw bridge exhausted reconnect attempts",
    );

    await expectToSettle(bridge.stop(), "bridge.stop");
    await expectToSettle(server.stop(), "server.stop");
  });
});
