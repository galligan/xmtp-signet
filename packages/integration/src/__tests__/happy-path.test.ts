/**
 * Full happy-path integration tests.
 *
 * End-to-end flow: init keys -> create signet -> issue session ->
 * start WS -> connect -> auth -> receive events -> send messages -> replay.
 */

import { describe, test, expect, afterEach } from "bun:test";
import {
  createTestRuntime,
  issueTestSession,
  createTestViewAndGrant,
} from "../fixtures/test-runtime.js";
import { connectAndAuth } from "../fixtures/test-ws-client.js";

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanup) {
    await cleanup();
    cleanup = null;
  }
});

describe("happy-path", () => {
  test("key manager initializes with root and operational keys", async () => {
    const result = await createTestRuntime();
    cleanup = result.cleanup;
    const { runtime } = result;

    expect(["software-vault", "secure-enclave"]).toContain(
      runtime.keyManager.platform,
    );

    // Operational key exists for the seeded identity
    const opKey = runtime.keyManager.getOperationalKey(runtime.identityId);
    expect(opKey.isOk()).toBe(true);
    if (!opKey.isOk()) return;
    expect(opKey.value.identityId).toBe(runtime.identityId);
    expect(opKey.value.groupId).toBe(runtime.groupId);
  });

  test("signet starts and transitions to running state", async () => {
    const result = await createTestRuntime();
    cleanup = result.cleanup;
    const { runtime } = result;

    expect(runtime.signet.state).toBe("running");
    expect(runtime.wsServer.state).toBe("listening");
  });

  test("session issuance returns valid token and record", async () => {
    const result = await createTestRuntime();
    cleanup = result.cleanup;
    const { runtime } = result;

    const { token, sessionId } = await issueTestSession(runtime);

    expect(token).toBeTruthy();
    expect(sessionId).toBeTruthy();

    // Session is retrievable
    const session = runtime.sessionManager.getSessionById(sessionId);
    expect(session.isOk()).toBe(true);
    if (!session.isOk()) return;
    expect(session.value.state).toBe("active");
    expect(session.value.view.mode).toBe("full");
  });

  test("websocket connect and auth returns authenticated frame", async () => {
    const result = await createTestRuntime();
    cleanup = result.cleanup;
    const { runtime } = result;

    const { token } = await issueTestSession(runtime);
    const { client, authFrame } = await connectAndAuth(runtime.wsPort, token);

    expect(authFrame["type"]).toBe("authenticated");
    expect(authFrame["connectionId"]).toBeTruthy();
    expect(authFrame["session"]).toBeTruthy();
    expect(authFrame["view"]).toBeTruthy();
    expect(authFrame["grant"]).toBeTruthy();
    expect(authFrame["resumedFromSeq"]).toBeNull();

    const session = authFrame["session"] as Record<string, unknown>;
    expect(session["agentInboxId"]).toBeTruthy();

    await client.close();
  });

  test("broadcast event arrives as sequenced frame", async () => {
    const result = await createTestRuntime();
    cleanup = result.cleanup;
    const { runtime } = result;

    const { token, sessionId } = await issueTestSession(runtime);
    const { client } = await connectAndAuth(runtime.wsPort, token);

    // Broadcast an event through the WS server
    runtime.wsServer.broadcast(sessionId, {
      type: "message.visible",
      messageId: "msg-1",
      groupId: runtime.groupId,
      senderInboxId: "sender-1",
      contentType: "xmtp.org/text:1.0",
      content: { text: "hello from broadcast" },
      visibility: "visible",
      sentAt: new Date().toISOString(),
      sealId: null,
      threadId: null,
    });

    const frame = (await client.nextMessage()) as Record<string, unknown>;
    expect(frame["seq"]).toBe(1);
    const event = frame["event"] as Record<string, unknown>;
    expect(event["type"]).toBe("message.visible");
    expect(event["messageId"]).toBe("msg-1");

    await client.close();
  });

  test("send_message request succeeds when grant allows", async () => {
    const result = await createTestRuntime();
    cleanup = result.cleanup;
    const { runtime } = result;

    const { token } = await issueTestSession(runtime);
    const { client } = await connectAndAuth(runtime.wsPort, token);

    client.send({
      type: "send_message",
      requestId: "req-send-1",
      groupId: runtime.groupId,
      contentType: "xmtp.org/text:1.0",
      content: { text: "hello" },
    });

    const response = (await client.nextMessage()) as Record<string, unknown>;
    expect(response["ok"]).toBe(true);
    expect(response["requestId"]).toBe("req-send-1");
    expect(
      (response["data"] as Record<string, unknown>)?.["messageId"],
    ).toBeTruthy();

    await client.close();
  });

  test("heartbeat request succeeds and updates session", async () => {
    const result = await createTestRuntime();
    cleanup = result.cleanup;
    const { runtime } = result;

    const { token, sessionId } = await issueTestSession(runtime);
    const { client } = await connectAndAuth(runtime.wsPort, token);

    client.send({
      type: "heartbeat",
      requestId: "req-hb-1",
      sessionId,
    });

    const response = (await client.nextMessage()) as Record<string, unknown>;
    expect(response["ok"]).toBe(true);
    expect(response["requestId"]).toBe("req-hb-1");

    await client.close();
  });

  test("reconnect with lastSeenSeq replays missed events", async () => {
    const result = await createTestRuntime({
      wsConfig: { replayBufferSize: 50 },
    });
    cleanup = result.cleanup;
    const { runtime } = result;

    const { token, sessionId } = await issueTestSession(runtime);

    // First connection
    const { client: c1 } = await connectAndAuth(runtime.wsPort, token);

    // Send 3 events
    for (let i = 0; i < 3; i++) {
      runtime.wsServer.broadcast(sessionId, {
        type: "heartbeat",
        sessionId,
        timestamp: new Date().toISOString(),
      });
    }

    // Consume all 3
    const events: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 3; i++) {
      events.push((await c1.nextMessage()) as Record<string, unknown>);
    }
    expect(events[0]!["seq"]).toBe(1);
    expect(events[1]!["seq"]).toBe(2);
    expect(events[2]!["seq"]).toBe(3);

    // Disconnect
    await c1.close();

    // Reconnect with lastSeenSeq = 1 (should replay 2 and 3)
    const { client: c2, authFrame } = await connectAndAuth(
      runtime.wsPort,
      token,
      1,
    );
    expect(authFrame["resumedFromSeq"]).toBe(1);

    const replayed1 = (await c2.nextMessage()) as Record<string, unknown>;
    const replayed2 = (await c2.nextMessage()) as Record<string, unknown>;
    expect(replayed1["seq"]).toBe(2);
    expect(replayed2["seq"]).toBe(3);

    await c2.close();
  });

  test("full end-to-end: keys -> signet -> session -> ws -> event -> request", async () => {
    const result = await createTestRuntime();
    cleanup = result.cleanup;
    const { runtime } = result;

    // Verify the full chain is wired
    expect(["software-vault", "secure-enclave"]).toContain(
      runtime.keyManager.platform,
    );
    expect(runtime.signet.state).toBe("running");
    expect(runtime.wsServer.state).toBe("listening");

    // Issue session
    const { token, sessionId } = await issueTestSession(runtime);

    // Connect and authenticate
    const { client, authFrame } = await connectAndAuth(runtime.wsPort, token);
    expect(authFrame["type"]).toBe("authenticated");

    // Issue seal for this session
    const attestResult = await runtime.sealManager.issue(
      sessionId,
      runtime.groupId,
    );
    expect(attestResult.isOk()).toBe(true);
    if (!attestResult.isOk()) return;
    expect(attestResult.value.seal.agentInboxId).toBeTruthy();
    expect(runtime.publisher.published.length).toBeGreaterThan(0);

    // Send a message request
    client.send({
      type: "send_message",
      requestId: "req-e2e-1",
      groupId: runtime.groupId,
      contentType: "xmtp.org/text:1.0",
      content: { text: "end-to-end" },
    });

    const sendResponse = (await client.nextMessage()) as Record<
      string,
      unknown
    >;
    expect(sendResponse["ok"]).toBe(true);

    await client.close();
  });

  test("multiple concurrent sessions for same agent", async () => {
    const result = await createTestRuntime({
      sessionConfig: { maxConcurrentPerAgent: 3 },
    });
    cleanup = result.cleanup;
    const { runtime } = result;

    const agentId = `inbox_${runtime.identityId}`;

    // Create 3 sessions with different views
    const sessions = [];
    for (let i = 0; i < 3; i++) {
      const { view, grant } = createTestViewAndGrant();
      // Each session has a different content type list to avoid dedup
      const modifiedView = {
        ...view,
        contentTypes: [...view.contentTypes, `custom.org/type${i}:1.0`],
      };
      sessions.push(
        await issueTestSession(runtime, {
          agentInboxId: agentId,
          view: modifiedView,
          grant,
        }),
      );
    }

    expect(sessions.length).toBe(3);

    // All 3 should be active
    const active = runtime.sessionManager.getActiveSessions(agentId);
    expect(active.length).toBe(3);
  });
});
