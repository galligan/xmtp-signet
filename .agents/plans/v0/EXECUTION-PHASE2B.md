# Phase 2B Execution Plan — Wiring & Tracer Bullet

**Version:** 1.1
**Created:** 2026-03-16
**Updated:** 2026-03-16
**Status:** Adjusted after implementation review
**Prerequisite:** Phase 2 PRs #13–#25 merged or on top of stack

## Overview

Phase 2A built the packages. Phase 2B wires them into a working end-to-end
system. The goal is a deterministic local tracer bullet:

`identity init` -> `broker start` -> `admin token` -> `session issue` ->
WebSocket auth -> denied `send_message` -> routed `send_message` ->
`broker stop`

Phase 2B also proves a second startup property:

`broker start` can boot from an empty data directory into local-ready daemon
mode without pre-created XMTP/admin credentials.

This revision tightens a few seams that the first draft left underspecified:

- Session issuance returns a new `IssuedSession` credential shape, not the
  existing `SessionToken` metadata shape.
- The runtime creates a real `SessionManager` service/adapter rather than
  casting `InternalSessionManager` to the contract.
- The action registry is populated before the admin dispatcher/server is built.
- The Phase 2B WebSocket handler is intentionally tracer-bullet minimum:
  `send_message` + `heartbeat`. `send_reply` / `send_reaction` are an explicit
  follow-up once payload synthesis and draft-only flow are wired correctly.

All work happens on the existing stack (absorb into correct branches or add new
branches on top).

```text
v0/phase2-docs (current top)
  └── v0/lazy-core            Step 1: two-phase BrokerCore init
       └── v0/session-actions  Step 2: session service + ActionSpecs
            └── v0/admin-auth-helper  Step 3: shared createAuthenticatedClient
                 └── v0/cli-wiring    Step 4: wire CLI commands to AdminClient
                      └── v0/ws-request-handler  Step 5: wire WS requestHandler
                           └── v0/tracer-smoke   Step 6: tracer bullet verification
```

## Step 1: Lazy BrokerCore Init

**Branch:** `v0/lazy-core`
**Scope:** `packages/contracts/`, `packages/core/`, `packages/cli/`
**Estimated size:** ~140 LOC

### Changes

**`packages/contracts/src/core-types.ts`** — Add `"ready-local"` to `CoreState`:

```typescript
export type CoreState =
  | "uninitialized"
  | "initializing"
  | "ready-local"
  | "ready"
  | "shutting-down"
  | "stopped"
  | "error";
```

**`packages/contracts/src/services.ts`** — Add `initializeLocal()` to
`BrokerCore`:

```typescript
interface BrokerCore {
  readonly state: CoreState;
  initializeLocal(): Promise<Result<void, BrokerError>>;
  initialize(): Promise<Result<void, BrokerError>>;
  shutdown(): Promise<Result<void, BrokerError>>;
  getGroupInfo(groupId: string): Promise<Result<GroupInfo, BrokerError>>;
}
```

**`packages/core/src/broker-core.ts`** — Add `"local"` to `BrokerState` and a
real local-only startup path:

- `startLocal()` opens the identity store and sets state to `"local"`.
- `start()` accepts `"idle"` and `"local"` as valid starting states.
- `stop()` accepts `"local"`, `"running"`, and `"error"`.
- No XMTP clients are created during `startLocal()`.

**`packages/cli/src/start.ts`** — Update the adapter from `BrokerCoreImpl` to
the contract:

- Map `"local"` -> `"ready-local"`.
- Expose `initializeLocal()` on the adapter.
- Capture `coreContextRef` for later WS request handling.

**`packages/cli/src/runtime.ts`** — Make runtime startup genuinely two-phase:

1. Initialize the key manager.
2. `core.initializeLocal()`.
3. Build the action registry.
4. Start the WS server.
5. Start the admin server.
6. Best-effort `core.initialize()`; log warning on failure and continue.

Runtime semantics:

- Daemon startup succeeds if the broker reaches local-ready and both servers are
  listening.
- Runtime state is still `running` even if the core is only `"ready-local"`.
- Shutdown works even if the core never reached full `"ready"`.
- Empty-dir boot is valid: startup may create local runtime artifacts
  (directories, vault/root state), but it does not auto-create admin keys,
  operational keys, or XMTP identities.

**Success gate:** `broker start` succeeds without XMTP network access, and both
the admin socket and WS port are listening, including when the data directory
starts empty.

