import { describe, test, expect } from "bun:test";
import { Result } from "better-result";
import { createRequestTracker } from "../request-tracker.js";
import { TimeoutError, InternalError } from "@xmtp/signet-schemas";

describe("RequestTracker", () => {
  test("resolves a tracked request with success", async () => {
    const tracker = createRequestTracker(5000);
    const promise = tracker.track("req_1");

    tracker.resolve("req_1", Result.ok({ messageId: "msg_1" }));

    const result = await promise;
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect((result.value as { messageId: string }).messageId).toBe("msg_1");
    }
  });

  test("resolves a tracked request with error", async () => {
    const tracker = createRequestTracker(5000);
    const promise = tracker.track("req_2");

    tracker.resolve(
      "req_2",
      Result.err(InternalError.create("Something went wrong")),
    );

    const result = await promise;
    expect(result.isErr()).toBe(true);
  });

  test("times out a pending request", async () => {
    const tracker = createRequestTracker(100);
    const result = await tracker.track("req_timeout");

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(TimeoutError);
    }
  });

  test("resolves multiple concurrent requests independently", async () => {
    const tracker = createRequestTracker(5000);
    const p1 = tracker.track("req_a");
    const p2 = tracker.track("req_b");

    tracker.resolve("req_b", Result.ok({ id: "b" }));
    tracker.resolve("req_a", Result.ok({ id: "a" }));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.isOk()).toBe(true);
    expect(r2.isOk()).toBe(true);
    if (r1.isOk() && r2.isOk()) {
      expect((r1.value as { id: string }).id).toBe("a");
      expect((r2.value as { id: string }).id).toBe("b");
    }
  });

  test("rejectAll rejects all pending requests", async () => {
    const tracker = createRequestTracker(5000);
    const p1 = tracker.track("req_c");
    const p2 = tracker.track("req_d");

    tracker.rejectAll(InternalError.create("Disconnected"));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.isErr()).toBe(true);
    expect(r2.isErr()).toBe(true);
  });

  test("tracks pending count", () => {
    const tracker = createRequestTracker(5000);
    expect(tracker.pending).toBe(0);

    tracker.track("req_e");
    tracker.track("req_f");
    expect(tracker.pending).toBe(2);

    tracker.resolve("req_e", Result.ok(null));
    expect(tracker.pending).toBe(1);
  });

  test("ignores resolve for unknown requestId", () => {
    const tracker = createRequestTracker(5000);
    // Should not throw
    tracker.resolve("unknown", Result.ok(null));
    expect(tracker.pending).toBe(0);
  });
});
