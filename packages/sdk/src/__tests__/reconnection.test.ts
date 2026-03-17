import { describe, test, expect } from "bun:test";
import {
  calculateDelay,
  isRetryable,
  createReconnectionTracker,
} from "../reconnection.js";
import type { ReconnectConfig } from "../reconnection.js";

const DEFAULT_CONFIG: ReconnectConfig = {
  enabled: true,
  maxAttempts: 10,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  jitter: false,
};

describe("isRetryable", () => {
  test("returns false for non-retryable close codes", () => {
    expect(isRetryable(4001)).toBe(false); // auth failed
    expect(isRetryable(4002)).toBe(false); // auth timeout
    expect(isRetryable(4004)).toBe(false); // session revoked
    expect(isRetryable(4009)).toBe(false); // protocol error
  });

  test("returns true for retryable close codes", () => {
    expect(isRetryable(1001)).toBe(true); // going away
    expect(isRetryable(1006)).toBe(true); // abnormal closure
    expect(isRetryable(4003)).toBe(true); // session expired
    expect(isRetryable(4005)).toBe(true); // policy change
    expect(isRetryable(4008)).toBe(true); // backpressure
  });
});

describe("calculateDelay", () => {
  test("returns base delay for attempt 0", () => {
    expect(calculateDelay(0, DEFAULT_CONFIG)).toBe(1_000);
  });

  test("doubles delay each attempt", () => {
    expect(calculateDelay(1, DEFAULT_CONFIG)).toBe(2_000);
    expect(calculateDelay(2, DEFAULT_CONFIG)).toBe(4_000);
    expect(calculateDelay(3, DEFAULT_CONFIG)).toBe(8_000);
  });

  test("caps delay at maxDelayMs", () => {
    expect(calculateDelay(10, DEFAULT_CONFIG)).toBe(30_000);
    expect(calculateDelay(20, DEFAULT_CONFIG)).toBe(30_000);
  });

  test("applies jitter when enabled", () => {
    const config: ReconnectConfig = { ...DEFAULT_CONFIG, jitter: true };
    const delay = calculateDelay(3, config);
    // With jitter, delay should be between 0 and 8_000
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThanOrEqual(8_000);
  });
});

describe("ReconnectionTracker", () => {
  test("starts at attempt 0", () => {
    const tracker = createReconnectionTracker(DEFAULT_CONFIG);
    expect(tracker.attempt).toBe(0);
    expect(tracker.exhausted).toBe(false);
  });

  test("increments attempt on nextDelay", () => {
    const tracker = createReconnectionTracker(DEFAULT_CONFIG);
    tracker.nextDelay();
    expect(tracker.attempt).toBe(1);
    tracker.nextDelay();
    expect(tracker.attempt).toBe(2);
  });

  test("reports exhausted when max attempts exceeded", () => {
    const config: ReconnectConfig = { ...DEFAULT_CONFIG, maxAttempts: 2 };
    const tracker = createReconnectionTracker(config);
    tracker.nextDelay(); // attempt 1
    tracker.nextDelay(); // attempt 2
    expect(tracker.exhausted).toBe(true);
  });

  test("never exhausts when maxAttempts is 0 (unlimited)", () => {
    const config: ReconnectConfig = { ...DEFAULT_CONFIG, maxAttempts: 0 };
    const tracker = createReconnectionTracker(config);
    for (let i = 0; i < 100; i++) {
      tracker.nextDelay();
    }
    expect(tracker.exhausted).toBe(false);
  });

  test("resets attempt counter", () => {
    const tracker = createReconnectionTracker(DEFAULT_CONFIG);
    tracker.nextDelay();
    tracker.nextDelay();
    expect(tracker.attempt).toBe(2);
    tracker.reset();
    expect(tracker.attempt).toBe(0);
    expect(tracker.exhausted).toBe(false);
  });
});