---

## Step 2: Session Service & ActionSpecs

**Branch:** `v0/session-actions`
**Scope:** `packages/schemas/`, `packages/contracts/`, `packages/sessions/`,
`packages/cli/`
**Estimated size:** ~320 LOC

### Changes

**`packages/schemas/src/session.ts`** — Add a distinct issuance response type:

```typescript
export type IssuedSession = {
  token: string;
  session: SessionToken;
};
```

Why: `SessionToken` is already used as session metadata in authenticated broker
events. The one-time bearer credential returned by `session.issue` must not be
smuggled into that shape.

**`packages/contracts/src/services.ts`** — Fix the `SessionManager` contract so
it matches real service behavior:

```typescript
interface SessionManager {
  issue(config: SessionConfig): Promise<Result<IssuedSession, BrokerError>>;
  list(
    agentInboxId?: string,
  ): Promise<Result<readonly SessionRecord[], BrokerError>>;
  lookup(sessionId: string): Promise<Result<SessionRecord, BrokerError>>;
  lookupByToken(token: string): Promise<Result<SessionRecord, BrokerError>>;
  revoke(
    sessionId: string,
    reason: SessionRevocationReason,
  ): Promise<Result<void, BrokerError>>;
  heartbeat(sessionId: string): Promise<Result<void, BrokerError>>;
  isActive(sessionId: string): Promise<Result<boolean, BrokerError>>;
}
```

**`packages/sessions/src/session-manager.ts`** — Extend the internal store API:

- `createSession(config, sessionKeyFingerprint, options?: { sessionId?: string })`
- `listSessions(agentInboxId?: string): readonly InternalSessionRecord[]`

Why: the public session service needs to generate a session ID up front so the
daemon can issue the session key itself and bind it to the same ID.

**New file: `packages/sessions/src/service.ts`**

```typescript
export interface SessionServiceDeps {
  readonly manager: InternalSessionManager;
  readonly keyManager: Pick<KeyManager, "issueSessionKey">;
}

export function createSessionService(
  deps: SessionServiceDeps,
): SessionManager
```

Implementation outline:

1. Generate `sessionId`.
2. `keyManager.issueSessionKey(sessionId, ttlSeconds)`.
3. `manager.createSession(config, sessionKey.fingerprint, { sessionId })`.
4. Map the internal record to:
   - `IssuedSession` for `issue`
   - `SessionRecord` for `list` / `lookup`
5. Delegate `lookupByToken`, `revoke`, `heartbeat`, `isActive`.

This removes the unsafe cast currently in the production runtime.

**New file: `packages/sessions/src/actions.ts`**

```typescript
export interface SessionActionDeps {
  readonly sessionManager: SessionManager;
}

export function createSessionActions(
  deps: SessionActionDeps,
): ActionSpec<unknown, unknown, BrokerError>[]
```

Four ActionSpecs for Phase 2B:

| Action ID | Handler | Input Schema | Output | CLI Surface | MCP Surface |
|-----------|---------|--------------|--------|-------------|-------------|
| `session.issue` | `sessionManager.issue(config)` | `{ agentInboxId, view, grant, ttlSeconds?, heartbeatInterval? }` | `IssuedSession` | `session:issue` | `broker/session/issue` |
| `session.list` | `sessionManager.list(agentInboxId?)` | `{ agentInboxId?: string }` | `SessionRecord[]` | `session:list` | `broker/session/list` |
| `session.inspect` | `sessionManager.lookup(sessionId)` | `{ sessionId }` | `SessionRecord` | `session:inspect` | `broker/session/inspect` |
| `session.revoke` | `sessionManager.revoke(sessionId, reason)` | `{ sessionId, reason }` | `{ revoked: true }` | `session:revoke` | `broker/session/revoke` |

**New file: `packages/cli/src/actions/broker-actions.ts`**

```typescript
export interface BrokerActionDeps {
  readonly status: () => DaemonStatus;
  readonly shutdown: () => Promise<Result<void, BrokerError>>;
}

export function createBrokerActions(
  deps: BrokerActionDeps,
): ActionSpec<unknown, unknown, BrokerError>[]
```

Two ActionSpecs:

| Action ID | Handler | Output |
|-----------|---------|--------|
| `broker.status` | `deps.status()` | `DaemonStatus` |
| `broker.stop` | `deps.shutdown()` | `{ stopped: true }` |

