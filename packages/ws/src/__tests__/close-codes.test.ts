import { describe, expect, test } from "bun:test";
import { WS_CLOSE_CODES } from "../close-codes.js";

describe("WS_CLOSE_CODES", () => {
  test("defines standard close codes", () => {
    expect(WS_CLOSE_CODES.NORMAL).toBe(1000);
    expect(WS_CLOSE_CODES.GOING_AWAY).toBe(1001);
  });

  test("defines custom close codes in 4000 range", () => {
    expect(WS_CLOSE_CODES.AUTH_FAILED).toBe(4001);
    expect(WS_CLOSE_CODES.AUTH_TIMEOUT).toBe(4002);
    expect(WS_CLOSE_CODES.SESSION_EXPIRED).toBe(4003);
    expect(WS_CLOSE_CODES.SESSION_REVOKED).toBe(4004);
    expect(WS_CLOSE_CODES.POLICY_CHANGE).toBe(4005);
    expect(WS_CLOSE_CODES.BACKPRESSURE).toBe(4008);
    expect(WS_CLOSE_CODES.PROTOCOL_ERROR).toBe(4009);
    expect(WS_CLOSE_CODES.DEAD_CONNECTION).toBe(4010);
  });

  test("defines rate limit close code (standard 1008)", () => {
    expect(WS_CLOSE_CODES.RATE_LIMITED).toBe(1008);
  });
});
