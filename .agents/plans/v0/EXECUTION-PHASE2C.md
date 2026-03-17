# Phase 2C Execution Plan — Real XMTP Network

**Version:** 3.0
**Created:** 2026-03-16
**Updated:** 2026-03-16
**Status:** Revised after production tracer bullet discovery
**Prerequisite:** Phase 2B complete (tracer bullet passes in local mode)

## Overview

Phase 2B proved the broker works end-to-end in local mode: identity init,
daemon lifecycle, session management, WebSocket auth, and permission
enforcement all pass. Phase 2C connects the broker to real XMTP networks.

The goal is a deterministic dev-network tracer bullet:

`identity init --env dev` (alice) -> `identity init --env dev` (bob) ->
`broker start --env dev` -> `conversation create` (alice creates group, adds
bob) -> `session issue` -> WS harness sends message as alice ->
bob's stream receives it -> `broker stop`

This proves:

1. Identity registration with the XMTP network (not just local keys)
2. Multi-identity support (two separate inboxes in one broker)
3. Real group creation and membership
4. Message delivery through the network
5. Stream-based message reception

Then Phase 2C goes further with two real-world conversation flows:

**Flow A — "Join my chat" (user invites broker):** The user creates a
conversation in Convos, shares an invite link. The broker parses the Convos
invite tag, creates an identity, and joins via the Convos protocol.

**Flow B — "Join the agent's chat" (broker invites user):** The broker
creates a group, generates a Convos-compatible invite URL, and renders it
as a QR code in the terminal. The user scans it in Convos to join.

Both flows were discovered during the production tracer bullet when we
found that Convos users don't have visible inbox IDs — they share invite
links (`popup.convos.org/v2?i=<base64url-protobuf>`). The original plan
assumed the broker would add users by inbox ID, which doesn't match real
Convos UX.

### Design Principles

**Dual-identity from the start.** The tracer bullet uses two internal inboxes
("alice" and "bob") to validate identity separation. This catches
cross-contamination bugs early and gives us a self-contained test environment
before wiring in external clients.

**Dev first, prod follows.** Steps 1-4 target XMTP devnet for automated,
self-contained testing. Step 5 switches to production for real-world interop.
The architecture already supports all three environments — it's a config
switch.

**Reference patterns.** Group creation and identity registration patterns are
drawn from `.reference/xmtp-js/` (CLI) and `.reference/convos-node-sdk/`
(per-group identity). The Convos SDK's "one identity per conversation" model
maps directly to the broker's `per-group` identity mode.

## Stack

```text
v0/tracer-bullet-skill (current top)
  +-- v0/identity-registration      Step 1: register identities with XMTP network
       +-- v0/core-network-start    Step 2: broker start with real SDK clients
            +-- v0/conversation-commands  Step 3a: create/list/info group commands
                 +-- v0/convos-join  Step 3b: parse Convos invite + join protocol (Flow A)
                      +-- v0/convos-invite  Step 3c: generate Convos-compatible invite (Flow B)
                           +-- v0/dev-tracer-bullet  Step 4: dual-identity dev-network tracer
                                +-- v0/prod-tracer-bullet  Step 5: production tracer (direct inbox ID)
                                     +-- v0/convos-tracer  Step 6: Convos interop tracer (invite flows)
```

Each branch = one commit. One commit per PR.

## What's Already Proven

Steps 1-2 and the dev network tracer have been validated:

| What | Status | Evidence |
|------|--------|----------|
| Identity registration (dev) | PASS | Two identities with distinct inbox IDs on devnet |
| Identity registration (prod) | PASS | Inbox `c41d9d16...` on production network |
| Core network startup | PASS | `networkState: "connected"`, `identityCount: 2` |
| Group creation (dev) | PASS | Group created, both members added |
| Message delivery (dev) | PASS | `messageId: c0ffb42a...` returned, real network delivery |
| Session + WS harness (dev) | PASS | Auth, scope enforcement, heartbeat all work |
| Production daemon | PASS | Daemon starts, connects to production XMTP |

Steps 3b, 3c, and 5 need implementation based on the Convos invite discovery.

---

## Step 1: Identity Registration

**Branch:** `v0/identity-registration`
**Scope:** `packages/core/`, `packages/cli/`
**Estimated size:** ~250 LOC

### Problem

`identity init` creates vault keys (root, operational, admin) but never
registers with the XMTP network. The `IdentityStore` has records with
`inboxId: null`. `BrokerCoreImpl.start()` iterates these identities and
calls `SdkClientFactory.create()`, but that call needs a signer derived from
the identity's key material — and that derivation path isn't wired from the
CLI.

### Current State

**`packages/cli/src/commands/identity.ts`** — `identity init` action
(lines 28-117):

1. Loads config and resolves paths
2. Creates key manager with vault policies
3. Initializes root key (`km.initialize()`)
4. Creates default operational key (`km.createOperationalKey("default", null)`)
5. Creates admin key (`km.admin.create()`)
6. Returns key metadata — **no XMTP registration happens**

**`packages/core/src/identity-store.ts`** — `SqliteIdentityStore`:

- Schema: `id TEXT PRIMARY KEY, inbox_id TEXT, group_id TEXT UNIQUE, created_at TEXT`
- Has `create(groupId)`, `setInboxId(id, inboxId)`, `getByGroupId()`, `list()`
- No `label` column yet

**`packages/keys/src/signer-provider.ts`** — `createSignerProvider(manager, identityId)`:

- Returns a `SignerProvider` backed by the key manager
- `getDbEncryptionKey()` → `manager.getOrCreateDbKey(identityId)` (generates + vaults 32-byte key)
- `getXmtpIdentityKey()` → `manager.getOrCreateXmtpIdentityKey(identityId)` (generates + vaults secp256k1 key)
- These are **get-or-create** methods — they generate keys on first call and persist them

**`packages/core/src/sdk/sdk-client-factory.ts`** — `createSdkClientFactory()`:

- `create(opts)` calls `Client.create(signer, { dbPath, dbEncryptionKey, env })`
- Returns `XmtpClient` with `inboxId` populated after registration

### Changes

**`packages/core/src/identity-registration.ts`** — New file:

```typescript
import { Result } from "better-result";
import type { BrokerError } from "@xmtp-broker/schemas";
import { InternalError } from "@xmtp-broker/schemas";
import type { SqliteIdentityStore } from "./identity-store.js";
import type {
  XmtpClientFactory,
  SignerProviderLike,
} from "./xmtp-client-factory.js";
import type { BrokerCoreConfig, XmtpEnv } from "./config.js";

export type SignerProviderFactory = (identityId: string) => SignerProviderLike;

export interface IdentityRegistrationDeps {
  readonly identityStore: SqliteIdentityStore;
  readonly clientFactory: XmtpClientFactory;
  readonly signerProviderFactory: SignerProviderFactory;
  readonly config: Pick<BrokerCoreConfig, "dataDir" | "env" | "appVersion">;
}

export interface RegisterIdentityInput {
  readonly label?: string;
  readonly groupId?: string | null;
}

export interface RegisteredIdentity {
  readonly identityId: string;
  readonly inboxId: string;
  readonly address: string;
  readonly env: XmtpEnv;
  readonly label: string | undefined;
}

/**
 * Register a new XMTP identity on the network.
 *
 * 1. Creates an identity record in the store
 * 2. Derives signing keys via the signer provider (get-or-create in vault)
 * 3. Calls SdkClientFactory.create() which registers with XMTP network
 * 4. Persists the inbox ID back to the store
 *
 * On failure, cleans up the identity record.
 */
export async function registerIdentity(
  deps: IdentityRegistrationDeps,
  input: RegisterIdentityInput,
): Promise<Result<RegisteredIdentity, BrokerError>> {
  // 1. Create identity record (inboxId starts null)
  const createResult = await deps.identityStore.create(
    input.groupId ?? null,
    input.label,
  );
  if (createResult.isErr()) return createResult;
  const identity = createResult.value;

  try {
    // 2. Get signer for this identity (generates vault keys on first call)
    const signer = deps.signerProviderFactory(identity.id);

    const dbEncKeyResult = await signer.getDbEncryptionKey(identity.id);
    if (dbEncKeyResult.isErr()) {
      await deps.identityStore.remove(identity.id);
      return dbEncKeyResult;
    }

    const xmtpKeyResult = await signer.getXmtpIdentityKey(identity.id);
    if (xmtpKeyResult.isErr()) {
      await deps.identityStore.remove(identity.id);
      return xmtpKeyResult;
    }

    // 3. Register with XMTP network
    const dbPath =
      deps.config.dataDir === ":memory:"
        ? ":memory:"
        : `${deps.config.dataDir}/db/${deps.config.env}/${identity.id}.db3`;

    const clientResult = await deps.clientFactory.create({
      identityId: identity.id,
      dbPath,
      dbEncryptionKey: dbEncKeyResult.value,
      env: deps.config.env,
      appVersion: deps.config.appVersion,
      signerPrivateKey: xmtpKeyResult.value,
    });

    if (clientResult.isErr()) {
      await deps.identityStore.remove(identity.id);
      return clientResult;
    }

    const client = clientResult.value;

    // 4. Persist inbox ID
    const setResult = await deps.identityStore.setInboxId(
      identity.id,
      client.inboxId,
    );
    if (setResult.isErr()) {
      await deps.identityStore.remove(identity.id);
      return setResult;
    }

    return Result.ok({
      identityId: identity.id,
      inboxId: client.inboxId,
      address: client.address,
      env: deps.config.env,
      label: input.label,
    });
  } catch (cause) {
    await deps.identityStore.remove(identity.id);
    return Result.err(
      InternalError.create("Identity registration failed", {
        cause: String(cause),
      }),
    );
  }
}
```

> **Note:** `client.address` is the Ethereum address derived from the signer
> key. The `XmtpClient` interface may need an `address` property added, or
> this can be computed from the signer key via viem's `privateKeyToAccount`.

**`packages/core/src/identity-store.ts`** — Add `label` column and query:

```typescript
// In #migrate():
// Safe migration: add column if it doesn't exist
const cols = this.#db
  .prepare("PRAGMA table_info(identities)")
  .all() as Array<{ name: string }>;
if (!cols.some((c) => c.name === "label")) {
  this.#db.run("ALTER TABLE identities ADD COLUMN label TEXT UNIQUE");
}

// Update create() signature:
async create(
  groupId: string | null,
  label?: string,
): Promise<Result<AgentIdentity, InternalError>>

// New method:
async getByLabel(label: string): Promise<AgentIdentity | null> {
  const row = this.#db
    .prepare("SELECT * FROM identities WHERE label = ?")
    .get(label) as IdentityRow | null;
  return row ? rowToIdentity(row) : null;
}
```

Update `AgentIdentity` interface to include `label: string | null`.

**`packages/cli/src/commands/identity.ts`** — Extend `identity init`:

The key challenge: `identity init` runs without a daemon (direct mode), so
it needs to construct `IdentityRegistrationDeps` itself. The pattern follows
how `start.ts` constructs deps for the daemon:

```typescript
// After existing steps 1-6 (vault key creation)...

// 7. Register XMTP identity (skip for --env local)
const env = options.env ?? config.broker?.env ?? "dev";
if (env !== "local") {
  const { createSdkClientFactory } = await import("@xmtp-broker/core");
  const { createSignerProvider } = await import("@xmtp-broker/keys");
  const { registerIdentity, SqliteIdentityStore } = await import(
    "@xmtp-broker/core"
  );

  const identityStore = new SqliteIdentityStore(
    `${paths.dataDir}/identities.db`,
  );
  const clientFactory = createSdkClientFactory();
  const signerProviderFactory = (identityId: string) =>
    createSignerProvider(km, identityId);

  const label = options.label ?? "default";

  const regResult = await registerIdentity(
    {
      identityStore,
      clientFactory,
      signerProviderFactory,
      config: {
        dataDir: paths.dataDir,
        env,
        appVersion: "xmtp-broker/0.1.0",
      },
    },
    { label },
  );

  identityStore.close();

  if (regResult.isErr()) {
    printErr({
      error: `XMTP registration failed: ${regResult.error.message}`,
    });
    process.exit(exitCodeFromCategory(regResult.error.category));
  }

  print({
    initialized: true,
    rootPublicKey,
    operationalKeyId: opKey.identityId,
    adminKeyFingerprint: adminResult.value.fingerprint,
    inboxId: regResult.value.inboxId,
    address: regResult.value.address,
    env,
    label,
    platform: km.platform,
    dataDir: paths.dataDir,
  });
  return;
}

// Existing local-only output (env === "local")
print({ initialized: true, ... });
```

Add new flags to the `init` command:

```typescript
.option("--env <env>", "XMTP environment (local|dev|production)")
.option("--label <name>", "Human-readable label for this identity")
```

**`packages/cli/src/commands/identity.ts`** — Add `identity list`:

```typescript
cmd
  .command("list")
  .description("List registered identities")
  .option("--config <path>", "Path to config file")
  .option("--json", "JSON output")
  .action(async (options) => {
    const json = Boolean(options.json);
    const print = (data: unknown) =>
      process.stdout.write(formatOutput(data, { json }) + "\n");

    const configResult = await loadConfig(
      typeof options.config === "string"
        ? { configPath: options.config }
        : {},
    );
    if (configResult.isErr()) {
      process.stderr.write(
        formatOutput({ error: configResult.error.message }, { json }) + "\n",
      );
      process.exit(exitCodeFromCategory(configResult.error.category));
    }

    const paths = resolvePaths(configResult.value);
    const { SqliteIdentityStore } = await import("@xmtp-broker/core");
    const store = new SqliteIdentityStore(
      `${paths.dataDir}/identities.db`,
    );
    const identities = await store.list();
    store.close();

    print(identities);
  });
```

**`packages/core/src/__tests__/identity-registration.test.ts`** — Tests:

```typescript
import { describe, test, expect } from "bun:test";
import { Result } from "better-result";
import { registerIdentity } from "../identity-registration.js";
// Use mock fixtures from existing test patterns:
import { createMockXmtpClient } from "./fixtures.js";

describe("registerIdentity", () => {
  test("creates identity and returns inbox ID", async () => {
    // Setup: mock client factory that returns a client with known inboxId
    // Verify: identity store has record with inboxId set
  });

  test("cleans up identity record on factory failure", async () => {
    // Setup: client factory returns error
    // Verify: identity store is empty after failure
  });

  test("stores and retrieves label", async () => {
    // Verify: getByLabel returns the identity
  });

  test("rejects duplicate label", async () => {
    // Verify: second create with same label fails
  });

  test("handles null groupId for shared mode", async () => {
    // Verify: identity created with groupId = null
  });
});
```