**`packages/cli/src/daemon/status.ts`** — Extend `DaemonStatus` to expose
`coreState` alongside daemon state so local-ready vs fully-ready is visible.

**`packages/cli/src/runtime.ts`** — Create and register everything in the right
order:

- Add `status(): DaemonStatus` to `BrokerRuntime`.
- Build `DaemonStatus` from:
  - runtime state
  - `core.state`
  - `wsServer.connectionCount`
  - active session count
  - config/env/version
  - `process.uptime()`

```typescript
const internalSessionManager = createInternalSessionManager(...);
const sessionManager = createSessionService({
  manager: internalSessionManager,
  keyManager,
});

const registry = createActionRegistry();
let runtimeRef: BrokerRuntime | undefined;

for (const spec of createSessionActions({ sessionManager })) {
  registry.register(spec);
}

for (const spec of createBrokerActions({
  status: () => runtimeRef!.status(),
  shutdown: async () =>
    runtimeRef?.shutdown() ??
    Result.err(InternalError.create("runtime not ready")),
})) {
  registry.register(spec);
}

const dispatcher = createAdminDispatcher(registry);
const adminServer = deps.createAdminServer(..., { dispatcher, ... });

// ... build runtime ...
runtimeRef = runtime;
```

**Success gate:** `session.issue`, `session.list`, `session.inspect`,
`session.revoke`, `broker.status`, and `broker.stop` are all registered before
the admin server is constructed, and the runtime exposes a real
contract-conformant `SessionManager`.

---

## Step 3: Shared Admin Client Helper

**Branch:** `v0/admin-auth-helper`
**Scope:** `packages/cli/`
**Estimated size:** ~170 LOC

### Changes

**Modify: `packages/cli/src/admin/client.ts`**

Preserve structured broker errors instead of collapsing everything to
`InternalError`:

- Parse JSON-RPC error `data.category` and `data._tag` when present.
- Return `AuthError`, `NotFoundError`, `ValidationError`, or `InternalError`
  as appropriate.
- Keep transport failures (`ECONNREFUSED`, broken socket, parse failure) as
  `InternalError`.

This is required for correct CLI exit codes and for user-facing errors like
"broker not running" vs "auth failed."

**New file: `packages/cli/src/admin/authenticated-client.ts`**

```typescript
export interface AuthenticatedClientOptions {
  readonly configPath?: string;
  readonly ttlSeconds?: number;
}

export interface AuthenticatedClient {
  readonly client: AdminClient;
  readonly paths: ResolvedPaths;
  close(): Promise<void>;
}

export async function createAuthenticatedClient(
  options?: AuthenticatedClientOptions,
): Promise<Result<AuthenticatedClient, BrokerError>>
```

Sequence:

1. Load config.
2. Resolve paths.
3. Check admin socket exists.
4. Create key manager.
5. Initialize keys.
6. Check admin key exists.
7. Sign JWT.
8. Connect admin client.
9. Authenticate.

Error handling:

- Socket missing -> `NotFoundError` ("Broker daemon is not running")
- Admin key missing -> `NotFoundError` ("Run 'identity init' first")
- JWT rejected -> `AuthError`
- Stale socket / connect failure -> `InternalError`

### Also: `withDaemonClient` convenience wrapper

```typescript
export async function withDaemonClient<T>(
  options: { configPath?: string; json: boolean },
  fn: (client: AdminClient, paths: ResolvedPaths) => Promise<T>,
): Promise<T>
```

Responsibilities:

- Set up the authenticated client.
- Print broker errors with preserved categories.
- Map categories to exit codes.
- Ensure cleanup.

**Success gate:** `createAuthenticatedClient` connects to a running daemon, and
CLI callers can distinguish auth, not-found, validation, and transport errors.

---

## Step 4: Wire CLI Commands to AdminClient

**Branch:** `v0/cli-wiring`
**Scope:** `packages/cli/src/commands/`
**Estimated size:** ~220 LOC

### Changes

Wire these commands using `withDaemonClient`:

| Command | JSON-RPC Method | Response Type |
|---------|-----------------|---------------|
| `session list [--agent <id>]` | `session.list` | `SessionRecord[]` |
| `session issue --agent <id> --view ... --grant ...` | `session.issue` | `IssuedSession` |
| `session inspect <id>` | `session.inspect` | `SessionRecord` |
| `session revoke <id>` | `session.revoke` | `{ revoked: true }` |
| `broker status` | `broker.status` | `DaemonStatus` |
| `broker stop` | `broker.stop` | `{ stopped: true }` |

