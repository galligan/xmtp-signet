# 03-broker-core

**Package:** `@xmtp-broker/core`
**Spec version:** 0.1.0

## Overview

The broker core owns the raw plane: the XMTP client, message sync, per-group identity keys, database management, and signer material. It is the only component that touches the real XMTP SDK. Everything above it -- policy engine, session manager, transports -- consumes a filtered event stream that the core emits.

The core's primary job is lifecycle management. It starts XMTP clients (one per agent identity), streams messages from the network, and emits typed raw events for downstream consumption. It never makes policy decisions about what an agent should see or do; that is the policy engine's job. The core is infrastructure: reliable, sealed, and observable.

Per-group identity is default-on. Following the convos-node-sdk pattern (ADR 002), each group conversation gets its own wallet key, database encryption key, and XMTP client instance. This provides maximum isolation: compromising one identity reveals nothing about others, and group membership lists never cross-contaminate. The feature is configurable -- simpler deployments can disable it and use a single identity across groups.

The core exposes a `BrokerCore` service with a start/stop lifecycle, an `EventEmitter`-style interface for raw events, and a context object that downstream consumers use to send messages or query state through the core's sealed boundary.

## Dependencies

**Imports:**
- `@xmtp/node-sdk` -- XMTP Client, Conversations, Group, Signer types
- `@xmtp-broker/contracts` -- `SignerProvider`, `RawEvent`, `CoreContext`, `BrokerCore`, `CoreState`, `GroupInfo` (canonical interface definitions)
- `@xmtp-broker/schemas` -- event schemas, error types, content type definitions
- `better-result` -- Result type for fallible operations
- `zod` -- runtime validation at the XMTP boundary

**Imported by:**
- `@xmtp-broker/policy` -- subscribes to raw events, uses core context for actions
- `@xmtp-broker/sessions` -- queries core for agent identity info
- `@xmtp-broker/attestations` -- uses core context to publish attestation messages
- `@xmtp-broker/ws` -- indirectly, through the policy/session layer

## Public Interfaces

> **Note:** The following interfaces are canonically defined in `@xmtp-broker/contracts`: `SignerProvider`, `RawEvent` (union), `CoreContext`, `GroupInfo`, `BrokerCore`, `CoreState`. This package implements them. The descriptions below document behavior and usage; the contracts package is the source of truth for the type signatures.

### Configuration

```typescript
import { z } from "zod";

const XmtpEnvSchema = z.enum([
  "local",
  "dev",
  "production",
]).describe("XMTP network environment");

const IdentityModeSchema = z.enum([
  "per-group",
  "shared",
]).describe("Whether each group gets a unique identity or shares one");

const BrokerCoreConfigSchema = z.object({
  dataDir: z.string().describe("Base directory for all broker data"),
  env: XmtpEnvSchema.default("dev")
    .describe("XMTP network environment"),
  identityMode: IdentityModeSchema.default("per-group")
    .describe("Identity isolation strategy"),
  heartbeatIntervalMs: z.number().int().positive().default(30_000)
    .describe("Heartbeat emission interval in milliseconds"),
  syncTimeoutMs: z.number().int().positive().default(30_000)
    .describe("Maximum time to wait for initial sync"),
  appVersion: z.string().default("xmtp-broker/0.1.0")
    .describe("App version string sent to XMTP network"),
}).describe("Broker core configuration");

type BrokerCoreConfig = z.infer<typeof BrokerCoreConfigSchema>;
```

### Identity Store

```typescript
/** Represents a single agent identity managed by the broker. */
interface AgentIdentity {
  /** Unique identifier for this identity (hex, 32 bytes). */
  readonly id: string;
  /** XMTP inbox ID, set after first client registration. */
  readonly inboxId: string | null;
  /** Group ID this identity is bound to, null if shared mode. */
  readonly groupId: string | null;
  /** Creation timestamp. */
  readonly createdAt: string;
}

/** Persistent store for agent identity material. */
interface IdentityStore {
  /** Create a new identity with fresh key material. */
  create(groupId: string | null): Promise<Result<AgentIdentity, InternalError>>;

  /** Look up the identity for a given group. */
  getByGroupId(groupId: string): Promise<AgentIdentity | null>;

  /** Look up an identity by its ID. */
  getById(id: string): Promise<AgentIdentity | null>;

  /** List all identities. */
  list(): Promise<readonly AgentIdentity[]>;

  /** Update the inboxId after XMTP registration. */
  setInboxId(
    id: string,
    inboxId: string,
  ): Promise<Result<AgentIdentity, NotFoundError>>;

  /** Remove an identity and its associated data. */
  remove(id: string): Promise<Result<void, NotFoundError>>;
}
```

