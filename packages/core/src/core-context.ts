import { Result } from "better-result";
import { NotFoundError, type BrokerError } from "@xmtp-broker/schemas";
import type { ClientRegistry } from "./client-registry.js";
import type { SqliteIdentityStore } from "./identity-store.js";
import type { XmtpGroupInfo } from "./xmtp-client-factory.js";

/**
 * Sealed interface for performing actions through the broker core.
 *
 * Delegates to the client registry to find the correct XMTP client
 * for each operation, and to the identity store for inbox ID lookups.
 * Never exposes the raw client, conversations, or signer.
 */
export class BrokerCoreContext {
  readonly #registry: ClientRegistry;
  readonly #identityStore: SqliteIdentityStore;

  constructor(registry: ClientRegistry, identityStore: SqliteIdentityStore) {
    this.#registry = registry;
    this.#identityStore = identityStore;
  }

  /** Send a message to a group. */
  async sendMessage(
    groupId: string,
    _contentType: string,
    content: unknown,
  ): Promise<Result<{ messageId: string }, BrokerError>> {
    const managed = this.#registry.getByGroupId(groupId);
    if (!managed) {
      return Result.err(NotFoundError.create("group", groupId));
    }
    const result = await managed.client.sendMessage(groupId, content);
    if (result.isErr()) return result;
    return Result.ok({ messageId: result.value });
  }

  /** Get group metadata. */
  async getGroupInfo(
    groupId: string,
  ): Promise<Result<XmtpGroupInfo, BrokerError>> {
    const managed = this.#registry.getByGroupId(groupId);
    if (!managed) {
      return Result.err(NotFoundError.create("group", groupId));
    }
    return managed.client.getGroupInfo(groupId);
  }

  /** List all groups the broker is a member of. */
  async listGroups(): Promise<Result<readonly XmtpGroupInfo[], BrokerError>> {
    const allGroups: XmtpGroupInfo[] = [];
    for (const managed of this.#registry.list()) {
      const result = await managed.client.listGroups();
      if (result.isErr()) return result;
      allGroups.push(...result.value);
    }
    return Result.ok(allGroups);
  }

  /** Add members to a group by inbox ID. */
  async addMembers(
    groupId: string,
    inboxIds: readonly string[],
  ): Promise<Result<void, BrokerError>> {
    const managed = this.#registry.getByGroupId(groupId);
    if (!managed) {
      return Result.err(NotFoundError.create("group", groupId));
    }
    return managed.client.addMembers(groupId, inboxIds);
  }

  /** Remove members from a group. */
  async removeMembers(
    groupId: string,
    inboxIds: readonly string[],
  ): Promise<Result<void, BrokerError>> {
    const managed = this.#registry.getByGroupId(groupId);
    if (!managed) {
      return Result.err(NotFoundError.create("group", groupId));
    }
    return managed.client.removeMembers(groupId, inboxIds);
  }

  /** Get the inbox ID for a given group's identity. */
  async getInboxId(groupId: string): Promise<Result<string, BrokerError>> {
    // Check the runtime registry first — shared-mode identities are
    // persisted with group_id = NULL, so the identity store lookup
    // would miss them. The registry is hydrated at startup.
    const managed = this.#registry.getByGroupId(groupId);
    if (managed) {
      return Result.ok(managed.inboxId);
    }

    // Fall back to persisted per-group identities.
    const identity = await this.#identityStore.getByGroupId(groupId);
    if (!identity) {
      return Result.err(NotFoundError.create("identity", groupId));
    }
    if (!identity.inboxId) {
      return Result.err(NotFoundError.create("inboxId", groupId));
    }
    return Result.ok(identity.inboxId);
  }

  /** Force a sync for a specific group. */
  async syncGroup(groupId: string): Promise<Result<void, BrokerError>> {
    const managed = this.#registry.getByGroupId(groupId);
    if (!managed) {
      return Result.err(NotFoundError.create("group", groupId));
    }
    return managed.client.syncGroup(groupId);
  }
}
