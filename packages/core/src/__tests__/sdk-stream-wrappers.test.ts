import { describe, expect, test } from "bun:test";
import { wrapMessageStream, wrapGroupStream } from "../sdk/stream-wrappers.js";
import {
  createMockAsyncStreamProxy,
  createMockDecodedMessage,
  createMockGroup,
} from "./sdk-fixtures.js";
import type {
  XmtpDecodedMessage,
  XmtpGroupEvent,
} from "../xmtp-client-factory.js";

describe("wrapMessageStream", () => {
  test("yields decoded messages mapped to broker types", async () => {
    const msgs = [
      createMockDecodedMessage({ id: "msg-1", conversationId: "g1" }),
      createMockDecodedMessage({ id: "msg-2", conversationId: "g2" }),
    ];
    const proxy = createMockAsyncStreamProxy(msgs);
    const stream = wrapMessageStream(proxy);

    const collected: XmtpDecodedMessage[] = [];
    for await (const msg of stream.messages) {
      collected.push(msg);
    }

    expect(collected).toHaveLength(2);
    expect(collected[0]!.messageId).toBe("msg-1");
    expect(collected[1]!.messageId).toBe("msg-2");
  });

  test("abort stops iteration", async () => {
    const msgs = [
      createMockDecodedMessage({ id: "msg-1" }),
      createMockDecodedMessage({ id: "msg-2" }),
      createMockDecodedMessage({ id: "msg-3" }),
    ];
    const proxy = createMockAsyncStreamProxy(msgs);
    const stream = wrapMessageStream(proxy);

    const collected: XmtpDecodedMessage[] = [];
    for await (const msg of stream.messages) {
      collected.push(msg);
      if (collected.length === 2) {
        stream.abort();
      }
    }

    expect(collected).toHaveLength(2);
  });

  test("handles empty stream", async () => {
    const proxy = createMockAsyncStreamProxy(
      [] as ReturnType<typeof createMockDecodedMessage>[],
    );
    const stream = wrapMessageStream(proxy);

    const collected: XmtpDecodedMessage[] = [];
    for await (const msg of stream.messages) {
      collected.push(msg);
    }

    expect(collected).toHaveLength(0);
  });
});

describe("wrapGroupStream", () => {
  test("yields group events mapped to broker types", async () => {
    const groups = [
      createMockGroup({ id: "g1", name: "Group 1" }),
      createMockGroup({ id: "g2", name: "Group 2" }),
    ];
    const proxy = createMockAsyncStreamProxy(groups);
    const stream = wrapGroupStream(proxy);

    const collected: XmtpGroupEvent[] = [];
    for await (const event of stream.groups) {
      collected.push(event);
    }

    expect(collected).toHaveLength(2);
    expect(collected[0]!.groupId).toBe("g1");
    expect(collected[0]!.groupName).toBe("Group 1");
  });

  test("abort stops group stream", async () => {
    const groups = [
      createMockGroup({ id: "g1", name: "Group 1" }),
      createMockGroup({ id: "g2", name: "Group 2" }),
      createMockGroup({ id: "g3", name: "Group 3" }),
    ];
    const proxy = createMockAsyncStreamProxy(groups);
    const stream = wrapGroupStream(proxy);

    const collected: XmtpGroupEvent[] = [];
    for await (const event of stream.groups) {
      collected.push(event);
      if (collected.length === 1) {
        stream.abort();
      }
    }

    expect(collected).toHaveLength(1);
  });
});
