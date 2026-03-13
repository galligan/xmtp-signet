import { describe, expect, test } from "bun:test";
import {
  type ConnectionPhase,
  createConnectionState,
  canTransition,
  transition,
} from "../connection-state.js";

describe("createConnectionState", () => {
  test("creates state in authenticating phase", () => {
    const state = createConnectionState();
    expect(state.phase).toBe("authenticating");
    expect(state.connectionId).toBeTruthy();
    expect(state.sessionRecord).toBeNull();
    expect(state.sessionReplayState).toBeNull();
    expect(state.inFlightRequests.size).toBe(0);
  });

  test("generates unique connection IDs", () => {
    const a = createConnectionState();
    const b = createConnectionState();
    expect(a.connectionId).not.toBe(b.connectionId);
  });
});

describe("canTransition", () => {
  const valid: Array<[ConnectionPhase, ConnectionPhase]> = [
    ["authenticating", "active"],
    ["authenticating", "closed"],
    ["active", "draining"],
    ["active", "closed"],
    ["draining", "closed"],
  ];

  for (const [from, to] of valid) {
    test(`allows ${from} -> ${to}`, () => {
      expect(canTransition(from, to)).toBe(true);
    });
  }

  const invalid: Array<[ConnectionPhase, ConnectionPhase]> = [
    ["authenticating", "draining"],
    ["active", "authenticating"],
    ["draining", "active"],
    ["draining", "authenticating"],
    ["closed", "authenticating"],
    ["closed", "active"],
    ["closed", "draining"],
  ];

  for (const [from, to] of invalid) {
    test(`rejects ${from} -> ${to}`, () => {
      expect(canTransition(from, to)).toBe(false);
    });
  }
});

describe("transition", () => {
  test("transitions from authenticating to active", () => {
    const state = createConnectionState();
    const result = transition(state, "active");
    expect(result).toBe(true);
    expect(state.phase).toBe("active");
  });

  test("rejects invalid transition and keeps current phase", () => {
    const state = createConnectionState();
    const result = transition(state, "draining");
    expect(result).toBe(false);
    expect(state.phase).toBe("authenticating");
  });

  test("transitions active -> draining -> closed", () => {
    const state = createConnectionState();
    transition(state, "active");
    expect(transition(state, "draining")).toBe(true);
    expect(state.phase).toBe("draining");
    expect(transition(state, "closed")).toBe(true);
    expect(state.phase).toBe("closed");
  });
});