### Key Decision: Registration During Init

Why register during `identity init` rather than lazily during `broker start`:

1. **Explicit is better.** The operator sees the inbox ID immediately and can
   share it (e.g., to be invited to groups).
2. **Fails fast.** Network issues surface at init time, not daemon startup.
3. **Separation of concerns.** `identity init` is the credential bootstrap
   step. `broker start` is the runtime step.
4. **Consistent with Convos.** The Convos CLI creates identities and registers
   them in one step.

### Key Decision: Constructing Deps Without a Daemon

`identity init` runs in direct mode (no daemon). It constructs the same
deps that `start.ts` would use in the daemon:

| Dependency | Daemon source (`start.ts`) | Direct source (`identity.ts`) |
|------------|---------------------------|-------------------------------|
| `KeyManager` | `createKeyManager(config)` | Already created at step 3 |
| `SignerProviderFactory` | `createSignerProvider(keyManagerRef, id)` | `createSignerProvider(km, id)` |
| `XmtpClientFactory` | `createSdkClientFactory()` | `createSdkClientFactory()` |
| `SqliteIdentityStore` | Owned by `BrokerCoreImpl` | Created directly with `identities.db` path |

The key manager (`km`) is already alive at the point where registration
happens, so the signer provider factory can be constructed inline.

**Success gate:** `identity init --env dev --label alice` creates vault keys
and returns an inbox ID from the XMTP devnet. A second
`identity init --env dev --label bob` creates a second, separate identity with
a different inbox ID. `identity list` shows both.

---

## Step 2: Core Network Startup

**Branch:** `v0/core-network-start`
**Scope:** `packages/cli/`
**Estimated size:** ~150 LOC

### Problem

`broker start` calls `core.initializeLocal()` and stops there. The
`core.initialize()` method (which maps to `BrokerCoreImpl.start()`) that
hydrates real XMTP clients is never called. This was correct for Phase 2B
(local mode only), but now that identities are registered, the daemon needs
to connect to the network.

### Current State

**`packages/cli/src/runtime.ts`** — `BrokerRuntime.start()` (lines 250-323):

```typescript
// 1. Initialize key manager
// 2. Initialize broker core locally  ← stops here
// 3. Start WebSocket server
// 4. Start admin server
// 5. Write PID file
// 6. Log startup event
```

The `BrokerCore` contract (from `@xmtp-broker/contracts`) has both
`initializeLocal()` and `initialize()`. The adapter in `start.ts` maps
these to `BrokerCoreImpl.startLocal()` and `BrokerCoreImpl.start()`.

**`packages/cli/src/start.ts`** — The adapter (lines 130-163):

```typescript
// BrokerCore adapter wrapping BrokerCoreImpl:
async initializeLocal() { return impl.startLocal(); },
async initialize() { return impl.start(); },
```

`BrokerCoreImpl.start()` (lines 105-238 in `broker-core.ts`) already does
everything needed: iterates stored identities, creates SDK clients, syncs,
starts streams, transitions to `"running"`.

### Changes

**`packages/cli/src/runtime.ts`** — Add network startup after step 2:

```typescript
// 2. Initialize broker core locally
const coreLocalResult = await core.initializeLocal();
if (Result.isError(coreLocalResult)) {
  currentState = "error";
  return coreLocalResult;
}

// 2b. Attempt network startup if identities exist and env is not "local"
if (config.broker.env !== "local") {
  const coreNetworkResult = await core.initialize();
  if (Result.isError(coreNetworkResult)) {
    // Graceful degradation: log and continue in local mode
    await auditLog.append({
      timestamp: new Date().toISOString(),
      action: "core.network-start-failed",
      actor: "system",
      success: false,
      detail: {
        error: coreNetworkResult.error.message,
        fallback: "local",
      },
    });
    // Don't return error — daemon is still useful in local state
  }
}

// 3. Start WebSocket server (proceeds regardless of core state)
```

The `BrokerCoreImpl.start()` method already handles the "no identities"
case gracefully — it loops over `identityStore.list()` and if the list is
empty, it starts the heartbeat and transitions to `"running"` with zero
clients. This is fine; the daemon is ready to accept identities later.

**`packages/cli/src/daemon/status.ts`** — Extend `DaemonStatus`:

```typescript
// Add to DaemonStatusSchema:
identityCount: z.number(),
networkState: z.enum(["disconnected", "connected"]),
connectedInboxIds: z.array(z.string()),
```

**`packages/cli/src/runtime.ts`** — Populate new status fields:

```typescript
async status(): Promise<DaemonStatus> {
  // ... existing fields ...
  return {
    // ... existing ...
    identityCount: /* read from core or identity store */,
    networkState: core.state === "ready" ? "connected" : "disconnected",
    connectedInboxIds: /* read from registry */,
  };
}
```

> **Implementation note:** The `BrokerCore` contract doesn't expose identity
> count or inbox IDs yet. Either add `listIdentities()` to the contract, or
> expose it through the `BrokerCoreImpl` adapter in `start.ts`. The adapter
> pattern from `start.ts` (lines 130-163) is the right place to add this.

**`packages/cli/src/__tests__/network-startup.test.ts`** — Tests:

- Daemon starts in local mode when `env: "local"`
- Daemon calls `core.initialize()` when `env: "dev"` and identities exist
- Daemon continues in local mode when `core.initialize()` fails
- Status reports `networkState: "connected"` after successful startup
- Status reports `networkState: "disconnected"` when core is local-only

**Success gate:** `broker start --env dev` with registered identities
transitions the core to `running` state. `broker status` shows connected
inbox IDs. Without identities, daemon stays in local mode.

---

## Step 3: Conversation Commands

**Branch:** `v0/conversation-commands`
**Scope:** `packages/core/`, `packages/cli/`
**Estimated size:** ~300 LOC

### Problem

Even with registered identities and a running core, the broker has zero
groups. We need CLI commands to create groups and list existing ones.

### Current State

**`packages/cli/src/commands/conversation.ts`** — Stub commands exist with
empty action bodies: `list`, `info`, `create`, `add-member`.

**`packages/core/src/xmtp-client-factory.ts`** — `XmtpClient` interface has
`listGroups()`, `getGroupInfo()`, `addMembers()`, `sendMessage()`, but
**no `createGroup()` method**.

**`packages/core/src/sdk/sdk-client.ts`** — Implements `XmtpClient` by
wrapping the SDK. All methods use the `wrapSdkCall()` helper.

**`packages/sessions/src/actions.ts`** — Reference pattern for ActionSpecs:

```typescript
export function createSessionActions(
  deps: SessionActionDeps,
): ActionSpec<unknown, unknown, BrokerError>[] {
  const issue: ActionSpec<SessionConfigType, unknown, BrokerError> = {
    id: "session.issue",
    input: SessionConfig,          // Zod schema
    handler: async (input) => deps.sessionManager.issue(input),
    cli: { command: "session:issue", rpcMethod: "session.issue" },
    mcp: { toolName: "broker/session/issue", description: "...", readOnly: false },
  };
  // ...
  return [issue, list, inspect, revoke].map(widenActionSpec);
}
```

**`packages/cli/src/commands/session.ts`** — Reference pattern for
daemon-bound CLI commands:

