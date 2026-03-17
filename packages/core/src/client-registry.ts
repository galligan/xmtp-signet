import type { XmtpClient } from "./xmtp-client-factory.js";

/** Runtime state for a managed XMTP client. */
export interface ManagedClient {
  readonly identityId: string;
  readonly inboxId: string;
  readonly client: XmtpClient;
  /** Groups this client is responsible for. Mutable during runtime. */
  readonly groupIds: Set<string>;
}

/**
 * Ephemeral in-memory registry of active XMTP clients.
 *
 * Keyed by identity ID. Rebuilt from the IdentityStore and XMTP network
 * state on every signet startup. The IdentityStore is the durable source
 * of truth for which identities exist; this registry is the runtime source
 * of truth for active connections.
 */
export class ClientRegistry {
  readonly #clients = new Map<string, ManagedClient>();

  /** Register a managed client. Overwrites any existing entry. */
  register(managed: ManagedClient): void {
    this.#clients.set(managed.identityId, managed);
  }

  /** Get a managed client by identity ID. */
  get(identityId: string): ManagedClient | undefined {
    return this.#clients.get(identityId);
  }

  /** Get the managed client responsible for a given group. */
  getByGroupId(groupId: string): ManagedClient | undefined {
    for (const managed of this.#clients.values()) {
      if (managed.groupIds.has(groupId)) {
        return managed;
      }
    }
    return undefined;
  }

  /** Remove a managed client. Returns true if it existed. */
  unregister(identityId: string): boolean {
    return this.#clients.delete(identityId);
  }

  /** List all managed clients. */
  list(): readonly ManagedClient[] {
    return [...this.#clients.values()];
  }

  /** Number of registered clients. */
  get size(): number {
    return this.#clients.size;
  }

  /** Remove all clients. */
  clear(): void {
    this.#clients.clear();
  }
}
