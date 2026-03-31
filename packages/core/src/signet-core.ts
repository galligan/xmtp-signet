import { Result } from "better-result";
import { InternalError, ValidationError } from "@xmtp/signet-schemas";
import type { SignetError } from "@xmtp/signet-schemas";
import type { SignetCoreConfig } from "./config.js";
import { CoreEventEmitter } from "./event-emitter.js";
import { SqliteIdentityStore } from "./identity-store.js";
import { ClientRegistry } from "./client-registry.js";
import { SignetCoreContext } from "./core-context.js";
import type { AgentIdentity } from "./identity-store.js";
import type { ManagedClient } from "./client-registry.js";
import type { RawEventHandler } from "./raw-events.js";
import type {
  SignerProviderLike,
  XmtpClientFactory,
  XmtpDecodedMessage,
  XmtpGroupEvent,
} from "./xmtp-client-factory.js";
import type {
  RegisterIdentityInput,
  RegisteredIdentity,
} from "./identity-registration.js";

/** Signet lifecycle states. */
export type SignetState =
  | "idle"
  | "local"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "error";

/**
 * Factory that produces a signer provider bound to a specific identity.
 * Each call must return a provider whose signing key corresponds to
 * the given identityId.
 */
export type SignerProviderFactory = (identityId: string) => SignerProviderLike;

/**
 * The core service managing the raw XMTP plane.
 *
 * Owns the lifecycle state machine, identity store, client registry,
 * heartbeat timer, and event emission. All XMTP client interactions
 * are delegated to the injected XmtpClientFactory.
 */
export class SignetCoreImpl {
  #state: SignetState = "idle";
  readonly #config: SignetCoreConfig;
  readonly #signerProviderFactory: SignerProviderFactory;
  readonly #clientFactory: XmtpClientFactory;
  readonly #emitter = new CoreEventEmitter();
  readonly #registry = new ClientRegistry();
  readonly #identityStore: SqliteIdentityStore;
  readonly #context: SignetCoreContext;
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  #livenessTimer: ReturnType<typeof setInterval> | null = null;
  #streams: Array<{ identityId: string; abort: () => void }> = [];