```typescript
export interface SessionCommandDeps {
  readonly withDaemonClient: WithDaemonClient;
  readonly writeStdout: (message: string) => void;
  readonly writeStderr: (message: string) => void;
  readonly exit: (code: number) => void;
}

// Usage:
const result = await resolvedDeps.withDaemonClient(
  { configPath: options.config },
  (client) =>
    client.request<readonly SessionRecord[]>("session.list", params),
);
```

### Changes

**`packages/core/src/xmtp-client-factory.ts`** — Add `createGroup` to
`XmtpClient` interface:

```typescript
/** Create a new group conversation with the given members. */
createGroup(
  memberInboxIds: readonly string[],
  options?: { name?: string },
): Promise<Result<XmtpGroupInfo, BrokerError>>;
```

**`packages/core/src/sdk/sdk-client.ts`** — Implement `createGroup`:

```typescript
async createGroup(
  memberInboxIds: readonly string[],
  options?: { name?: string },
): Promise<Result<XmtpGroupInfo, BrokerError>> {
  return wrapSdkCall(async () => {
    // Node.js SDK uses plain inbox ID strings, NOT typed identifier objects.
    // createGroupWithIdentifiers() does NOT exist in the Node SDK —
    // that pattern is React Native / Kotlin / Swift only.
    //
    // Verified via blz: the Node SDK signature is:
    //   client.conversations.createGroup(inboxIds: string[], opts?)

    const group = await this.#client.conversations
      .createGroup([...memberInboxIds], {
        name: options?.name,
      });

    // Sync the new group to hydrate member list
    await group.sync();

    const members = await group.members();
    return {
      groupId: group.id,
      name: group.name ?? undefined,
      memberInboxIds: members.map((m: { inboxId: string }) => m.inboxId),
      createdAtNs: group.createdAtNs,
    };
  });
}
```

**`packages/core/src/conversation-actions.ts`** — New file, ActionSpecs for
conversation operations:

```typescript
import { z } from "zod";
import { Result } from "better-result";
import type { ActionSpec } from "@xmtp-broker/contracts";
import type { BrokerError } from "@xmtp-broker/schemas";
import { NotFoundError } from "@xmtp-broker/schemas";
import type { BrokerCoreImpl } from "./broker-core.js";

export interface ConversationActionDeps {
  readonly core: BrokerCoreImpl;
}

const CreateGroupInput = z.object({
  name: z.string().optional(),
  memberInboxIds: z.array(z.string()).default([]),
  creatorIdentityLabel: z.string().optional(),
});

const ListGroupsInput = z.object({
  identityLabel: z.string().optional(),
});

const GroupInfoInput = z.object({
  groupId: z.string(),
});

function widenActionSpec<TInput, TOutput>(
  spec: ActionSpec<TInput, TOutput, BrokerError>,
): ActionSpec<unknown, unknown, BrokerError> {
  return spec as ActionSpec<unknown, unknown, BrokerError>;
}

export function createConversationActions(
  deps: ConversationActionDeps,
): ActionSpec<unknown, unknown, BrokerError>[] {

  const create: ActionSpec<z.infer<typeof CreateGroupInput>, unknown, BrokerError> = {
    id: "conversation.create",
    input: CreateGroupInput,
    handler: async (input) => {
      // 1. Resolve creator identity
      const identity = input.creatorIdentityLabel
        ? await deps.core.identityStore.getByLabel(input.creatorIdentityLabel)
        : (await deps.core.identityStore.list())[0] ?? null;

      if (!identity) {
        return Result.err(NotFoundError.create("identity", input.creatorIdentityLabel ?? "default"));
      }

      // 2. Get managed client from registry
      const managed = deps.core.registry.get(identity.id);
      if (!managed) {
        return Result.err(NotFoundError.create("managed-client", identity.id));
      }

      // 3. Create group via SDK
      const groupResult = await managed.client.createGroup(
        input.memberInboxIds,
        { name: input.name },
      );
      if (groupResult.isErr()) return groupResult;

      // 4. Register in managed client's group set
      managed.groupIds.add(groupResult.value.groupId);

      return Result.ok({
        groupId: groupResult.value.groupId,
        name: groupResult.value.name,
        creatorInboxId: managed.inboxId,
        memberCount: groupResult.value.memberInboxIds.length,
      });
    },
    cli: { command: "conversation:create", rpcMethod: "conversation.create" },
    mcp: { toolName: "broker/conversation/create", description: "Create a group conversation", readOnly: false },
  };

  const list: ActionSpec<z.infer<typeof ListGroupsInput>, unknown, BrokerError> = {
    id: "conversation.list",
    input: ListGroupsInput,
    handler: async (input) => {
      const identity = input.identityLabel
        ? await deps.core.identityStore.getByLabel(input.identityLabel)
        : (await deps.core.identityStore.list())[0] ?? null;

      if (!identity) return Result.ok([]);

      const managed = deps.core.registry.get(identity.id);
      if (!managed) return Result.ok([]);

      return managed.client.listGroups();
    },
    cli: { command: "conversation:list", rpcMethod: "conversation.list" },
    mcp: { toolName: "broker/conversation/list", description: "List group conversations", readOnly: true },
  };

  const info: ActionSpec<z.infer<typeof GroupInfoInput>, unknown, BrokerError> = {
    id: "conversation.info",
    input: GroupInfoInput,
    handler: async (input) => {
      return deps.core.context.getGroupInfo(input.groupId);
    },
    cli: { command: "conversation:info", rpcMethod: "conversation.info" },
    mcp: { toolName: "broker/conversation/info", description: "Get group details", readOnly: true },
  };

  return [create, list, info].map(widenActionSpec);
}
```

> **Implementation note:** `deps.core.registry` is currently private
> (`#registry`). Either add a public accessor or expose a
> `getManagedClient(identityId)` method on `BrokerCoreImpl`. The `context`
> property is already public and may be sufficient for some operations.

**`packages/cli/src/commands/conversation.ts`** — Wire CLI commands following
the session command pattern:

```typescript
import { Command } from "commander";
import { Result } from "better-result";
import type { BrokerError } from "@xmtp-broker/schemas";
import { exitCodeFromCategory } from "../output/exit-codes.js";
import { formatOutput } from "../output/formatter.js";
import {
  createWithDaemonClient,
  type WithDaemonClient,
} from "./daemon-client.js";

export interface ConversationCommandDeps {
  readonly withDaemonClient: WithDaemonClient;
  readonly writeStdout: (message: string) => void;
  readonly writeStderr: (message: string) => void;
  readonly exit: (code: number) => void;
}

const defaultDeps: ConversationCommandDeps = {
  withDaemonClient: createWithDaemonClient(),
  writeStdout: (msg) => process.stdout.write(msg),
  writeStderr: (msg) => process.stderr.write(msg),
  exit: (code) => process.exit(code),
};

export function createConversationCommands(
  deps: Partial<ConversationCommandDeps> = {},
): Command {
  const d: ConversationCommandDeps = { ...defaultDeps, ...deps };
  const cmd = new Command("conversation").description("Conversation operations");

  cmd
    .command("create")
    .description("Create a new group conversation")
    .option("--name <name>", "Group name")
    .option("--members <inboxIds>", "Comma-separated member inbox IDs")
    .option("--as <label>", "Identity label to create as")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (options) => {
      const json = options.json === true;
      const members = typeof options.members === "string"
        ? options.members.split(",").map((s: string) => s.trim())
        : [];

      const result = await d.withDaemonClient(
        { configPath: options.config },
        (client) =>
          client.request("conversation.create", {
            name: options.name,
            memberInboxIds: members,
            creatorIdentityLabel: options.as,
          }),
      );

      if (result.isErr()) {
        d.writeStderr(formatOutput({ error: result.error.message }, { json }) + "\n");
        d.exit(exitCodeFromCategory(result.error.category));
        return;
      }
      d.writeStdout(formatOutput(result.value, { json }) + "\n");
    });

  // ... list and info follow the same pattern ...

  return cmd;
}
```