### Signer Adapter

The core does not manage raw key bytes directly. It delegates signing to a `SignerProvider` injected at construction. This allows the key management package (`@xmtp-broker/keys`) to provide hardware-backed signers while the core remains key-agnostic.

```typescript
import type { Signer } from "@xmtp/node-sdk";

/** Provides XMTP-compatible signers for agent identities. */
interface SignerProvider {
  /** Get or create a signer for the given identity. */
  getSigner(identityId: string): Promise<Result<Signer, InternalError>>;

  /** Get the database encryption key for the given identity (32 bytes). */
  getDbEncryptionKey(identityId: string): Promise<Result<Uint8Array, InternalError>>;
}
```

### Raw Events

Raw events are the core's output. They carry unfiltered XMTP data with enough metadata for the policy engine to apply views and grants. These are internal types, not the `BrokerEvent` schemas from `02-schemas` (those are the harness-facing events emitted by the policy engine after filtering).

```typescript
/** Raw message received from XMTP, before any policy filtering. */
interface RawMessageEvent {
  readonly type: "raw.message";
  readonly messageId: string;
  readonly groupId: string;
  readonly senderInboxId: string;
  readonly contentType: string;
  readonly content: unknown;
  readonly sentAt: string;
  /** True if this message was received during recovery sync. */
  readonly isHistorical: boolean;
}

/** A new group was discovered (joined or created). */
interface RawGroupJoinedEvent {
  readonly type: "raw.group.joined";
  readonly groupId: string;
  readonly groupName: string;
}

/** Group membership changed. */
interface RawGroupUpdatedEvent {
  readonly type: "raw.group.updated";
  readonly groupId: string;
  readonly update: unknown;
}

/** Core lifecycle events. */
interface RawCoreStartedEvent {
  readonly type: "raw.core.started";
  readonly identityCount: number;
  readonly syncedThrough: string;
}

interface RawCoreStoppedEvent {
  readonly type: "raw.core.stopped";
  readonly reason: string;
}

interface RawHeartbeatEvent {
  readonly type: "raw.heartbeat";
  readonly timestamp: string;
}

type RawEvent =
  | RawMessageEvent
  | RawGroupJoinedEvent
  | RawGroupUpdatedEvent
  | RawCoreStartedEvent
  | RawCoreStoppedEvent
  | RawHeartbeatEvent;
```

### Core Context

The core context is the sealed interface that downstream components use to perform actions through the XMTP client. It never exposes the raw client, conversations, or signer.

```typescript
/** Sealed interface for performing actions through the broker core. */
interface CoreContext {
  /** Send a message to a group. */
  sendMessage(
    groupId: string,
    contentType: string,
    content: unknown,
  ): Promise<Result<{ messageId: string }, BrokerError>>;

  /** Get group metadata. */
  getGroupInfo(
    groupId: string,
  ): Promise<Result<GroupInfo, NotFoundError>>;

  /** List all groups the broker is a member of. */
  listGroups(): Promise<Result<readonly GroupInfo[], InternalError>>;

  /** Add members to a group by inbox ID. */
  addMembers(
    groupId: string,
    inboxIds: readonly string[],
  ): Promise<Result<void, BrokerError>>;

  /** Remove members from a group. */
  removeMembers(
    groupId: string,
    inboxIds: readonly string[],
  ): Promise<Result<void, BrokerError>>;

  /** Get the inbox ID for a given group's identity. */
  getInboxId(groupId: string): Promise<Result<string, NotFoundError>>;

  /** Force a sync for a specific group. */
  syncGroup(groupId: string): Promise<Result<void, BrokerError>>;
}

interface GroupInfo {
  readonly groupId: string;
  readonly name: string;
  readonly description: string;
  readonly memberInboxIds: readonly string[];
  readonly createdAt: string;
}
```

### BrokerCore Service

