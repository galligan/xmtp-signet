import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "./connection-state.js";

/**
 * Tracks authenticated WebSocket connections.
 * Provides lookups by connection ID, session ID, and agent inbox ID.
 */
export class ConnectionRegistry {
  private readonly connections = new Map<
    string,
    ServerWebSocket<ConnectionData>
  >();

  get size(): number {
    return this.connections.size;
  }

  add(ws: ServerWebSocket<ConnectionData>): void {
    this.connections.set(ws.data.connectionId, ws);
  }

  remove(connectionId: string): void {
    this.connections.delete(connectionId);
  }

  get(connectionId: string): ServerWebSocket<ConnectionData> | undefined {
    return this.connections.get(connectionId);
  }

  getBySessionId(
    sessionId: string,
  ): readonly ServerWebSocket<ConnectionData>[] {
    const result: ServerWebSocket<ConnectionData>[] = [];
    for (const ws of this.connections.values()) {
      if (ws.data.sessionId === sessionId) {
        result.push(ws);
      }
    }
    return result;
  }

  getByAgentInboxId(
    agentInboxId: string,
  ): readonly ServerWebSocket<ConnectionData>[] {
    const result: ServerWebSocket<ConnectionData>[] = [];
    for (const ws of this.connections.values()) {
      if (ws.data.agentInboxId === agentInboxId) {
        result.push(ws);
      }
    }
    return result;
  }

  getAll(): readonly ServerWebSocket<ConnectionData>[] {
    return Array.from(this.connections.values());
  }
}