**`packages/cli/src/runtime.ts`** — Register conversation ActionSpecs:

```typescript
// After session actions registration:
import { createConversationActions } from "@xmtp-broker/core";

for (const spec of createConversationActions({ core: coreImpl })) {
  registry.register(spec);
}
```

> **Note:** This requires `coreImpl` (the `BrokerCoreImpl` instance) rather
> than the `BrokerCore` contract adapter. The adapter in `start.ts` creates
> `BrokerCoreImpl` internally (line 124). Either expose it, or pass the impl
> into the runtime as a separate dependency.

**`packages/core/src/__tests__/conversation-actions.test.ts`** — Tests using
mocked `BrokerCoreImpl` with mock `XmtpClient`:

- Create group with members → returns groupId and member count
- Create group with empty members → succeeds (creator-only group)
- Create group registers groupId in managed client's set
- List groups delegates to SDK client
- Group info returns member details
- `creatorIdentityLabel` selects the correct identity
- Unknown label returns `NotFoundError`

**Success gate:** `conversation create --name "test" --members <bob-inbox-id>
--as alice` creates a real group on devnet. `conversation list` shows it.
`conversation info <group-id>` shows both alice and bob as members.

---

## Step 3b: Convos Join Protocol (Flow A — User Invites Broker)

**Branch:** `v0/convos-join`
**Scope:** `packages/core/`, `packages/cli/`
**Estimated size:** ~350 LOC

### Problem

Convos users share invite links, not inbox IDs. The broker needs to parse
a Convos invite URL (`popup.convos.org/v2?i=<base64url-protobuf>`) and
follow the Convos join protocol to enter an existing conversation.

Example invite URL from production:
```
https://popup.convos.org/v2?i=Cm8KPwET31HR_I4wpf7qBc3HSMjBTTUYUebjLSUMoR_IhzXE5o-XDwn13fgW1bRr8y-FD99rZjOVpur8-yS9SkDWAxIgPzfzZX5NcRK7Fk1inZn0GntX-a9UYLGGVQo5-6GUg5UaClpub0ZnbnBTcWgSQVIYxct-vKqL-1q7qRLplI-NdlAylAoINg6NzEpeL2hYCd470sEdotgkF08y2VX-WwaRr0hMTdYQh17ojgewVd4B
```

### Research Needed (Before Implementation)

The exact invite tag format and join protocol must be extracted from the
reference codebases. Key files to study:

**`.reference/convos-node-sdk/`:**
- `src/conversations/join.ts` — the full join flow
- `src/identities.ts` — identity creation and invite tag storage
- `src/client.ts` — how clients are created per-conversation
- `src/conversations/create.ts` — how `appData.inviteTag` is set

**`.reference/convos-cli/`:**
- Look for `join` command and how it consumes invite URLs
- How the CLI parses the `?i=` parameter

Specific questions to answer:

1. What is the protobuf schema for the invite tag? (or is it a different
   binary format?)
2. What fields does it contain? (creator inbox ID, group ID, encryption
   key, nonce?)
3. What is the DM-based join handshake? (joiner sends DM → creator adds
   joiner → joiner verifies?)
4. How does `disableDeviceSync: true` affect the join flow?
5. Is the join protocol symmetric (both sides use same SDK methods)?

### Anticipated Changes

**`packages/core/src/convos/invite-parser.ts`** — New file. Parse Convos
invite URLs:

```typescript
export interface ConvosInvite {
  readonly raw: string;           // original URL
  readonly inviteTag: Uint8Array; // decoded binary tag
  readonly creatorInboxId: string;
  readonly groupId?: string;      // if embedded in tag
  // ... other fields TBD from research
}

export function parseConvosInviteUrl(
  url: string,
): Result<ConvosInvite, BrokerError>
```

**`packages/core/src/convos/join.ts`** — New file. Join protocol:

```typescript
export interface JoinConversationDeps {
  readonly identityStore: SqliteIdentityStore;
  readonly clientFactory: XmtpClientFactory;
  readonly signerProviderFactory: SignerProviderFactory;
  readonly config: Pick<BrokerCoreConfig, "dataDir" | "env" | "appVersion">;
}

export interface JoinResult {
  readonly identityId: string;
  readonly inboxId: string;
  readonly groupId: string;
  readonly memberCount: number;
}

/**
 * Join a Convos conversation via invite URL.
 *
 * 1. Parse invite tag from URL
 * 2. Create new broker identity for this conversation
 * 3. Send DM to creator's inbox (join request)
 * 4. Poll until creator adds broker to the group
 * 5. Verify invite tag matches group's appData
 * 6. Return joined group info
 */
export async function joinConversation(
  deps: JoinConversationDeps,
  inviteUrl: string,
  options?: { label?: string; timeoutMs?: number },
): Promise<Result<JoinResult, BrokerError>>
```

**`packages/cli/src/commands/conversation.ts`** — Add `conversation join`:

```
conversation join <invite-url> [--label <name>] [--config <path>] [--json] [--timeout <seconds>]
```

This is a daemon-bound command (needs running broker with network access).
The join may take several seconds as it waits for the creator to add the
broker.

### Key Decision: Per-Conversation Identity

Following the Convos pattern (ADR 002), the broker creates a **new identity
for each conversation it joins**. This means:

- Each joined conversation gets its own wallet address, DB, and SDK client
- The creator sees a unique inbox ID for the broker in each group
- Identity isolation prevents cross-conversation correlation

This aligns with the broker's existing `per-group` identity mode and the
`IdentityStore.create(groupId)` method.

**Success gate:** `conversation join <convos-invite-url>` parses the invite,
creates a broker identity, follows the join protocol, and the broker appears
as a member in the Convos conversation. The user sees the broker in their
Convos app.

---

## Step 3c: Convos-Compatible Invite Generation (Flow B — Broker Invites User)

**Branch:** `v0/convos-invite`
**Scope:** `packages/core/`, `packages/cli/`
**Estimated size:** ~250 LOC

### Problem

When the broker creates a group and wants a Convos user to join, it needs
to generate an invite URL in the same format that Convos understands:
`popup.convos.org/v2?i=<base64url-protobuf>`.

### Research Needed (Before Implementation)

From `.reference/convos-node-sdk/`:

- `src/conversations/create.ts` — how the invite tag is generated at group
  creation time
- How `appData.inviteTag` is set on the group
- The exact binary encoding of the invite tag

### Anticipated Changes

**`packages/core/src/convos/invite-generator.ts`** — New file. Generate
Convos-compatible invite URLs:

```typescript
export interface GenerateInviteInput {
  readonly groupId: string;
  readonly creatorInboxId: string;
  // ... other fields TBD from research
}

export function generateConvosInviteUrl(
  input: GenerateInviteInput,
): Result<string, BrokerError>
```

**`packages/cli/src/invite/qr.ts`** — Terminal QR renderer (already planned):