Each daemon-bound command gets `--config <path>` so it can target a temporary
or non-default daemon instance.

Each command flow:

1. Parse args.
2. `withDaemonClient(...)`
3. `client.request(method, params)`
4. Format output.

### `session issue`

Phase 2B keeps session policy explicit:

- `--agent` is required.
- `--view` is required.
- `--grant` is required.

Why: there is no safe implicit default view, because `ViewConfig` requires
concrete group/thread scope. Security-sensitive policy should be explicit until
we add dedicated CLI shorthands.

Parsing:

- Accept inline JSON.
- Accept `@filepath`.
- Parse with `JSON.parse` / `readFileSync + JSON.parse`.

Output:

- Default human output: print the bearer token only.
- `--json`: print the full `IssuedSession` object.

### `broker stop`

Special handling:

- Honor `--timeout`.
- Treat a dropped admin connection after the stop request is accepted as
  success, because the daemon is shutting down its own socket.

**Success gate:** daemon-bound commands use the shared auth helper; `session
issue` returns a usable bearer token; `broker status` reports daemon/core
readiness; `broker stop` works reliably.

---

## Step 5: Wire WS Request Handler

**Branch:** `v0/ws-request-handler`
**Scope:** `packages/cli/src/start.ts`
**Estimated size:** ~120 LOC

### Changes

Replace the stub `requestHandler` in
`createProductionDeps().createWsServer()` with a tracer-bullet minimum router:

```typescript
async requestHandler(request, session) {
  switch (request.type) {
    case "send_message":
      validateSendMessage(...)
      reject draftOnly for Phase 2B
      await ensureCoreReadySingleFlight()
      return coreContext.sendMessage(...)

    case "heartbeat":
      reject sessionId mismatch
      return sessionManager.heartbeat(session.sessionId)

    case "send_reply":
    case "send_reaction":
      return Result.err(
        InternalError.create("not implemented in Phase 2B"),
      )

    default:
      return Result.err(
        InternalError.create("not yet implemented"),
      )
  }
}
```

Implementation notes:

- Use `coreContextRef` alongside the existing `keyManagerRef` pattern.
- Add `ensureCoreReadySingleFlight()` in `start.ts`:
  - If core is already `"ready"`, return success.
  - If core is `"ready-local"`, attempt `core.initialize()`.
  - Coalesce concurrent retries behind one promise.
- `heartbeat` is bound to the authenticated session:
  - If `request.sessionId !== session.sessionId`, return `ValidationError`.
  - Otherwise record heartbeat on `session.sessionId`.
- `send_reply` / `send_reaction` are intentionally deferred. Their correct
  implementation requires payload synthesis for
  `xmtp.org/reply:1.0` / `xmtp.org/reaction:1.0` plus draft-only confirmation
  flow.

**Success gate:** WS harness can authenticate, heartbeat is recorded against the
authenticated session, an out-of-scope `send_message` fails with `permission`,
and an in-scope `send_message` gets past validation and reaches either lazy core
init or the core context.

---

## Step 6: Tracer Bullet Verification

**Branch:** `v0/tracer-smoke`
**Scope:** Test-only, no production code changes
**Estimated size:** ~90 LOC

Create `packages/cli/src/__tests__/smoke.test.ts` that runs the real tracer
bullet against a temp config:

1. Write a temp config file with dedicated paths and a free WS port.
2. `identity init --config <temp> --json`
3. `broker start --config <temp> --json` (background)
4. Wait for admin socket + WS listener.
5. `admin token --config <temp> --json`
6. `broker status --config <temp> --json`
7. `session issue --config <temp> --agent test-agent --view @view.json --grant @grant.json --json`
8. WebSocket connect to the configured URL with the returned bearer token.
9. Send out-of-scope `send_message` -> expect `permission`.
10. Send in-scope `send_message` -> expect non-validation response after routing
    (success, `not_found`, or `internal` depending on lazy core/XMTP state).
11. `broker stop --config <temp> --json`

Cleanup:

- If `broker stop` fails to fully terminate the process, send `SIGTERM` in test
  cleanup as a fallback only.

This test exercises real CLI/admin/WS wiring, not mocks.

**Success gate:** the tracer bullet proves both:

- Permission enforcement (`permission` on out-of-scope send)
- Routed execution beyond validation on allowed send

and shuts the daemon down cleanly through the admin path.