```typescript
type RawEventHandler = (event: RawEvent) => void;

/** The core service managing the raw XMTP plane. */
interface BrokerCore {
  /** Start the core: initialize clients, begin streaming. */
  start(): Promise<Result<void, BrokerError>>;

  /** Stop the core: close streams, disconnect clients. */
  stop(): Promise<Result<void, BrokerError>>;

  /** Subscribe to raw events. Returns an unsubscribe function. */
  on(handler: RawEventHandler): () => void;

  /** Get the sealed context for performing actions. */
  readonly context: CoreContext;

  /** Current lifecycle state. */
  readonly state: CoreState;
}

type CoreState = "idle" | "starting" | "running" | "stopping" | "stopped" | "error";
```

## Zod Schemas

Core-specific schemas are defined above (`BrokerCoreConfigSchema`, `XmtpEnvSchema`, `IdentityModeSchema`). All other schemas (events, errors, content types) are imported from `@xmtp-broker/schemas` as defined in `02-schemas.md`.

Raw event types are plain TypeScript interfaces, not Zod schemas, because they are internal to the runtime tier and never cross a serialization boundary.

## Behaviors

### Lifecycle State Machine

```
  ┌──────┐   start()   ┌──────────┐   clients ready   ┌─────────┐
  │ idle │ ──────────>  │ starting │ ────────────────>  │ running │
  └──────┘              └──────────┘                    └─────────┘
                            │                              │
                            │ error                        │ stop()
                            v                              v
                        ┌───────┐                     ┌──────────┐
                        │ error │                     │ stopping │
                        └───────┘                     └──────────┘
                                                          │
                                                          v
                                                      ┌─────────┐
                                                      │ stopped │
                                                      └─────────┘
```

State transitions are synchronous and guarded: `start()` only works from `idle`, `stop()` only from `running`. Calling `start()` on a `stopped` core returns an error -- create a new instance instead.

### Startup Sequence

1. Validate `BrokerCoreConfig` with Zod.
2. Initialize `IdentityStore` from `dataDir`.
3. Load all existing identities.
4. For each identity, obtain a `Signer` and `dbEncryptionKey` from the `SignerProvider`.
5. Create an XMTP `Client` for each identity via `Client.create(signer, options)`.
   - `dbPath`: `{dataDir}/db/{env}/{identityId}.db3`
   - `dbEncryptionKey`: from `SignerProvider`
   - `disableDeviceSync`: `true` (per-group identity means no cross-device sync)
   - `env`: from config
6. Call `conversations.syncAll()` on each client to catch up.
7. Start the message stream via `conversations.streamAllMessages()`.
8. Start the group stream via `conversations.streamGroups()`.
9. Start the heartbeat timer.
10. Emit `raw.core.started`.
11. Transition to `running`.

### Per-Group Identity Flow

When a new group is encountered (either through invitation or explicit creation):

```
  New group discovered
        │
        v
  ┌─────────────────────┐
  │ identityMode check  │
  └─────────────────────┘
       │            │
  per-group       shared
       │            │
       v            v
  Create new    Use existing
  identity      shared identity
       │            │
       v            v
  Generate keys   Already
  via SignerProvider  registered
       │
       v
  Create XMTP Client
       │
       v
  Register with network
       │
       v
  Store identity -> group mapping
       │
       v
  Join group with new client
       │
       v
  Begin streaming for this client
```

Each identity gets:
- Its own wallet key (via `SignerProvider`)
- Its own database encryption key (via `SignerProvider`)
- Its own SQLite database file
- Its own XMTP `Client` instance
- Its own message stream

In `shared` mode, a single identity is used for all groups. The startup path is simpler but provides no isolation.

### Message Flow

```
  XMTP Network
       │
       │  streamAllMessages()
       v
  ┌──────────────┐
  │  Raw decode   │  Content validated against CONTENT_TYPE_SCHEMAS
  │  + validate   │  Unknown types still forwarded with raw bytes
  └──────────────┘
       │
       v
  ┌──────────────┐
  │  Determine    │  Was this received during sync (isHistorical)
  │  freshness    │  or from the live stream?
  └──────────────┘
       │
       v
  ┌──────────────┐
  │  Emit         │  RawMessageEvent to all subscribers
  │  raw.message  │
  └──────────────┘
       │
       v
  Policy Engine (04-policy-engine) handles filtering
```