```typescript
import QRCode from "qrcode";

export async function renderQrToTerminal(data: string): Promise<string> {
  return QRCode.toString(data, {
    type: "terminal",
    errorCorrectionLevel: "M",
    margin: 1,
  });
}
```

**`packages/cli/src/commands/conversation.ts`** — Update `conversation invite`
to generate Convos-compatible URLs and render as QR:

```
conversation invite <group-id> [--as <label>] [--config <path>] [--format link|qr|both] [--json]
```

Output: a `popup.convos.org/v2?i=...` URL that Convos can open, rendered
as a scannable QR code in the terminal.

**Success gate:** `conversation invite <group-id>` generates a valid
Convos invite URL. Scanning the terminal QR code in Convos opens the
join flow and the user successfully joins the broker's group.

---

## Step 4: Dev Network Tracer Bullet

**Branch:** `v0/dev-tracer-bullet`
**Scope:** `.claude/skills/tracer-bullet/`, `packages/cli/src/__tests__/`
**Estimated size:** ~200 LOC

### Problem

The Phase 2B tracer bullet runs in local mode. It proves permission
enforcement and daemon lifecycle but can't send real messages. With Steps 1-3
complete, we can now run a full end-to-end tracer bullet against devnet.

### Changes

**Update tracer bullet skill** — Add a new story "Dev Network" to the tracer
bullet skill definition in `.claude/skills/tracer-bullet/SKILL.md`:

| Option | Story | Needs |
|--------|-------|-------|
| **Dev network** | dual-identity init → broker start → create group → session issue → WS send → receive → stop | Network access |

**New story: Dev Network**

```
 1. Create test environment (config with env: "dev", temp dirs)
 2. identity init --env dev --label alice --config {config} --json
 3. identity init --env dev --label bob --config {config} --json
 4. Verify: two distinct inbox IDs returned
 5. broker start --config {config} --json (background)
 6. Wait for daemon ready + core state "running" (poll broker status)
 7. broker status --config {config} --json → verify 2 identities connected
 8. conversation create --name "tracer-test" --members {bob_inbox_id} --as alice --config {config} --json
 9. conversation list --config {config} --json → verify group exists
10. Generate view.json scoped to the created group:
    { "groups": ["{group_id}"], "contentTypes": ["xmtp.org/text:1.0"] }
11. Generate grant.json allowing send_message:
    { "actions": ["send_message"], "rateLimit": null }
12. session issue --config {config} --agent {alice_inbox_id} --view @view.json --grant @grant.json --json
13. Connect WebSocket with session token
14. Send auth frame → verify authenticated
15. Send send_message to the created group → expect success with messageId
16. Verify: message appears in broker's event stream (or poll conversation)
17. session issue for bob → connect second WS → verify bob receives the message
18. broker stop --config {config} --json
19. Verify: clean shutdown, PID file removed
```

**Config template for dev network:**

```toml
[broker]
env = "dev"

[broker.ws]
host = "127.0.0.1"
port = 0

[paths]
data_dir = "{test_dir}/data"
runtime_dir = "{test_dir}/runtime"
state_dir = "{test_dir}/state"
```

**`packages/cli/src/__tests__/dev-network.test.ts`** — Automated smoke test:

```typescript
import { describe, test, expect } from "bun:test";
import { $ } from "bun";

const CLI = "packages/cli/src/bin.ts";

describe.skipIf(!process.env.XMTP_NETWORK_TESTS)(
  "dev network smoke",
  () => {
    // ... test implementation matching tracer bullet steps ...
  },
);
```

Excluded from default test runs — only runs when `XMTP_NETWORK_TESTS=1`.
Timeout: 60 seconds.

**Success gate:** The dev network tracer bullet passes end-to-end. Alice
sends a message through the broker, and it's deliverable on the XMTP network.
Bob's identity (in the same broker) receives it via the group stream.

---

## Step 5: Production Tracer Bullet & External Client Join

**Branch:** `v0/prod-tracer-bullet`
**Scope:** `packages/cli/`, `.claude/skills/tracer-bullet/`
**Estimated size:** ~250 LOC

### Problem

The dev network tracer bullet proves the broker can talk to itself. But the
whole point of the broker is to participate in real XMTP conversations with
external clients — Convos, other agents, custom apps. We need to prove the
broker can create a group that a real XMTP app can join and exchange messages
with, on production.

### Changes

**`packages/cli/src/invite/qr.ts`** — Terminal QR code renderer:

```typescript
import QRCode from "qrcode";

/**
 * Render a QR code to the terminal using Unicode block characters.
 *
 * Uses the `qrcode` package (MIT, well-maintained) which generates
 * QR codes and has built-in terminal string output using Unicode
 * upper/lower half-block characters (▀ ▄ █ spaces).
 *
 * The result is a compact, scannable QR code that renders in any
 * terminal supporting Unicode.
 */
export async function renderQrToTerminal(data: string): Promise<string> {
  // qrcode.toString with "terminal" type renders using ANSI escape codes
  // for colored blocks — works in iTerm2, Terminal.app, VS Code terminal.
  // "utf8" type uses Unicode block chars (█▀▄) but "terminal" has better
  // contrast and scannability.
  return QRCode.toString(data, {
    type: "terminal",
    errorCorrectionLevel: "M",
    margin: 1,
  });
}

/**
 * Generate a QR code as a base64-encoded PNG data URL.
 * Useful for --json output or embedding in HTML.
 */
export async function renderQrToDataUrl(data: string): Promise<string> {
  return QRCode.toDataURL(data, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 256,
  });
}
```

Add `qrcode` to `packages/cli/package.json` dependencies and to the blessed
dependencies list in `CLAUDE.md`:

```
| QR codes        | `qrcode`                    |
```

> **Why `qrcode`?** QR encoding involves Reed-Solomon error correction,
> binary matrix layout, masking pattern selection, and format/version
> encoding. This is ~2k LOC of non-trivial math. The `qrcode` package is
> MIT-licensed, 100M+ weekly downloads, zero native deps, and has built-in
> `toString("utf8")` that renders directly to the terminal using Unicode
> half-block characters (▀▄█). It's the right tool.

**`packages/cli/src/commands/conversation.ts`** — Add `conversation invite`:

```typescript
cmd
  .command("invite")
  .description("Generate an invite link/QR for a group")
  .argument("<group-id>", "Group conversation ID")
  .option("--as <label>", "Identity label")
  .option("--config <path>", "Path to config file")
  .option("--format <type>", "Output format: link, qr, or both", "both")
  .option("--json", "JSON output")
  .action(async (groupId, options) => {
    const json = options.json === true;
    const format = options.format ?? "both";

    // Get group info via daemon to build the invite payload
    const result = await d.withDaemonClient(
      { configPath: options.config },
      async (client) => {
        const info = await client.request<{
          groupId: string;
          name: string;
          memberInboxIds: string[];
        }>("conversation.info", { groupId });
        return info;
      },
    );

    if (result.isErr()) {
      d.writeStderr(formatOutput({ error: result.error.message }, { json }) + "\n");
      d.exit(exitCodeFromCategory(result.error.category));
      return;
    }

    const group = result.value;

    // No standard XMTP deep link exists. Convos uses app-specific
    // converse.xyz/invite/<id> with opaque backend-generated IDs.
    // We encode a JSON payload with the group ID and broker inbox ID.
    // The QR is scannable as text; the operator uses the group ID to
    // join via their XMTP app, or adds themselves via broker CLI.
    const invitePayload = JSON.stringify({
      type: "xmtp-broker-invite",
      groupId: group.groupId,
      name: group.name,
    });
    // The QR encodes this JSON payload as plain text
    const inviteData = invitePayload;

    if (json) {
      const { renderQrToDataUrl } = await import("../invite/qr.js");
      const qrDataUrl = await renderQrToDataUrl(inviteData);
      d.writeStdout(formatOutput({
        groupId: group.groupId,
        name: group.name,
        inviteData,
        qrDataUrl,
      }, { json }) + "\n");
      return;
    }

    // Human output
    if (format === "link" || format === "both") {
      d.writeStdout(`\nGroup: ${group.name ?? group.groupId}\n`);
      d.writeStdout(`Link:  ${inviteData}\n`);
      d.writeStdout(`ID:    ${group.groupId}\n\n`);
    }

    if (format === "qr" || format === "both") {
      const { renderQrToTerminal } = await import("../invite/qr.js");
      const qr = await renderQrToTerminal(inviteData);
      d.writeStdout(qr + "\n");
      d.writeStdout("Scan with your XMTP app to join this conversation.\n\n");
    }
  });
```

**`packages/cli/src/commands/conversation.ts`** — Add `conversation members`:

```typescript
cmd
  .command("members")
  .description("List group members")
  .argument("<group-id>", "Group conversation ID")
  .option("--config <path>", "Path to config file")
  .option("--json", "JSON output")
  .option("--watch", "Poll for membership changes")
  .action(async (groupId, options) => {
    const json = options.json === true;

    if (options.watch) {
      // Poll every 2 seconds, print when membership changes
      let lastMembers: string[] = [];
      const poll = async () => {
        const result = await d.withDaemonClient(
          { configPath: options.config },
          (client) => client.request<{ memberInboxIds: string[] }>(
            "conversation.info", { groupId },
          ),
        );
        if (result.isOk()) {
          const current = result.value.memberInboxIds.sort();
          if (JSON.stringify(current) !== JSON.stringify(lastMembers)) {
            lastMembers = current;
            d.writeStdout(formatOutput({
              memberCount: current.length,
              members: current,
              timestamp: new Date().toISOString(),
            }, { json }) + "\n");
          }
        }
      };
      await poll();
      const interval = setInterval(poll, 2000);
      // Clean up on SIGINT
      process.on("SIGINT", () => { clearInterval(interval); process.exit(0); });
      return;
    }

    // One-shot member list
    const result = await d.withDaemonClient(
      { configPath: options.config },
      (client) => client.request("conversation.info", { groupId }),
    );
    // ... format and print ...
  });
```

**Update tracer bullet skill** — Add "Production" story:

| Option | Story | Needs |
|--------|-------|-------|
| **Production** | identity init (prod) → broker start → create group → generate invite QR → operator joins from external app → exchange messages → stop | Network + external XMTP app |

**New story: Production**

```
 1. Create test environment (config with env: "production", temp dirs)
 2. identity init --env production --label broker-agent --config {config} --json
 3. broker start --config {config} --json (background)
 4. Wait for daemon ready + core state "running"
 5. PAUSE: Ask operator for their XMTP inbox ID (displayed in their app)
    → Or the operator can provide an Ethereum address for lookup
 6. conversation create --name "broker-test-{date}" --members {operator_inbox_id} --config {config} --json
    → Creates group with both broker and operator as members
 7. conversation invite {group_id} --format both --config {config}
    → Displays QR code (JSON payload with group ID) and group info
    → Operator sees the group appear in their XMTP app automatically
 8. session issue --config {config} --agent {broker_inbox_id} --view @{view} --grant @{grant} --json
 9. Connect WebSocket with session token
10. Send send_message "Hello from the broker!" to the group
    → Operator sees the message in their XMTP app
11. PAUSE: Operator sends a reply from their XMTP app
    → The tracer bullet polls broker status or uses the WS event
      stream until a message from a non-broker inbox arrives,
      with a 120-second timeout
12. Verify: broker received the external message via event stream
13. broker stop --config {config} --json
14. Verify: clean shutdown
```

### Key Decisions

**QR codes in the terminal.** The `qrcode` package's `toString("utf8")`
renders using Unicode half-block characters (▀ ▄ █), producing a compact
scannable code in ~20 rows. This works in any modern terminal (iTerm2,
Terminal.app, VS Code integrated terminal, etc.). The QR encodes whatever
join URL the XMTP ecosystem supports.

**Interactive production tracer.** Unlike the dev tracer (fully automated),
the production tracer requires a human with an XMTP app. It polls for state
changes rather than blocking indefinitely. If the operator doesn't
participate within 120 seconds, the story reports what happened and what
was expected, rather than failing.

**No standard XMTP deep link exists.** Convos uses an app-specific
`converse.xyz/invite/<id>` format with opaque backend-generated IDs — not
reusable. The QR encodes a JSON payload with the group ID and group name.
The operator uses this to locate the group in their XMTP app. The practical
join flow is: broker creates group → broker adds operator's inbox ID via
`conversation add-member` → operator sees the group appear in their app.
The QR/invite is a convenience for sharing the group reference.

**Success gate:** The production tracer bullet creates a group, renders a
scannable QR code in the terminal, the operator joins from an external XMTP
app, the broker sends a message that appears in the app, and the operator's
reply is received by the broker's event stream.

---

## Step 6: Convos Tracer Bullet

**Branch:** `v0/convos-tracer`
**Scope:** `.claude/skills/tracer-bullet/`, `packages/cli/`
**Estimated size:** ~150 LOC (tracer story + skill update)
**Depends on:** Steps 3b and 3c (Convos join + invite generation)

### Problem

The production tracer (Step 5) uses direct inbox IDs, which works for
SDK-to-SDK testing but doesn't match how real Convos users interact. This
tracer proves both Convos conversation flows end-to-end on production.

### Two Sub-Stories

#### Story A: "Join my chat" (user invites broker)

```
 1. Create test environment (config with env: "production", temp dirs)
 2. identity init --env production --label convos-joiner --config {config} --json
 3. broker start --config {config} --json (background)
 4. Wait for daemon ready + core state "running"
 5. PAUSE: Operator shares a Convos invite link
    → Use AskUserQuestion: "Paste a Convos invite URL (popup.convos.org/v2?i=...)"
 6. conversation join {invite_url} --label convos-joiner --config {config} --json
    → Broker parses invite, creates per-conversation identity, follows join protocol
    → Operator sees the broker appear as a new member in Convos
 7. session issue --config {config} --agent {joiner_inbox_id} --view @{view} --grant @{grant} --json
    (view scoped to the joined group)
 8. Connect WebSocket with session token
 9. Send send_message "Hello from the broker!" to the joined group
    → Operator sees the message in Convos
10. PAUSE: Operator sends a reply
    → Poll WS event stream until message from non-broker inbox arrives (120s timeout)
11. Verify: broker received the external message
12. broker stop --config {config} --json
13. Verify: clean shutdown
```

#### Story B: "Join the agent's chat" (broker invites user)

