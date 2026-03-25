/**
 * Full happy-path integration tests.
 *
 * End-to-end flow: init keys -> create signet -> issue credential ->
 * start WS -> connect -> auth -> receive events -> send messages -> replay.
 */

import { describe, test, expect, afterEach } from "bun:test";
import {
  createTestRuntime,
  issueTestCredential,
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

  test("credential issuance returns valid token and record", async () => {
    const result = await createTestRuntime();
    cleanup = result.cleanup;
    const { runtime } = result;

    const { token, credentialId } = await issueTestCredential(runtime);

    expect(token).toBeTruthy();
    expect(credentialId).toBeTruthy();

    const credential =
      runtime.credentialManager.getCredentialById(credentialId);
    expect(credential.isOk()).toBe(true);
    if (!credential.isOk()) return;
    expect(credential.value.status).toBe("active");
    expect(credential.value.chatIds).toEqual([runtime.groupId]);
    expect(credential.value.effectiveScopes.allow).toContain("read-messages");
  });

  test("websocket connect and auth returns authenticated frame", async () => {
    const result = await createTestRuntime();
    cleanup = result.cleanup;
    const { runtime } = result;

    const { token, credentialId } = await issueTestCredential(runtime);
    const { client, authFrame } = await connectAndAuth(runtime.wsPort, token);

    expect(authFrame["type"]).toBe("authenticated");
    expect(authFrame["connectionId"]).toBeTruthy();
    expect(authFrame["resumedFromSeq"]).toBeNull();
    expect(authFrame["effectiveScopes"]).toBeTruthy();

    const credential = authFrame["credential"] as Record<string, unknown>;
    expect(credential["credentialId"]).toBe(credentialId);
    expect(credential["operatorId"]).toBe(runtime.operatorId);

    await client.close();
  });

  test("broadcast event arrives as sequenced frame", async () => {
    const result = await createTestRuntime();
    cleanup = result.cleanup;
    const { runtime } = result;

    const { token, credentialId } = await issueTestCredential(runtime);
    const { client } = await connectAndAuth(runtime.wsPort, token);

    runtime.wsServer.broadcast(credentialId, {
      type: "message.visible",
      messageId: "msg_1234abcdfeedbabe",
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
    expect(event["messageId"]).toBe("msg_1234abcdfeedbabe");

    await client.close();
  });

  test("send_message request succeeds when scope allows", async () => {
    const result = await createTestRuntime();
    cleanup = result.cleanup;
    const { runtime } = result;

    const { token } = await issueTestCredential(runtime);
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

  test("heartbeat request succeeds and updates credential", async () => {
    const result = await createTestRuntime();
    cleanup = result.cleanup;
    const { runtime } = result;

    const { token, credentialId } = await issueTestCredential(runtime);
    const before = runtime.credentialManager.getCredentialById(credentialId);
    expect(before.isOk()).toBe(true);
    if (!before.isOk()) return;

    const { client } = await connectAndAuth(runtime.wsPort, token);
    await new Promise((resolve) => setTimeout(resolve, 10));

    client.send({
      type: "heartbeat",
      requestId: "req-hb-1",
      credentialId,
    });

    const response = (await client.nextMessage()) as Record<string, unknown>;
    expect(response["ok"]).toBe(true);
    expect(response["requestId"]).toBe("req-hb-1");

    const after = runtime.credentialManager.getCredentialById(credentialId);
    expect(after.isOk()).toBe(true);
    if (!after.isOk()) return;
    expect(after.value.lastHeartbeat).not.toBe(before.value.lastHeartbeat);

    await client.close();
  });

  test("reconnect with lastSeenSeq replays missed events", async () => {
    const result = await createTestRuntime({
      wsConfig: { replayBufferSize: 50 },
    });
    cleanup = result.cleanup;
    const { runtime } = result;

    const { token, credentialId } = await issueTestCredential(runtime);

    const { client: c1 } = await connectAndAuth(runtime.wsPort, token);

    for (let i = 0; i < 3; i++) {
      runtime.wsServer.broadcast(credentialId, {
        type: "heartbeat",
        credentialId,
        timestamp: new Date().toISOString(),
      });
    }

    const events: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 3; i++) {
      events.push((await c1.nextMessage()) as Record<string, unknown>);
    }
    expect(events[0]!["seq"]).toBe(1);
    expect(events[1]!["seq"]).toBe(2);
    expect(events[2]!["seq"]).toBe(3);

    await c1.close();

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

  test("full end-to-end: keys -> signet -> credential -> ws -> seal -> request", async () => {
    const result = await createTestRuntime();
    cleanup = result.cleanup;
    const { runtime } = result;

    expect(["software-vault", "secure-enclave"]).toContain(
      runtime.keyManager.platform,
    );
    expect(runtime.signet.state).toBe("running");
    expect(runtime.wsServer.state).toBe("listening");

    const { token, credentialId } = await issueTestCredential(runtime);

    const { client, authFrame } = await connectAndAuth(runtime.wsPort, token);
    expect(authFrame["type"]).toBe("authenticated");

    const sealResult = await runtime.sealManager.issue(
      credentialId,
      runtime.groupId,
    );
    expect(sealResult.isOk()).toBe(true);
    if (!sealResult.isOk()) return;
    expect(sealResult.value.chain.current.credentialId).toBe(credentialId);
    expect(sealResult.value.chain.current.operatorId).toBe(runtime.operatorId);
    expect(sealResult.value.chain.current.chatId).toBe(runtime.groupId);
    expect(runtime.publisher.published.length).toBeGreaterThan(0);

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

  test("multiple concurrent credentials for the same operator", async () => {
    const result = await createTestRuntime({
      credentialManagerConfig: { maxConcurrentPerOperator: 3 },
    });
    cleanup = result.cleanup;
    const { runtime } = result;

    const credentials = [];
    for (let i = 0; i < 3; i++) {
      credentials.push(
        await issueTestCredential(runtime, {
          chatIds: [`conv_0000000${i}`],
        }),
      );
    }

    expect(credentials.length).toBe(3);

    const active = runtime.credentialManager.getActiveCredentials(
      runtime.operatorId,
    );
    expect(active.length).toBe(3);
  });
});
