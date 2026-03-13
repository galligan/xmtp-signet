import { describe, expect, test } from "bun:test";
import { WsServerConfigSchema } from "../config.js";

describe("WsServerConfigSchema", () => {
  test("applies all defaults for empty object", () => {
    const result = WsServerConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.port).toBe(8393);
      expect(result.data.host).toBe("127.0.0.1");
      expect(result.data.heartbeatIntervalMs).toBe(30_000);
      expect(result.data.missedHeartbeatsBeforeDead).toBe(3);
      expect(result.data.authTimeoutMs).toBe(5_000);
      expect(result.data.requestTimeoutMs).toBe(30_000);
      expect(result.data.replayBufferSize).toBe(1_000);
      expect(result.data.sendBufferSoftLimit).toBe(64);
      expect(result.data.sendBufferHardLimit).toBe(256);
      expect(result.data.drainTimeoutMs).toBe(5_000);
      expect(result.data.maxFrameSizeBytes).toBe(1_048_576);
      expect(result.data.rateLimitWindowMs).toBe(1_000);
      expect(result.data.rateLimitMaxMessages).toBeNull();
    }
  });

  test("accepts custom values", () => {
    const result = WsServerConfigSchema.safeParse({
      port: 9000,
      host: "0.0.0.0",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.port).toBe(9000);
      expect(result.data.host).toBe("0.0.0.0");
    }
  });

  test("allows port 0 for random assignment", () => {
    const result = WsServerConfigSchema.safeParse({ port: 0 });
    expect(result.success).toBe(true);
  });

  test("rejects negative port", () => {
    const result = WsServerConfigSchema.safeParse({ port: -1 });
    expect(result.success).toBe(false);
  });

  test("rejects non-integer port", () => {
    const result = WsServerConfigSchema.safeParse({ port: 3.14 });
    expect(result.success).toBe(false);
  });

  test("rate limiting is disabled by default (null)", () => {
    const result = WsServerConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rateLimitMaxMessages).toBeNull();
    }
  });

  test("accepts rate limit configuration", () => {
    const result = WsServerConfigSchema.safeParse({
      rateLimitWindowMs: 2_000,
      rateLimitMaxMessages: 50,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rateLimitWindowMs).toBe(2_000);
      expect(result.data.rateLimitMaxMessages).toBe(50);
    }
  });

  test("rejects non-positive rateLimitWindowMs", () => {
    const result = WsServerConfigSchema.safeParse({ rateLimitWindowMs: 0 });
    expect(result.success).toBe(false);
  });

  test("rejects non-positive rateLimitMaxMessages", () => {
    const result = WsServerConfigSchema.safeParse({ rateLimitMaxMessages: 0 });
    expect(result.success).toBe(false);
  });
});
