import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "./connection-state.js";

/**
 * Tracks authenticated WebSocket connections.
 * Provides lookups by connection ID, credential ID, and operator ID.
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

  getByCredentialId(
    credentialId: string,
  ): readonly ServerWebSocket<ConnectionData>[] {
    const result: ServerWebSocket<ConnectionData>[] = [];
    for (const ws of this.connections.values()) {
      if (ws.data.credentialId === credentialId) {
        result.push(ws);
      }
    }
    return result;
  }

  getByOperatorId(
    operatorId: string,
  ): readonly ServerWebSocket<ConnectionData>[] {
    const result: ServerWebSocket<ConnectionData>[] = [];
    for (const ws of this.connections.values()) {
      if (ws.data.operatorId === operatorId) {
        result.push(ws);
      }
    }
    return result;
  }

  getAll(): readonly ServerWebSocket<ConnectionData>[] {
    return Array.from(this.connections.values());
  }
}