### Also: empty-dir boot smoke

Create `packages/cli/src/__tests__/empty-boot.test.ts` that verifies daemon
startup from a brand-new config/data dir:

1. Write a temp config file with dedicated paths and a free WS port.
2. Assert the data dir does not exist yet.
3. `broker start --config <temp> --json` (background)
4. Wait for admin socket + WS listener.
5. Verify status output from startup indicates daemon running.
6. Verify no admin key or operational identity has been implicitly created.
7. Stop the daemon via `SIGTERM` in test cleanup.

Why separate this from the tracer bullet:

- It keeps the tracer bullet deterministic and credentialed.
- It explicitly proves the daemon can boot before `identity init`.
- It avoids coupling the "boot from empty dir" property to admin-auth success.

**Success gate:** daemon boots from an empty dir, binds both transports, and
shuts down cleanly without requiring prior initialization.

---

## Key Design Decisions

### Session issuance returns `IssuedSession`

Keep `SessionToken` as session metadata. Add a separate `IssuedSession` shape
for the one-time bearer credential returned by `session.issue`:

```typescript
type IssuedSession = {
  token: string;
  session: SessionToken;
};
```

This avoids leaking bearer credentials into every place `SessionToken` is used
today (`AuthenticatedFrame`, handler SDK config, MCP startup config, etc.).

### Real session service, no unsafe cast

The runtime should create:

- `InternalSessionManager` for the in-memory store
- `SessionManager` service/adapter for transports and actions

The adapter owns session-key issuance and contract mapping. No `as unknown as
SessionManager`.

### Registry before dispatcher

The admin dispatcher snapshots the registry when it is constructed. Therefore:

1. Create registry
2. Register ActionSpecs
3. Create dispatcher
4. Create admin server

Any other order leaves methods unroutable.

### Phase 2B WS scope is intentionally narrow

The goal is a clean tracer bullet, not a half-correct full WS router. Phase 2B
implements:

- `send_message`
- `heartbeat`

and defers:

- `send_reply`
- `send_reaction`
- draft-only confirmation flow

until the payload and confirmation semantics are wired correctly.

### Tracer bullet proves permission + routing

The smoke test uses one session and two sends:

- out-of-scope send -> `permission`
- in-scope send -> routed beyond validation

This is stronger than "send one allowed request and hope it failed later."

### Empty-dir boot does not imply credential auto-provisioning

`broker start` should not silently create admin keys, operational keys, or XMTP
identities. The daemon may create local runtime storage needed to boot, but
credential/material initialization remains an explicit operator action.

Near-term command surface:

- `identity init` remains the explicit credential bootstrap path in Phase 2B.
- A top-level `xmtp-broker init` command is the intended follow-up UX that can
  wrap config/bootstrap/default setup once daemon wiring is stable.

---

## File Summary

| Step | New Files | Modified Files |
|------|-----------|----------------|
| 1 | — | `contracts/core-types.ts`, `contracts/services.ts`, `core/broker-core.ts`, `cli/start.ts`, `cli/runtime.ts` |
| 2 | `sessions/src/service.ts`, `sessions/src/actions.ts`, `cli/src/actions/broker-actions.ts` | `schemas/src/session.ts`, `contracts/services.ts`, `sessions/src/session-manager.ts`, `sessions/src/index.ts`, `cli/runtime.ts`, `cli/daemon/status.ts` |
| 3 | `cli/src/admin/authenticated-client.ts` | `cli/src/admin/client.ts` |
| 4 | — | `cli/src/commands/session.ts`, `cli/src/commands/broker.ts` |
| 5 | — | `cli/src/start.ts` |
| 6 | `cli/src/__tests__/smoke.test.ts` | — |

**Total:** ~1k LOC across 6 steps.

## Gotchas

- **`SessionManager.issue` should return `IssuedSession`**, not `SessionToken`.
- **No implicit default view in Phase 2B.** `session issue` must require
  `--view` because `ViewConfig` needs explicit scope.
- **Registry must be populated before dispatcher construction.**
- **Single-flight lock for lazy core init.** If two WS requests arrive while the
  core is `"ready-local"`, only one should call `initialize()`.
- **`broker.stop` via admin socket** may close the connection before the client
  reads the response. The command should treat that as success after the stop
  request is accepted.
- **`send_reply` / `send_reaction` are explicitly deferred.** Do not silently
  route malformed payloads in Phase 2B.
