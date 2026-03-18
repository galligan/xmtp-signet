import { describe, test, expect } from "bun:test";
import { createEventStream } from "../event-stream.js";
import type { SignetEvent } from "@xmtp/signet-schemas";
import { take } from "./mock-server.js";

function makeEvent(text: string): SignetEvent {
  return {
    type: "message.visible",
    messageId: `msg_${text}`,
    groupId: "g1",
    senderInboxId: "sender_1",
    contentType: "xmtp.org/text:1.0",
    content: { text },
    visibility: "visible",
    sentAt: "2024-01-01T00:00:00Z",
    sealId: null,
    threadId: null,
  };
}

describe("EventStream", () => {
  test("delivers pushed events via async iteration", async () => {
    const stream = createEventStream();
    stream.push(makeEvent("hello"));
    stream.push(makeEvent("world"));

    const items = await take(stream, 2);
    expect(items).toHaveLength(2);
    expect(items[0]?.type).toBe("message.visible");
    expect(items[1]?.type).toBe("message.visible");
  });

  test("delivers events in order", async () => {
    const stream = createEventStream();
    stream.push(makeEvent("first"));
    stream.push(makeEvent("second"));
    stream.push(makeEvent("third"));

    const items = await take(stream, 3);
    expect((items[0] as { messageId: string }).messageId).toBe("msg_first");
    expect((items[1] as { messageId: string }).messageId).toBe("msg_second");
    expect((items[2] as { messageId: string }).messageId).toBe("msg_third");
  });

  test("completes the async iterable on complete()", async () => {
    const stream = createEventStream();
    stream.push(makeEvent("one"));
    stream.complete();

    const items: SignetEvent[] = [];
    for await (const item of stream) {
      items.push(item);
    }
    expect(items).toHaveLength(1);
  });

  test("waits for events when queue is empty", async () => {
    const stream = createEventStream();

    // Push after a delay
    setTimeout(() => {
      stream.push(makeEvent("delayed"));
    }, 50);

    const items = await take(stream, 1);
    expect(items).toHaveLength(1);
    expect((items[0] as { messageId: string }).messageId).toBe("msg_delayed");
  });
});
