import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SignetEvent } from "@xmtp/signet-schemas";
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
}) {
  const frames: ReplayFrame[] = [...(options?.initialFrames ?? [])];
  let nextSeq =
    frames.length === 0 ? 1 : Math.max(...frames.map((frame) => frame.seq)) + 1;
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
        connections.set(ws.data.connectionId, {
          ws,
          authenticated: false,
        });
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
      await server.stop(true);
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

describe("OpenClaw read-only bridge", () => {
  test("delivers sequenced events and persists credential checkpoints", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-bridge-"));
    tempDirs.push(root);

    const mock = createReplayAwareServer();
    const bridge = createOpenClawReadOnlyBridge({
      adapter: "openclaw",
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

    await bridge.stop();
    await mock.stop();
  });

  test("resumes from the last checkpoint and skips replayed duplicates", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-bridge-"));
    tempDirs.push(root);

    const firstServer = createReplayAwareServer();
    const firstBridge = createOpenClawReadOnlyBridge({
      adapter: "openclaw",
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

    await firstBridge.stop();
    await firstServer.stop();

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

    await secondBridge.stop();
    await secondServer.stop();
  });
});