  constructor(
    config: SignetCoreConfig,
    signerProviderFactory: SignerProviderFactory,
    clientFactory: XmtpClientFactory,
  ) {
    this.#config = config;
    this.#signerProviderFactory = signerProviderFactory;
    this.#clientFactory = clientFactory;
    this.#identityStore = new SqliteIdentityStore(
      config.dataDir === ":memory:"
        ? ":memory:"
        : `${config.dataDir}/identities.db`,
    );
    this.#context = new SignetCoreContext(this.#registry, this.#identityStore);
  }

  /** Current lifecycle state. */
  get state(): SignetState {
    return this.#state;
  }

  /** Get the sealed context for performing actions. */
  get context(): SignetCoreContext {
    return this.#context;
  }

  /** The identity store (exposed for seeding in tests). */
  get identityStore(): SqliteIdentityStore {
    return this.#identityStore;
  }

  /** The core configuration (exposed for wiring conversation actions). */
  get config(): SignetCoreConfig {
    return this.#config;
  }

  /** Look up a managed client by identity ID. */
  getManagedClient(identityId: string): ManagedClient | undefined {
    return this.#registry.get(identityId);
  }

  /** Look up the managed client currently responsible for a group. */
  getManagedClientForGroup(groupId: string): ManagedClient | undefined {
    return this.#registry.getByGroupId(groupId);
  }

  /** Forget a single group binding from the in-memory registry. */
  forgetGroup(groupId: string): boolean {
    const managed = this.#registry.getByGroupId(groupId);
    if (!managed) {
      return false;
    }
    return managed.groupIds.delete(groupId);
  }

  /** Remove a managed client from the in-memory registry. */
  unregisterManagedClient(identityId: string): boolean {
    return this.#registry.unregister(identityId);
  }

  /** Subscribe to raw events. Returns an unsubscribe function. */
  on(handler: RawEventHandler): () => void {
    return this.#emitter.on(handler);
  }

  /**
   * Register a new managed inbox and hydrate it into the live runtime.
   *
   * When the core is already running, the inbox is connected immediately
   * so callers do not need to restart the daemon before using it.
   */
  async registerManagedIdentity(
    input: RegisterIdentityInput,
  ): Promise<Result<RegisteredIdentity, SignetError>> {
    if (this.#state !== "running" && this.#state !== "local") {
      return Result.err(
        ValidationError.create(
          "state",
          `Cannot register inbox from '${this.#state}' state (expected 'running' or 'local')`,
        ),
      );
    }

    const created = await this.#identityStore.create(
      input.groupId ?? null,
      input.label,
    );
    if (Result.isError(created)) {
      return created;
    }

    const hydrated = await this.#hydrateIdentity(created.value, {
      registerNetworkIdentity: true,
    });
    if (Result.isError(hydrated)) {
      await this.detachManagedIdentity(created.value.id);
      await this.#identityStore.remove(created.value.id);
      return hydrated;
    }

    const { privateKeyToAccount } = await import("viem/accounts");
    const signerProvider = this.#signerProviderFactory(created.value.id);
    const identityKey = await signerProvider.getXmtpIdentityKey(
      created.value.id,
    );
    if (Result.isError(identityKey)) {
      await this.detachManagedIdentity(created.value.id);
      await this.#identityStore.remove(created.value.id);
      return identityKey;
    }

    const account = privateKeyToAccount(identityKey.value);
    return Result.ok({
      identityId: created.value.id,
      inboxId: hydrated.value.inboxId,
      address: account.address,
      env: this.#config.env,
      label: input.label,
    });
  }

  /**
   * Detach a managed inbox from the live runtime without touching persistence.
   *
   * This is used by higher-level action cleanup to stop streams and remove the
   * in-memory client entry before deleting the persisted inbox record.
   */
  async detachManagedIdentity(
    identityId: string,
  ): Promise<Result<void, SignetError>> {
    const remaining: Array<{ identityId: string; abort: () => void }> = [];

    for (const stream of this.#streams) {
      if (stream.identityId === identityId) {
        stream.abort();
        continue;
      }
      remaining.push(stream);
    }

    this.#streams = remaining;
    this.#registry.unregister(identityId);
    return Result.ok(undefined);
  }

  /** Start the core: initialize clients, begin streaming. */
  async startLocal(): Promise<Result<void, SignetError>> {
    if (this.#state !== "idle") {
      return Result.err(
        ValidationError.create(
          "state",
          `Cannot initialize locally from '${this.#state}' state (expected 'idle')`,
        ),
      );
    }

    this.#state = "local";
    return Result.ok();
  }

  /** Start the core: initialize clients, begin streaming. */
  async start(): Promise<Result<void, SignetError>> {
    if (this.#state !== "idle" && this.#state !== "local") {
      return Result.err(
        ValidationError.create(
          "state",
          `Cannot start from '${this.#state}' state (expected 'idle' or 'local')`,
        ),
      );
    }

    const fallbackState = this.#state === "local" ? "local" : "error";
    this.#state = "starting";

    const failStart = <T extends SignetError>(error: T): Result<void, T> => {
      this.#resetStartupArtifacts();
      this.#state = fallbackState;
      return Result.err(error);
    };

    try {
      // Load existing identities and create clients
      const identities = await this.#identityStore.list();

      for (const identity of identities) {
        const hydrated = await this.#hydrateIdentity(identity, {
          registerNetworkIdentity: false,
        });
        if (Result.isError(hydrated)) {
          return failStart(hydrated.error);
        }
      }

      // Start heartbeat
      this.#startHeartbeat();

      this.#state = "running";

      // Emit started event
      this.#emitter.emit({
        type: "raw.core.started",
        identityCount: this.#registry.size,
        syncedThrough: new Date().toISOString(),
      });

      return Result.ok();
    } catch (cause) {
      return failStart(
        InternalError.create("Unexpected error during startup", {
          cause: String(cause),
        }),
      );
    }
  }

  /** Stop the core: close streams, disconnect clients. */
  async stop(): Promise<Result<void, SignetError>> {
    const previousState = this.#state;

    if (
      previousState !== "local" &&
      previousState !== "running" &&
      previousState !== "error"
    ) {
      return Result.err(
        ValidationError.create(
          "state",
          `Cannot stop from '${previousState}' state (expected 'local', 'running', or 'error')`,
        ),
      );
    }

    this.#state = "stopping";

    // Clear heartbeat
    this.#stopHeartbeat();

    // Abort all active streams
    for (const stream of this.#streams) {
      stream.abort();
    }
    this.#streams = [];

    // Emit stopped event only after full startup has occurred.
    if (previousState !== "local") {
      this.#emitter.emit({
        type: "raw.core.stopped",
        reason: "shutdown",
      });
    }

    // Clear registry and close identity store
    this.#registry.clear();
    this.#identityStore.close();

    this.#state = "stopped";

    return Result.ok();
  }

  /**
   * Consume messages from a stream and emit raw events.
   * Runs as a fire-and-forget async loop; errors are swallowed.
   *
   * Messages with sentAt before the stream start time are tagged as
   * historical (recovery sync). This lets the harness distinguish
   * catch-up context from live action triggers.
   */
  #consumeMessageStream(
    messages: AsyncIterable<XmtpDecodedMessage>,
    streamStartedAt?: string,
  ): void {
    const cutoffMs = streamStartedAt
      ? new Date(streamStartedAt).getTime()
      : Date.now();
    void (async () => {
      try {
        for await (const msg of messages) {
          this.#emitter.emit({
            type: "raw.message",
            messageId: msg.messageId,
            groupId: msg.groupId,
            senderInboxId: msg.senderInboxId,
            contentType: msg.contentType,
            content: msg.content,
            sentAt: msg.sentAt,
            threadId: msg.threadId,
            isHistorical: new Date(msg.sentAt).getTime() < cutoffMs,
          });
        }
      } catch {
        // Stream aborted or errored — expected during shutdown.
      }
    })();
  }

  /**
   * Consume group events from a stream and emit raw events.
   * Also registers newly joined groups in the client registry.
   * Runs as a fire-and-forget async loop; errors are swallowed.
   */
  #consumeGroupStream(
    identityId: string,
    groups: AsyncIterable<XmtpGroupEvent>,
  ): void {
    void (async () => {
      try {
        for await (const group of groups) {
          // Fix 2: Register newly streamed groups in the registry
          const managed = this.#registry.get(identityId);
          if (managed) {
            managed.groupIds.add(group.groupId);
          }

          this.#emitter.emit({
            type: "raw.group.joined",
            groupId: group.groupId,
            groupName: group.groupName,
          });
        }
      } catch {
        // Stream aborted or errored — expected during shutdown.
      }
    })();
  }

  async #hydrateIdentity(
    identity: AgentIdentity,
    options: { registerNetworkIdentity: boolean },
  ): Promise<Result<ManagedClient, SignetError>> {
    const signerProvider = this.#signerProviderFactory(identity.id);

    const dbEncKeyResult = await signerProvider.getDbEncryptionKey(identity.id);
    if (dbEncKeyResult.isErr()) {
      return Result.err(
        InternalError.create("Failed to get DB encryption key for identity"),
      );
    }

    const xmtpKeyResult = await signerProvider.getXmtpIdentityKey(identity.id);
    if (xmtpKeyResult.isErr()) {
      return Result.err(
        InternalError.create("Failed to get XMTP identity key for identity"),
      );
    }

    const clientResult = await this.#clientFactory.create({
      identityId: identity.id,
      dbPath:
        this.#config.dataDir === ":memory:"
          ? ":memory:"
          : `${this.#config.dataDir}/db/${this.#config.env}/${identity.id}.db3`,
      dbEncryptionKey: dbEncKeyResult.value,
      env: this.#config.env,
      appVersion: this.#config.appVersion,
      signerPrivateKey: xmtpKeyResult.value,
    });

    if (clientResult.isErr()) {
      return clientResult;
    }

    const client = clientResult.value;
    if (options.registerNetworkIdentity || identity.inboxId === null) {
      const setResult = await this.#identityStore.setInboxId(
        identity.id,
        client.inboxId,
      );
      if (Result.isError(setResult)) {
        return Result.err(
          InternalError.create("Failed to persist inbox ID", {
            identityId: identity.id,
            inboxId: client.inboxId,
          }),
        );
      }
    }

    const managedClient: ManagedClient = {
      identityId: identity.id,
      inboxId: client.inboxId,
      client,
      groupIds: new Set(identity.groupId ? [identity.groupId] : []),
    };

    if (this.#state === "running" || this.#state === "starting") {
      this.#registry.register(managedClient);

      const syncResult = await client.syncAll();
      if (syncResult.isErr()) {
        return syncResult;
      }

      const groupsResult = await client.listGroups();
      if (groupsResult.isErr()) {
        return groupsResult;
      }
      for (const group of groupsResult.value) {
        managedClient.groupIds.add(group.groupId);
      }

      const msgStreamResult = await client.streamAllMessages();
      if (msgStreamResult.isErr()) {
        return msgStreamResult;
      }
      const msgStream = msgStreamResult.value;
      this.#streams.push({
        identityId: identity.id,
        abort: msgStream.abort,
      });
      this.#consumeMessageStream(msgStream.messages, new Date().toISOString());

      const groupStreamResult = await client.streamGroups();
      if (groupStreamResult.isErr()) {
        return groupStreamResult;
      }
      const groupStream = groupStreamResult.value;
      this.#streams.push({
        identityId: identity.id,
        abort: groupStream.abort,
      });
      this.#consumeGroupStream(identity.id, groupStream.groups);
    }

    return Result.ok(managedClient);
  }

  #resetStartupArtifacts(): void {
    this.#stopHeartbeat();
    for (const stream of this.#streams) {
      stream.abort();
    }
    this.#streams = [];
    this.#registry.clear();
  }

  #startHeartbeat(): void {
    this.#heartbeatTimer = setInterval(() => {
      this.#emitter.emit({
        type: "raw.heartbeat",
        timestamp: new Date().toISOString(),
      });
    }, this.#config.heartbeatIntervalMs);

    // Liveness signal: published at a separate (typically slower) cadence
    // so group members can detect agent availability.
    this.#livenessTimer = setInterval(() => {
      this.#emitter.emit({
        type: "raw.liveness",
        timestamp: new Date().toISOString(),
        heartbeatIntervalSeconds: Math.round(
          this.#config.livenessIntervalMs / 1000,
        ),
      });
    }, this.#config.livenessIntervalMs);
  }

  #stopHeartbeat(): void {
    if (this.#heartbeatTimer !== null) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
    if (this.#livenessTimer !== null) {
      clearInterval(this.#livenessTimer);
      this.#livenessTimer = null;
    }
  }
}