The core tracks a "caught up" watermark per client. Messages received during the initial `syncAll()` call are marked `isHistorical: true`. Messages from the live stream after sync completes are `isHistorical: false`. This distinction allows the policy engine to tag historical messages appropriately for the harness, as specified in the PRD's recovery section.

### Heartbeat Generation

A `setInterval` timer emits `raw.heartbeat` events at the configured interval (default: 30s). The heartbeat is a core-level signal that the broker process is alive. The policy engine translates these into session-scoped `HeartbeatEvent`s for each active harness.

On `stop()`, the heartbeat timer is cleared.

### Client Registry

The core maintains an internal `Map<string, ManagedClient>` keyed by identity ID:

```typescript
interface ManagedClient {
  readonly identityId: string;
  readonly inboxId: string;
  readonly client: Client;
  readonly stream: AsyncIterable<DecodedMessage>;
  readonly groupIds: Set<string>;
}
```

This registry is ephemeral -- it is rebuilt from the `IdentityStore` and XMTP network state on every startup. The `IdentityStore` is the durable source of truth for which identities exist; the `ManagedClient` registry is the runtime source of truth for active connections.

### Graceful Shutdown

1. Transition to `stopping`.
2. Clear heartbeat timer.
3. Close all message streams (the XMTP SDK stream `return()` method).
4. Emit `raw.core.stopped`.
5. Allow in-flight `sendMessage` calls to complete (5s grace period).
6. Transition to `stopped`.

XMTP `Client` instances are not explicitly closed -- the SDK manages its own connection lifecycle. The core only manages the streams and timers it creates.

## Error Cases

| Scenario | Error Type | Category | Recovery |
|---|---|---|---|
| Config validation fails | `ValidationError` | validation | Fix config, restart |
| XMTP client creation fails | `InternalError` | internal | Retry with backoff |
| Message stream drops | `InternalError` | internal | Auto-reconnect stream |
| Sync times out | `TimeoutError` | timeout | Retry (retryable) |
| Identity not found for group | `NotFoundError` | not_found | Create identity if per-group mode |
| SignerProvider fails | `InternalError` | internal | Cannot proceed without keys |
| Send message fails | `InternalError` | internal | Bubble to caller |
| Group not found | `NotFoundError` | not_found | Sync and retry once |

### Stream Reconnection

When a message stream drops (the XMTP SDK calls `onFail`), the core:
1. Waits 1 second.
2. Calls `syncAll()` to catch up on missed messages.
3. Restarts the stream.
4. Marks messages from the sync as `isHistorical: true`.

This loop continues indefinitely while the core is in `running` state. If three consecutive reconnection attempts fail within 60 seconds, the core transitions to `error` state and emits `raw.core.stopped` with reason `"stream_reconnection_exhausted"`.

## Open Questions Resolved

**Q: Per-group identity -- default-on or opt-in?** (PLAN.md Key Decisions)
**A:** Default-on. The `identityMode` config defaults to `"per-group"`. Rationale: matches the convos-node-sdk ADR 002 pattern, provides strongest isolation, and prevents accidental group membership cross-contamination. Operators who want simplicity can set `"shared"` explicitly.

**Q: How does per-group identity interact with XMTP's inbox model?**
**A:** Each identity gets its own XMTP inbox. From the network's perspective, these are independent participants. The broker is the only entity that knows they share an owner. This means each identity registers separately, maintains its own MLS state, and appears as a distinct member in each group. `disableDeviceSync: true` is set on all per-group clients since cross-device sync is meaningless when each identity is purpose-bound to one group.

**Q: What state is ephemeral vs durable?**
**A:** Durable: identity records (id, wallet key reference, db encryption key reference, group binding, inbox ID) stored in the `IdentityStore`. The XMTP SQLite databases are also durable (managed by the SDK). Ephemeral: `ManagedClient` registry, stream handles, heartbeat timer, caught-up watermarks. On crash recovery, all ephemeral state is reconstructed from durable state + XMTP sync.

**Q: How does the broker handle crash recovery?**
**A:** The core's startup sequence is its recovery sequence. On restart after a crash, the core loads identities from the store, creates XMTP clients (which reuse existing SQLite databases), calls `syncAll()` to catch up, and resumes streaming. Messages received during sync are tagged as historical. The policy engine emits a `broker.recovery.complete` event with the `caughtUpThrough` timestamp once all clients have synced.

