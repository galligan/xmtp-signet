import { describe, expect, test, beforeEach } from "bun:test";
import { ConnectionRegistry } from "../connection-registry.js";
import type { ConnectionData } from "../connection-state.js";

/** Minimal mock of ServerWebSocket for registry tests. */
function mockWs(data: ConnectionData): {
  data: ConnectionData;
  send: (msg: string) => number;
} {
  return {
    data,
    send: (_msg: string) => 0,
  };
}

function makeData(overrides: Partial<ConnectionData> = {}): ConnectionData {
  return {
    connectionId: `conn_${Math.random().toString(36).slice(2, 8)}`,
    phase: "active",
    sessionId: "sess_default",
    agentInboxId: "agent_default",
    ...overrides,
  } as ConnectionData;
}

describe("ConnectionRegistry", () => {
  let registry: ConnectionRegistry;

  beforeEach(() => {
    registry = new ConnectionRegistry();
  });

  test("starts empty", () => {
    expect(registry.size).toBe(0);
  });

  test("add increments size", () => {
    const ws = mockWs(makeData());
    registry.add(ws as never);
    expect(registry.size).toBe(1);
  });

  test("remove decrements size", () => {
    const data = makeData();
    const ws = mockWs(data);
    registry.add(ws as never);
    registry.remove(data.connectionId);
    expect(registry.size).toBe(0);
  });

  test("remove is idempotent for unknown ID", () => {
    registry.remove("nonexistent");
    expect(registry.size).toBe(0);
  });

  test("getBySessionId returns matching connections", () => {
    const ws1 = mockWs(makeData({ sessionId: "sess_a" }));
    const ws2 = mockWs(makeData({ sessionId: "sess_a" }));
    const ws3 = mockWs(makeData({ sessionId: "sess_b" }));
    registry.add(ws1 as never);
    registry.add(ws2 as never);
    registry.add(ws3 as never);

    const result = registry.getBySessionId("sess_a");
    expect(result).toHaveLength(2);
  });

  test("getBySessionId returns empty for unknown session", () => {
    expect(registry.getBySessionId("nonexistent")).toHaveLength(0);
  });

  test("getByAgentInboxId returns matching connections", () => {
    const ws1 = mockWs(makeData({ agentInboxId: "agent_x" }));
    const ws2 = mockWs(makeData({ agentInboxId: "agent_y" }));
    registry.add(ws1 as never);
    registry.add(ws2 as never);

    const result = registry.getByAgentInboxId("agent_x");
    expect(result).toHaveLength(1);
  });

  test("getAll returns all connections", () => {
    const ws1 = mockWs(makeData());
    const ws2 = mockWs(makeData());
    registry.add(ws1 as never);
    registry.add(ws2 as never);
    expect(registry.getAll()).toHaveLength(2);
  });
});
