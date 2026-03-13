import { describe, expect, test } from "bun:test";
import { BackpressureTracker } from "../backpressure.js";

describe("BackpressureTracker", () => {
  test("starts at zero depth", () => {
    const bp = new BackpressureTracker(64, 256);
    expect(bp.depth).toBe(0);
    expect(bp.state).toBe("ok");
  });

  test("increment increases depth", () => {
    const bp = new BackpressureTracker(2, 4);
    bp.increment();
    expect(bp.depth).toBe(1);
    expect(bp.state).toBe("ok");
  });

  test("decrement decreases depth", () => {
    const bp = new BackpressureTracker(2, 4);
    bp.increment();
    bp.increment();
    bp.decrement();
    expect(bp.depth).toBe(1);
  });

  test("decrement does not go below zero", () => {
    const bp = new BackpressureTracker(2, 4);
    bp.decrement();
    expect(bp.depth).toBe(0);
  });

  test("returns warning state at soft limit", () => {
    const bp = new BackpressureTracker(2, 4);
    bp.increment();
    bp.increment();
    expect(bp.state).toBe("warning");
  });

  test("returns exceeded state at hard limit", () => {
    const bp = new BackpressureTracker(2, 4);
    bp.increment();
    bp.increment();
    bp.increment();
    bp.increment();
    expect(bp.state).toBe("exceeded");
  });

  test("transitions back from warning to ok on drain", () => {
    const bp = new BackpressureTracker(2, 4);
    bp.increment();
    bp.increment();
    expect(bp.state).toBe("warning");
    bp.decrement();
    expect(bp.state).toBe("ok");
  });

  test("notified flag tracks whether warning has been sent", () => {
    const bp = new BackpressureTracker(2, 4);
    expect(bp.notified).toBe(false);
    bp.markNotified();
    expect(bp.notified).toBe(true);
    bp.clearNotified();
    expect(bp.notified).toBe(false);
  });

  test("reset clears depth and notified", () => {
    const bp = new BackpressureTracker(2, 4);
    bp.increment();
    bp.increment();
    bp.markNotified();
    bp.reset();
    expect(bp.depth).toBe(0);
    expect(bp.notified).toBe(false);
    expect(bp.state).toBe("ok");
  });
});