## Deferred

- **Multi-agent isolation within a single broker process**: v0 assumes one "owner" operating the broker. Multiple independent owners sharing a broker process is a post-v0 concern. The per-group identity model provides group-level isolation, but tenant-level isolation (separate owners) is not designed here.
- **Client connection pooling**: Each identity gets its own client. Connection pooling or multiplexing across identities is a performance optimization for post-v0.
- **Custom content type codecs**: v0 uses baseline content types. Runtime codec registration is deferred to Phase 2.
- **Database compaction/cleanup**: Old XMTP databases for removed identities are cleaned up by `IdentityStore.remove()`, but no automatic compaction or retention policy is implemented.
- **Metrics and observability**: The core emits events, but structured metrics (message count, sync latency, stream reconnections) are deferred.
- **Hosted broker adaptations**: TEE-backed key storage, hibernation, and multi-tenant isolation are post-v0 per the PLAN.md phase boundaries.

## Testing Strategy

### What to Test

1. **Lifecycle state machine** -- Verify state transitions: idle -> starting -> running -> stopping -> stopped. Verify guards (start from stopped fails, stop from idle fails).
2. **Identity store CRUD** -- Create, read, update, list, remove identities. Verify group binding lookup.
3. **Per-group identity creation** -- When a new group is encountered in per-group mode, verify a new identity is created and bound.
4. **Shared mode bypass** -- When identity mode is shared, verify no new identity is created for new groups.
5. **Raw event emission** -- Verify that messages from XMTP streams are converted to `RawMessageEvent`s with correct fields.
6. **Historical tagging** -- Messages from `syncAll()` are tagged `isHistorical: true`; live stream messages are `false`.
7. **Heartbeat timer** -- Verify heartbeats are emitted at the configured interval and stop on shutdown.
8. **Stream reconnection** -- Simulate stream failure and verify reconnection with sync.
9. **Core context sealing** -- Verify that `CoreContext` methods work without exposing the raw client.
10. **Config validation** -- Invalid configs are rejected with `ValidationError`.

### How to Test

**Unit tests** (most tests): Mock the XMTP SDK. The `Client`, `Conversations`, and `Group` classes are injected via a factory function, allowing complete isolation from the network. The `SignerProvider` is also mocked.

**Integration tests** (few, slow): Use the XMTP local environment (`env: "local"`) with `yarn test:setup` to run a local XMTP node. These tests verify that real XMTP client creation, registration, and message streaming work end-to-end through the core.

### Test Utilities

```typescript
/** Create a mock SignerProvider for testing. */
function createMockSignerProvider(): SignerProvider;

/** Create a mock XMTP Client for testing. */
function createMockXmtpClient(options?: {
  inboxId?: string;
  messages?: RawMessageEvent[];
}): Client;

/** Create a BrokerCore with all dependencies mocked. */
function createTestBrokerCore(
  overrides?: Partial<BrokerCoreConfig>,
): { core: BrokerCore; mocks: TestMocks };

interface TestMocks {
  signerProvider: SignerProvider;
  identityStore: IdentityStore;
  emitMessage: (event: RawMessageEvent) => void;
  emitStreamDrop: () => void;
}
```

## File Layout

```
packages/core/
  package.json
  tsconfig.json
  src/
    index.ts                    # Re-exports public API
    config.ts                   # BrokerCoreConfigSchema, XmtpEnvSchema, IdentityModeSchema
    broker-core.ts              # BrokerCore implementation (start/stop lifecycle)
    core-context.ts             # CoreContext implementation (sealed action interface)
    identity-store.ts           # IdentityStore implementation (file-based, under dataDir)
    client-registry.ts          # ManagedClient map, stream management
    event-emitter.ts            # Typed event emitter for RawEvent
    raw-events.ts               # RawEvent type definitions
    xmtp-client-factory.ts      # Wraps XMTP Client.create with broker conventions
    __tests__/
      config.test.ts
      broker-core.test.ts
      core-context.test.ts
      identity-store.test.ts
      client-registry.test.ts
      event-emitter.test.ts
      fixtures.ts               # Test utilities and mocks
```

Each file stays under 200 LOC. The `broker-core.ts` file orchestrates the lifecycle but delegates client management to `client-registry.ts`, identity persistence to `identity-store.ts`, and event distribution to `event-emitter.ts`.
