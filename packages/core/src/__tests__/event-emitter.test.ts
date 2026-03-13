import { describe, expect, test } from "bun:test";
import { CoreEventEmitter } from "../event-emitter.js";
import type {
  CoreRawEvent,
  RawHeartbeatEvent,
  RawMessageEvent,
} from "../raw-events.js";

function makeHeartbeat(): RawHeartbeatEvent {
  return { type: "raw.heartbeat", timestamp: new Date().toISOString() };
}

function makeMessage(): RawMessageEvent {
  return {
    type: "raw.message",
    messageId: "msg-1",
    groupId: "group-1",
    senderInboxId: "inbox-1",
    contentType: "text",
    content: "hello",
    sentAt: new Date().toISOString(),
    isHistorical: false,
  };
}

describe("CoreEventEmitter", () => {
  test("delivers events to subscribers", () => {
    const emitter = new CoreEventEmitter();
    const received: CoreRawEvent[] = [];
    emitter.on((event) => received.push(event));

    const heartbeat = makeHeartbeat();
    emitter.emit(heartbeat);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(heartbeat);
  });

  test("delivers to multiple subscribers", () => {
    const emitter = new CoreEventEmitter();
    const a: CoreRawEvent[] = [];
    const b: CoreRawEvent[] = [];
    emitter.on((e) => a.push(e));
    emitter.on((e) => b.push(e));

    emitter.emit(makeHeartbeat());

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  test("unsubscribe stops delivery", () => {
    const emitter = new CoreEventEmitter();
    const received: CoreRawEvent[] = [];
    const unsub = emitter.on((e) => received.push(e));

    emitter.emit(makeHeartbeat());
    unsub();
    emitter.emit(makeHeartbeat());

    expect(received).toHaveLength(1);
  });

  test("double unsubscribe is safe", () => {
    const emitter = new CoreEventEmitter();
    const unsub = emitter.on(() => {});
    unsub();
    unsub(); // should not throw
  });

  test("subscriber error does not stop other subscribers", () => {
    const emitter = new CoreEventEmitter();
    const received: CoreRawEvent[] = [];

    emitter.on(() => {
      throw new Error("boom");
    });
    emitter.on((e) => received.push(e));

    emitter.emit(makeHeartbeat());

    expect(received).toHaveLength(1);
  });

  test("removeAll clears all subscribers", () => {
    const emitter = new CoreEventEmitter();
    const received: CoreRawEvent[] = [];
    emitter.on((e) => received.push(e));
    emitter.on((e) => received.push(e));

    emitter.removeAll();
    emitter.emit(makeHeartbeat());

    expect(received).toHaveLength(0);
  });

  test("listenerCount returns active subscriber count", () => {
    const emitter = new CoreEventEmitter();
    expect(emitter.listenerCount).toBe(0);

    const unsub1 = emitter.on(() => {});
    expect(emitter.listenerCount).toBe(1);

    const _unsub2 = emitter.on(() => {});
    expect(emitter.listenerCount).toBe(2);

    unsub1();
    expect(emitter.listenerCount).toBe(1);

    emitter.removeAll();
    expect(emitter.listenerCount).toBe(0);
  });

  test("delivers different event types", () => {
    const emitter = new CoreEventEmitter();
    const received: CoreRawEvent[] = [];
    emitter.on((e) => received.push(e));

    emitter.emit(makeMessage());
    emitter.emit(makeHeartbeat());

    expect(received).toHaveLength(2);
    expect(received[0]?.type).toBe("raw.message");
    expect(received[1]?.type).toBe("raw.heartbeat");
  });
});
