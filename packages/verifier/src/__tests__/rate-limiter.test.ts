import { describe, expect, test } from "bun:test";
import { createRateLimiter } from "../rate-limiter.js";

describe("createRateLimiter", () => {
  test("allows requests under the limit", () => {
    const limiter = createRateLimiter({
      maxRequests: 3,
      windowMs: 60_000,
    });

    expect(limiter.check("user-1")).toBe(true);
    expect(limiter.check("user-1")).toBe(true);
    expect(limiter.check("user-1")).toBe(true);
  });

  test("rejects requests over the limit", () => {
    const limiter = createRateLimiter({
      maxRequests: 2,
      windowMs: 60_000,
    });

    expect(limiter.check("user-1")).toBe(true);
    expect(limiter.check("user-1")).toBe(true);
    expect(limiter.check("user-1")).toBe(false);
  });

  test("tracks requesters independently", () => {
    const limiter = createRateLimiter({
      maxRequests: 1,
      windowMs: 60_000,
    });

    expect(limiter.check("user-1")).toBe(true);
    expect(limiter.check("user-2")).toBe(true);
    expect(limiter.check("user-1")).toBe(false);
    expect(limiter.check("user-2")).toBe(false);
  });

  test("sliding window evicts old entries", () => {
    let currentTime = 1_000_000;
    const limiter = createRateLimiter({
      maxRequests: 2,
      windowMs: 10_000,
      now: () => currentTime,
    });

    expect(limiter.check("user-1")).toBe(true); // t=1000000
    expect(limiter.check("user-1")).toBe(true); // t=1000000
    expect(limiter.check("user-1")).toBe(false); // at limit

    // Advance past window
    currentTime = 1_011_000;
    expect(limiter.check("user-1")).toBe(true); // old entries evicted
  });

  test("reset clears all state", () => {
    const limiter = createRateLimiter({
      maxRequests: 1,
      windowMs: 60_000,
    });

    expect(limiter.check("user-1")).toBe(true);
    expect(limiter.check("user-1")).toBe(false);

    limiter.reset();

    expect(limiter.check("user-1")).toBe(true);
  });

  test("partially expired entries are evicted correctly", () => {
    let currentTime = 0;
    const limiter = createRateLimiter({
      maxRequests: 3,
      windowMs: 10_000,
      now: () => currentTime,
    });

    // Fill up
    currentTime = 1000;
    expect(limiter.check("user-1")).toBe(true);
    currentTime = 5000;
    expect(limiter.check("user-1")).toBe(true);
    currentTime = 9000;
    expect(limiter.check("user-1")).toBe(true);
    expect(limiter.check("user-1")).toBe(false); // at limit

    // Advance so first entry expires but second doesn't
    currentTime = 12_000;
    expect(limiter.check("user-1")).toBe(true); // one slot freed
  });
});
