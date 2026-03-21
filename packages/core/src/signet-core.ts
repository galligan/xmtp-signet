import { Result } from "better-result";
import { InternalError, ValidationError } from "@xmtp/signet-schemas";
import type { SignetError } from "@xmtp/signet-schemas";
import type { SignetCoreConfig } from "./config.js";
import { CoreEventEmitter } from "./event-emitter.js";
import { SqliteIdentityStore } from "./identity-store.js";
import { ClientRegistry } from "./client-registry.js";
import { SignetCoreContext } from "./core-context.js";
import type { ManagedClient } from "./client-registry.js";
import type { RawEventHandler } from "./raw-events.js";
import type {
  SignerProviderLike,
  XmtpClientFactory,
  XmtpDecodedMessage,
  XmtpGroupEvent,
} from "./xmtp-client-factory.js";

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
  #streams: Array<{ abort: () => void }> = [];

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

  /** Subscribe to raw events. Returns an unsubscribe function. */
  on(handler: RawEventHandler): () => void {
    return this.#emitter.on(handler);
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
        // Fix 1: Create a fresh signer provider per identity
        const signerProvider = this.#signerProviderFactory(identity.id);

        const dbEncKeyResult = await signerProvider.getDbEncryptionKey(
          identity.id,
        );
        if (dbEncKeyResult.isErr()) {
          return failStart(
            InternalError.create(
              "Failed to get DB encryption key for identity",
            ),
          );
        }

        const xmtpKeyResult = await signerProvider.getXmtpIdentityKey(
          identity.id,
        );
        if (xmtpKeyResult.isErr()) {
          return failStart(
            InternalError.create(
              "Failed to get XMTP identity key for identity",
            ),
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
          return failStart(clientResult.error);
        }

        const client = clientResult.value;
        const managedClient = {
          identityId: identity.id,
          inboxId: client.inboxId,
          client,
          groupIds: new Set(identity.groupId ? [identity.groupId] : []),
        };
        this.#registry.register(managedClient);

        // Update inboxId if not set
        if (!identity.inboxId) {
          await this.#identityStore.setInboxId(identity.id, client.inboxId);
        }

        // Fix 3: Check syncAll result — fail fast on error
        const syncResult = await client.syncAll();
        if (syncResult.isErr()) {
          return failStart(syncResult.error);
        }

        // Hydrate group membership from the XMTP client.
        // Fail startup if listGroups() errors — without hydration the
        // signet cannot route any group operations.
        const groupsResult = await client.listGroups();
        if (groupsResult.isErr()) {
          return failStart(groupsResult.error);
        }
        for (const group of groupsResult.value) {
          managedClient.groupIds.add(group.groupId);
        }

        const msgStreamResult = await client.streamAllMessages();
        if (msgStreamResult.isErr()) {
          return failStart(msgStreamResult.error);
        }
        const msgStream = msgStreamResult.value;
        this.#streams.push(msgStream);
        const streamStartedAt = new Date().toISOString();
        this.#consumeMessageStream(msgStream.messages, streamStartedAt);

        const groupStreamResult = await client.streamGroups();
        if (groupStreamResult.isErr()) {
          return failStart(groupStreamResult.error);
        }
        const groupStream = groupStreamResult.value;
        this.#streams.push(groupStream);
        this.#consumeGroupStream(identity.id, groupStream.groups);
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
  }

  #stopHeartbeat(): void {
    if (this.#heartbeatTimer !== null) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
  }
}