```
 1. Create test environment (config with env: "production", temp dirs)
 2. identity init --env production --label convos-host --config {config} --json
 3. broker start --config {config} --json (background)
 4. Wait for daemon ready + core state "running"
 5. conversation create --name "broker-hosted-{date}" --config {config} --json
    → Broker creates an empty group (creator only)
 6. conversation invite {group_id} --format both --config {config}
    → Generates Convos-compatible invite URL (popup.convos.org/v2?i=...)
    → Renders QR code in terminal
    → Prints: "Scan with Convos to join this conversation"
 7. PAUSE: Operator scans QR or opens invite link in Convos
    → Poll conversation members until member count > 1 (120s timeout)
 8. Verify: operator appears as group member
 9. session issue --config {config} --agent {host_inbox_id} --view @{view} --grant @{grant} --json
10. Connect WebSocket with session token
11. Send send_message "Welcome! You joined the broker's chat." to the group
    → Operator sees the message in Convos
12. PAUSE: Operator sends a reply
    → Poll until message from non-broker inbox arrives (120s timeout)
13. Verify: broker received the external message
14. broker stop --config {config} --json
15. Verify: clean shutdown
```

### Tracer Bullet Skill Update

Add to the story picker in `.claude/skills/tracer-bullet/SKILL.md`:

| Option | Story | Needs |
|--------|-------|-------|
| **Convos: join** | Operator shares Convos invite → broker joins → exchange messages | Production + Convos app |
| **Convos: host** | Broker creates group → QR code → operator joins from Convos → exchange messages | Production + Convos app |
| **Convos: both** | Run join then host in sequence | Production + Convos app |

Both stories are interactive (require operator with Convos). Timeouts are
120 seconds per pause. Stories report "timed out waiting for operator"
rather than failing if the operator doesn't participate.

**Success gate:**
- Story A: Broker joins a Convos-created conversation via invite URL and
  exchanges messages with the operator.
- Story B: Operator joins a broker-created conversation via QR code and
  exchanges messages with the broker.

---

## Key Design Decisions

### Registration happens during `identity init`, not lazily

The operator explicitly creates and registers identities. This gives them the
inbox ID immediately (needed to be invited to groups), surfaces network errors
early, and keeps `broker start` focused on runtime lifecycle.

### Graceful degradation on network failure

`broker start` attempts `core.initialize()` but falls back to `local` state
if the network is unreachable. The daemon is still useful for admin
operations, and the WS handler's `ensureCoreReadySingleFlight()` can retry
later.

### Inbox ID as primary member identifier

Groups are created with inbox IDs, not Ethereum addresses. This matches the
XMTP MLS model where inbox IDs are the stable, canonical identifier.

### Dev then production

Steps 1-4 target devnet for automated, self-contained testing. Step 5
switches to production for real-world interop with external XMTP apps.
The architecture supports all three environments with no code changes —
it's a config switch (`--env production`).

### No per-group identity orchestration yet

Phase 2C uses `shared` identity mode for simplicity: each `identity init`
creates one identity that's used across all groups that identity participates
in. Full per-group identity orchestration (auto-creating new identities when
joining groups) is a Phase 3 concern.

### Conversation commands are ActionSpecs

Conversation operations follow the same `ActionSpec` → `ActionRegistry` →
`AdminDispatcher` → `AdminClient` pattern as session commands. This means
they're automatically available via JSON-RPC over the admin socket, and
will be available via MCP when the MCP transport is wired.

---

## File Summary

| Step | New Files | Modified Files |
|------|-----------|----------------|
| 1 | `core/src/identity-registration.ts`, `core/src/__tests__/identity-registration.test.ts` | `core/src/identity-store.ts`, `cli/src/commands/identity.ts` |
| 2 | `cli/src/__tests__/network-startup.test.ts` | `cli/src/runtime.ts`, `cli/src/daemon/status.ts`, `cli/src/start.ts` |
| 3 | `core/src/conversation-actions.ts`, `core/src/__tests__/conversation-actions.test.ts` | `core/src/xmtp-client-factory.ts`, `core/src/sdk/sdk-client.ts`, `cli/src/commands/conversation.ts`, `cli/src/runtime.ts` |
| 3b | `core/src/convos/invite-parser.ts`, `core/src/convos/join.ts`, `core/src/__tests__/convos-join.test.ts` | `cli/src/commands/conversation.ts` |
| 3c | `core/src/convos/invite-generator.ts`, `cli/src/invite/qr.ts`, `core/src/__tests__/convos-invite.test.ts` | `cli/src/commands/conversation.ts`, `cli/package.json` |
| 4 | `cli/src/__tests__/dev-network.test.ts` | `.claude/skills/tracer-bullet/SKILL.md` |
| 5 | — | `cli/src/commands/conversation.ts`, `.claude/skills/tracer-bullet/SKILL.md` |
| 6 | — | `.claude/skills/tracer-bullet/SKILL.md` |

**Total:** ~1900 LOC across 8 steps (6 numbered, 3a/3b/3c as sub-steps).

## Gotchas

- **SDK method verified.** The Node.js SDK uses
  `client.conversations.createGroup(inboxIds: string[], opts?)` with plain
  inbox ID strings. The `createGroupWithIdentifiers()` method with typed
  identifier objects is React Native / Kotlin / Swift only. The `SdkClient`
  wrapper in Step 3 uses the correct Node.js API.
- **Network latency.** Devnet operations (registration, group creation, sync)
  take 1-5 seconds each. Tests need appropriate timeouts (60s for suites).
- **Identity cleanup.** Devnet identities persist across runs. The tracer
  bullet creates fresh identities each run. Accept accumulation on devnet;
  production identities should be reused.
- **Signer provider `getOrCreate` pattern.** The key manager's
  `getOrCreateDbKey()` and `getOrCreateXmtpIdentityKey()` methods generate
  keys on first call and persist them in the vault. This means calling
  `registerIdentity()` for a new identity ID automatically provisions the
  required cryptographic material. No separate key generation step is needed.
- **`identity init` constructs deps without a daemon.** It creates
  `SqliteIdentityStore`, `SdkClientFactory`, and `SignerProviderFactory`
  directly (same pattern as `start.ts` but without the daemon lifecycle).
  The key manager is already alive at that point.
- **`BrokerCoreImpl` private fields.** The conversation actions need access to
  `#registry` and `identityStore`. The `identityStore` is already public
  (line 80). The registry needs a public accessor or a
  `getManagedClient(identityId)` method added to `BrokerCoreImpl`.
- **Empty group creation.** We use the XMTP-JS pattern of adding members at
  creation time (simpler). The Convos pattern of empty genesis + invite flow
  is more complex and deferred.
- **Stream lag.** After creating a group or sending a message, the event
  stream may not deliver instantly. Tests should poll with a short interval
  (500ms) and a reasonable timeout (10s).
- **No standard XMTP deep link.** Verified: there is no protocol-level
  `xmtp://` URL scheme. Convos uses app-specific `converse.xyz/invite/<id>`.
  The QR encodes a JSON payload with group ID and name. The practical join
  flow uses `conversation add-member` to add the operator's inbox ID.
- **Production identity persistence.** Production identities are real and
  persistent. The production tracer bullet should reuse a stable identity
  (not create throwaway ones on each run).
- **`qrcode` package.** Added to blessed dependencies. It's MIT licensed,
  zero native deps, and provides `toString("utf8")` for terminal rendering.
  ~150KB installed size.
- **Interactive tracer timeouts.** The production tracer bullet polls for
  external client actions with a 120-second timeout. If the operator doesn't
  participate, it reports the step as "timed out waiting for operator" rather
  than failing the entire story.
