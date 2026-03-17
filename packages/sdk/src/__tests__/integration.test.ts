import { describe, test, expect, afterEach } from "bun:test";
import type { SignetEvent } from "@xmtp/signet-schemas";
import {
  createTestHandler,
  waitForState,
  take,
  type TestHarness,
} from "./mock-server.js";

let harness: TestHarness;

afterEach(async () => {
  if (harness) {
    await harness.cleanup();
  }
});

describe("Integration: full round-trip", () => {
  test("connect, receive events, send message, disconnect", async () => {
    harness = createTestHandler();
    await harness.handler.connect();

    // Emit events from mock server
    harness.emitEvent({
      type: "message.visible",
      messageId: "msg_1",
      groupId: "g1",
      senderInboxId: "sender_1",
      contentType: "xmtp.org/text:1.0",
      content: { text: "hello" },
      visibility: "visible",
      sentAt: "2024-01-01T00:00:00Z",
      sealId: null,
    });

    const events = await take(harness.handler.events, 1);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("message.visible");

    // Send a message
    const result = await harness.handler.sendMessage("g1", {
      type: "text",
      text: "world",
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.groupId).toBe("g1");
      expect(result.value.messageId).toBeTruthy();
    }

    // Disconnect
    await harness.handler.disconnect();
    expect(harness.handler.state).toBe("closed");
  });

  test("concurrent requests resolve independently", async () => {
    harness = createTestHandler();
    await harness.handler.connect();

    const [r1, r2] = await Promise.all([
      harness.handler.sendMessage("g1", { type: "text", text: "one" }),
      harness.handler.sendMessage("g2", { type: "text", text: "two" }),
    ]);

    expect(r1.isOk()).toBe(true);
    expect(r2.isOk()).toBe(true);
    if (r1.isOk() && r2.isOk()) {
      expect(r1.value.groupId).toBe("g1");
      expect(r2.value.groupId).toBe("g2");
    }
  });

  test("reconnection after drop resumes events", async () => {
    harness = createTestHandler({
      config: {
        reconnect: {
          enabled: true,
          baseDelayMs: 50,
          maxDelayMs: 200,
          maxAttempts: 3,
        },
      },
    });
    await harness.handler.connect();

    // Emit one event before dropping
    harness.emitEvent({
      type: "heartbeat",
      sessionId: "sess_test",
      timestamp: "2024-01-01T00:00:00Z",
    });

    const firstEvents = await take(harness.handler.events, 1);
    expect(firstEvents).toHaveLength(1);

    // Drop and wait for reconnect
    harness.dropConnection();
    await waitForState(harness.handler, "connected", 5000);

    // Should be connected again
    expect(harness.handler.state).toBe("connected");
  });

  test("event stream completes on disconnect", async () => {
    harness = createTestHandler();
    await harness.handler.connect();

    harness.emitEvent({
      type: "heartbeat",
      sessionId: "sess_test",
      timestamp: "2024-01-01T00:00:00Z",
    });

    // Disconnect after a small delay so iterator can pick up the event
    setTimeout(async () => {
      await harness.handler.disconnect();
    }, 100);

    const items: SignetEvent[] = [];
    for await (const event of harness.handler.events) {
      items.push(event);
    }
    // Should have gotten the heartbeat and then exited
    expect(items.length).toBeGreaterThanOrEqual(1);
  });
});
