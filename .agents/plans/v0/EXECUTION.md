# Phase 2 Execution Plan

**Version:** 1.0
**Created:** 2026-03-14
**Status:** Ready to execute

## Overview

This document is the step-by-step implementation guide for Phase 2. Each step produces a Graphite branch, is implemented by a subagent, reviewed, and submitted before the next step begins.

The full stack:

```
v0/docs (current top)
  └── v0/phase1-integration-tests   Step 0: validate Phase 1
       └── v0/action-registry        Step 1: ActionSpec, ActionResult, HandlerContext
            └── v0/sdk-integration   Step 2: wire @xmtp/node-sdk
                 └── v0/admin-keys   Step 3: admin key pair, JWT auth
                      └── v0/cli-scaffolding    Step 4a: package, config, paths
                           └── v0/cli-daemon     Step 4b: daemon lifecycle, PID, signals
                                └── v0/cli-admin-socket  Step 4c: Unix socket, JSON-RPC
                                     └── v0/cli-commands  Step 4d: 8 command groups
                                          └── v0/cli-direct-mode  Step 4e: direct client, fallback
                                               └── v0/cli-runtime  Step 4f: composition root
                                                    └── v0/mcp-transport  Step 5: MCP tools
                                                         └── v0/handler-sdk  Step 6: client SDK
```

Each branch = one commit. One commit per PR.

## Pre-Flight Checklist

Before starting any step, verify the baseline:

```bash
gt sync -f                    # sync with remote
bun run build                 # clean build
bun run test                  # all tests pass
bun run typecheck             # no type errors
bun run lint                  # no lint errors
```

If any check fails, fix it before proceeding.

## Agent Roles

### Implementer (subagent)

Each step dispatches an **implementer subagent** that:

1. Reads the spec (and only the spec + referenced dependencies)
2. Creates the branch: `gt create 'v0/<name>' -am "feat(<scope>): <message>"`
3. Writes tests first (TDD: red → green → refactor)
4. Implements until all tests pass
5. Runs `bun run build && bun run test && bun run typecheck && bun run lint`
6. Reports back with: files changed, test count, any deviations from spec

The implementer does NOT:
- Modify files outside its spec's scope
- Make design decisions — if ambiguous, stop and ask
- Skip tests or lint
- Push or submit — that's the orchestrator's job

### Reviewer (subagent)

After each implementer completes, dispatch a **reviewer subagent** that:

1. Reads the spec
2. Reads all changed files
3. Checks:
   - Does the implementation match the spec's Public Interfaces exactly?
   - Does the file layout match the spec's File Layout?
   - Are all behaviors from the spec's Behaviors section implemented?
   - Are all error cases from the spec's Error Cases section handled?
   - Are all test scenarios from the spec's Testing Strategy covered?
   - Are there any deviations? If so, are they justified?
   - Does `bun run build && bun run test && bun run typecheck && bun run lint` pass?
4. Reports: PASS (ready to submit) or FAIL (with specific issues to fix)

If FAIL, resume the implementer with the reviewer's findings. Re-review after fixes.

### Orchestrator (you)

The main conversation thread:

1. Runs pre-flight checks
2. Dispatches implementer for the current step
3. Dispatches reviewer when implementer completes
4. On PASS: `gt submit --no-interactive` and moves to next step
5. On FAIL: resumes implementer, then re-reviews
6. After all steps: runs full-stack verification

## Steps

---

### Step 0: Phase 1 Integration Tests

**Branch:** `v0/phase1-integration-tests`
**Spec:** `phase1-integration-tests.md` (test plan, not a numbered spec)
**Scope:** New `packages/integration/` workspace package (test-only)
**Estimated size:** ~800 LOC across 7 test files + 4 fixture files

**Implementer prompt context:**
- Read `phase1-integration-tests.md` for the full test plan
- Read specs 02-08 for the interfaces being validated
- The mock boundary is `XmtpClientFactory` / `XmtpClient` — everything above uses real code
- Use `software-vault` platform capability (no Secure Enclave in tests)
- Create `packages/integration/package.json` with workspace dependencies on all Phase 1 packages
- Every test suite in the plan must have at least the scenarios listed

**Commit convention:** `test(integration): Phase 1 cross-package integration tests`

**Success gate:** All 7 test suites pass. This validates Phase 1 is solid before building on it.

---

### Step 1: Action Registry (Spec 10)

**Branch:** `v0/action-registry`
**Spec:** `10-action-registry.md`
**Scope:** Extends `packages/contracts/` and `packages/schemas/`
**Estimated size:** ~400 LOC

**Implementer prompt context:**
- Read spec 10 in full
- Read existing `packages/contracts/src/handler-types.ts` and `packages/contracts/src/core-types.ts`
- Read existing `packages/schemas/src/errors/` for error types
- New files in contracts: `action-spec.ts`, `action-registry.ts`
- New files in schemas: `src/result/action-result.ts`, `src/result/index.ts`
- Modify: `packages/contracts/src/handler-types.ts` (extend HandlerContext)
- Modify: `packages/contracts/src/index.ts` and `packages/schemas/src/index.ts` (re-exports)
- Do NOT modify any runtime packages

**Commit convention:** `feat(contracts): ActionSpec, ActionRegistry, extended HandlerContext`

**Gotchas:**
- HandlerContext extension must be backward-compatible with existing Phase 1 code
- ActionResult is a Zod schema in schemas, not a class
- ActionRegistry is synchronous (in-memory Map)
- `CliSurface.rpcMethod` defaults to `command` with `:` replaced by `.`

---

### Step 2: SDK Integration (Spec 11)

**Branch:** `v0/sdk-integration`
**Spec:** `11-sdk-integration.md`
**Scope:** Extends `packages/core/`
**Estimated size:** ~500 LOC

**Implementer prompt context:**
- Read spec 11 in full
- Read existing `packages/core/src/xmtp-client-factory.ts` for the interfaces being implemented
- Read existing `packages/core/src/identity-store.ts` for the store being extended
- Read `packages/contracts/src/providers.ts` for `SignerProvider`
- New directory: `packages/core/src/sdk/` with `factory.ts`, `client.ts`, `signer.ts`, `error-mapping.ts`, `type-mapping.ts`
- Pin `@xmtp/node-sdk` to exactly `6.0.0`
- The `createXmtpSigner` adapter wraps Result-returning methods into exception-throwing ones
- Per-group identity orchestration: BrokerCore → ClientRegistry → SdkClientFactory (see spec 11 §Per-Group Identity Orchestration)

**Commit convention:** `feat(core): wire @xmtp/node-sdk via SdkClientFactory and SdkClient`

**Gotchas:**
- SDK types change between versions — verify the `Signer` interface matches v6.0.0
- Use `xmtp-expert` agent or `blz` to verify SDK patterns if unsure
- Stream wrapping must handle abort correctly
- Error mapping must translate SDK exceptions into broker error types via `wrapSdkCall()`
- Tests mock the SDK — do NOT make real network calls

---

### Step 3: Admin Keys (Spec 12)

**Branch:** `v0/admin-keys`
**Spec:** `12-admin-keys.md`
**Scope:** Extends `packages/keys/`
**Estimated size:** ~400 LOC

**Implementer prompt context:**
- Read spec 12 in full
- Read existing `packages/keys/src/key-manager.ts`, `vault.ts`, `crypto-keys.ts`
- New files: `admin-key.ts`, `jwt.ts`
- Modify: `key-manager.ts` (add `admin` property)
- Admin key is Ed25519, stored in vault with `admin-key:` prefix
- JWT is compact format with EdDSA signature — no external JWT library
- Default TTL: 120 seconds (2 minutes), max: 3600
- NO peer credentials — JWT is the sole auth mechanism
- `AdminAuthMethod` is just `"jwt"`, not a union

**Commit convention:** `feat(keys): admin key pair and JWT auth`

**Gotchas:**
- base64url encode/decode is manual (~5 LOC each), no library
- JWT signing uses `crypto.subtle` (Web Crypto API, Bun-native)
- Rotation immediately invalidates all outstanding JWTs (fingerprint mismatch)
- `AdminAuthContext.expiresAt` is `string` (not nullable — peer creds removed)

---

### Step 4a: CLI Scaffolding (Spec 13, part 1 of 6)

**Branch:** `v0/cli-scaffolding`
**Spec:** `13-daemon-cli.md` — §Public Interfaces (config schemas), §File Layout (package structure)
**Scope:** New `packages/cli/` workspace package — scaffolding only
**Estimated size:** ~200 LOC

**Implementer prompt context:**
- Read spec 13 §Overview, §Dependencies, §Public Interfaces (config schemas only), §Zod Schemas, §File Layout
- Read `cli-broker-interaction.md` design doc for background
- Create `packages/cli/package.json` with `commander@14.0.3`, `smol-toml@1.6.0`, all `@xmtp-broker/*` workspace deps
- Create `tsconfig.json`, `src/index.ts` (Commander program shell with no commands yet)
- Create `src/config/schema.ts` — `CliConfigSchema`, `AdminServerConfigSchema`, `ResolvedPaths`
- Create `src/config/loader.ts` — TOML loading, env var overrides, path resolution (XDG)
- Create `src/config/paths.ts` — XDG path resolution logic
- Tests: config loading, TOML parsing, path resolution, env var overrides

**Commit:** `feat(cli): package scaffolding, config schema, and path resolution`

**Gotchas:**
- Config at `~/.config/xmtp-broker/config.toml`, parsed with `smol-toml`
- No `adminKeyPath` in config — admin key comes from vault
- `authMode` is `z.literal("admin-key")` (not an enum)

---

### Step 4b: Daemon Lifecycle (Spec 13, part 2 of 6)

**Branch:** `v0/cli-daemon`
**Spec:** `13-daemon-cli.md` — §Behaviors (Daemon Lifecycle State Machine), §Public Interfaces (DaemonStatus, PidFile)
**Scope:** Daemon process management within `packages/cli/`
**Estimated size:** ~250 LOC

**Implementer prompt context:**
- Read spec 13 §Behaviors (Daemon Lifecycle State Machine, Startup Sequence, Shutdown, Signal Handling)
- Create `src/daemon/lifecycle.ts` — state machine (created → starting → running → draining → stopped → error)
- Create `src/daemon/pid.ts` — PID file write/read/check/cleanup at `$XDG_RUNTIME_DIR/xmtp-broker/broker.pid`
- Create `src/daemon/signals.ts` — SIGTERM/SIGINT handler, graceful shutdown trigger
- Create `src/daemon/status.ts` — `DaemonStatusSchema`, health check response
- Tests: state transitions, PID file lifecycle, signal handling, startup failure → error state

**Commit:** `feat(cli): daemon lifecycle, PID file, and signal handling`

**Gotchas:**
- On macOS, `$XDG_RUNTIME_DIR` defaults to `$TMPDIR` if unset
- PID file must be cleaned up on shutdown AND on startup if stale (process not running)
- State machine must handle startup failure → `error` state (no partial running)

---

### Step 4c: Admin Socket (Spec 13, part 3 of 6)

**Branch:** `v0/cli-admin-socket`
**Spec:** `13-daemon-cli.md` — §Behaviors (Admin Socket Protocol), §Public Interfaces (AdminServer, AdminClient, AdminDispatcher)
**Scope:** Unix socket JSON-RPC 2.0 server and client within `packages/cli/`
**Estimated size:** ~300 LOC

**Implementer prompt context:**
- Read spec 13 §Behaviors (Admin Socket Protocol — authentication, request framing, streaming responses)
- Read spec 10 for ActionRegistry (admin socket consumes the shared registry via AdminDispatcher)
- Read spec 12 for admin JWT verification
- Create `src/admin/server.ts` — `AdminServer` using `Bun.listen({ unix })`, JSON-RPC 2.0, newline framing
- Create `src/admin/client.ts` — `AdminClient` using `Bun.connect({ unix })`, sends JSON-RPC requests
- Create `src/admin/dispatcher.ts` — `AdminDispatcher` wrapping shared `ActionRegistry`, maps JSON-RPC methods to ActionSpecs via `CliSurface.rpcMethod`
- Create `src/admin/protocol.ts` — `JsonRpcRequestSchema`, `JsonRpcSuccessSchema`, `JsonRpcErrorSchema`, `AdminAuthFrame`
- Tests: socket connect/auth, JSON-RPC round-trip, JWT verification, dispatcher routing, error responses

**Commit:** `feat(cli): admin socket with JSON-RPC 2.0 and AdminDispatcher`

**Gotchas:**
- Auth frame carries JWT token (not challenge-response): `{ type: "admin_auth", token: "<jwt>" }`
- Dispatcher maps methods to ActionSpecs via `CliSurface.rpcMethod` (dot-delimited)
- If `rpcMethod` not set on CliSurface, derive from `command` by replacing `:` with `.`
- Streaming responses use JSON-RPC notifications (no `id`) followed by final response with original `id`

---

### Step 4d: Command Groups (Spec 13, part 4 of 6)

**Branch:** `v0/cli-commands`
**Spec:** `13-daemon-cli.md` — §Behaviors (all 8 command group sections)
**Scope:** Commander.js command definitions within `packages/cli/`
**Estimated size:** ~400 LOC

**Implementer prompt context:**
- Read spec 13 §Behaviors for each command group: broker, identity, session, grant, attestation, message, conversation, admin
- Create one file per group in `src/commands/`: `broker.ts`, `identity.ts`, `session.ts`, `grant.ts`, `attestation.ts`, `message.ts`, `conversation.ts`, `admin.ts`
- Each command file: define Commander subcommand, parse args, validate with Zod, route through AdminClient (daemon mode)
- Create `src/output/formatter.ts` — table/JSON/text output formatting, `--json` flag handling
- Create `src/output/exit-codes.ts` — `exitCodeFromCategory()` using `ERROR_CATEGORY_META` from schemas
- Wire all commands into `src/index.ts` program
- Tests: output formatting, exit code mapping, argument parsing per command group

**Commit:** `feat(cli): 8 command groups with output formatting`

**Gotchas:**
- Exit codes from `ERROR_CATEGORY_META` — single source of truth, no local table
- All commands support `--json` for machine-readable output
- Streaming commands (message stream, conversation stream) use NDJSON with `--json`
- Mode availability: some commands are daemon-only, some support direct mode (see spec §Mode Availability Summary)

---

### Step 4e: Direct Mode (Spec 13, part 5 of 6)

**Branch:** `v0/cli-direct-mode`
**Spec:** `13-daemon-cli.md` — §Behaviors (Direct Mode Detection and Fallback), §Public Interfaces (DirectModeConfig, DirectClient)
**Scope:** Direct mode fallback within `packages/cli/`
**Estimated size:** ~200 LOC

**Implementer prompt context:**
- Read spec 13 §Behaviors (Direct Mode Detection and Fallback)
- Create `src/direct/client.ts` — `createDirectClient()`, vault-based key access, one-shot XMTP client
- Create `src/direct/detector.ts` — check for admin socket, determine daemon vs direct mode
- Modify command files to use detector: try daemon → fall back to direct → error if command requires daemon
- Tests: daemon detection logic, direct client creation, commands that support/reject direct mode

**Commit:** `feat(cli): direct mode fallback with vault-based key access`

**Gotchas:**
- Direct mode uses vault (Secure Enclave or software-vault), NOT env vars or keyfiles
- `DirectModeConfigSchema` has `env` and `dataDir` fields only — no `keySource`
- Commands supporting direct mode: identity init, message *, conversation *
- Commands requiring daemon: session, grant, admin, broker (except start)

---

### Step 4f: Composition Root (Spec 13, part 6 of 6)

**Branch:** `v0/cli-runtime`
**Spec:** `13-daemon-cli.md` — §Public Interfaces (BrokerRuntime), §Behaviors (Startup Sequence)
**Scope:** Wire all packages together within `packages/cli/`
**Estimated size:** ~200 LOC

**Implementer prompt context:**
- Read spec 13 §Public Interfaces (BrokerRuntime), §Behaviors (Startup Sequence detail)
- Create `src/runtime.ts` — `createBrokerRuntime(config)` that instantiates and wires: KeyManager, BrokerCore, SessionManager, PolicyEngine, AttestationManager, WsServer, AdminServer
- Create `src/audit/log.ts` — `AuditLog`, append-only JSONL at `$XDG_STATE_HOME/xmtp-broker/audit.jsonl`
- Wire runtime into `broker start` command (already defined in step 4d, now gets its implementation)
- Tests: runtime creation with mocked deps, audit log append/read, startup sequence ordering

**Commit:** `feat(cli): createBrokerRuntime composition root and audit log`

**Gotchas:**
- This is the integration point — every runtime package gets wired here
- Dependency injection via constructor args, not global state
- Audit log covers admin operations only (session issuance, revocation, key rotation, daemon lifecycle)
- The runtime must be testable with mocked deps (no real XMTP in unit tests)

---

---

### Step 5: MCP Transport (Spec 14)

**Branch:** `v0/mcp-transport`
**Spec:** `14-mcp-transport.md`
**Scope:** New `packages/mcp/` workspace package
**Estimated size:** ~500 LOC

**Implementer prompt context:**
- Read spec 14 in full
- Read spec 10 for ActionSpec and ActionRegistry
- Read spec 08 for the session/view/grant model being mirrored
- New package: `packages/mcp/` with `@modelcontextprotocol/sdk@1.27.1`
- MCP is **harness-facing** — session token auth, view/grant enforcement
- Tool subset: `broker/message/*`, `broker/conversation/*`, `broker/identity/create`
- NO admin tools (no daemon lifecycle, session management, key operations)
- Session token from config (typically `XMTP_BROKER_SESSION_TOKEN` env var)
- Per-call liveness check: expiry + `sessionManager.isActive()`
- `actionSpecToMcpTool(spec)` — no prefix parameter
- Two modes: stdio (default, standalone process) and embedded (inside daemon)

**Commit convention:** `feat(mcp): harness-facing MCP transport with session-scoped tools`

**Gotchas:**
- MCP callers are agents, NOT admins — `HandlerContext` gets `sessionId`, not `adminAuth`
- `zodToJsonSchema()` or `zod-to-json-schema` for input schema conversion
- Session expiry/revocation → auth error → MCP server shuts down
- Standalone entry point at `src/bin/mcp-server.ts`

---

### Step 6: Handler SDK (Spec 15)

**Branch:** `v0/handler-sdk`
**Spec:** `15-handler-sdk.md`
**Scope:** New `packages/handler/` workspace package
**Estimated size:** ~400 LOC

**Implementer prompt context:**
- Read spec 15 in full
- Read spec 08 for the WebSocket protocol being wrapped
- Read specs 02, 02b for event/request types
- New package: `packages/handler/`
- Dependencies: `@xmtp-broker/schemas`, `@xmtp-broker/contracts`, `better-result`, `zod`
- NO runtime broker packages (core, policy, sessions, keys)
- `createBrokerHandler(config)` → `BrokerHandler`
- Typed async iterable event stream
- Automatic reconnection with exponential backoff
- Sequence tracking and replay
- All wire protocol details hidden from the harness developer

**Commit convention:** `feat(handler): TypeScript client SDK for harness developers`

**Gotchas:**
- This package depends on schemas/contracts for types only — no runtime imports
- WebSocket reconnection must be testable without a real server (mock WebSocket)
- Event stream is `AsyncIterable<BrokerEvent>` — harness devs use `for await`
- Session expiry surfaced as event + state change + error on pending requests

---

## Full-Stack Verification

After all 12 branches are submitted:

```bash
gt top                        # go to top of stack
bun run build                 # full build
bun run test                  # all tests (including integration)
bun run typecheck             # type check
bun run lint                  # lint

# Manual smoke test
cd packages/cli
bun run src/index.ts --help   # CLI help renders
bun run src/index.ts config validate  # config validation works
```

Then submit the full stack:

```bash
gt submit --stack --no-interactive
```

## Post-Implementation

After all PRs are reviewed and merged:

1. **Docker deployment** — Dockerfile + docker-compose for local self-hosted broker
2. **Convos integration doc** — Design doc for experimental patching
3. **Secure Enclave push** — Upgrade from software-vault to hardware-backed on macOS
4. **Passkey exploration** — Cross-platform hardware-backed vault unlock

## Troubleshooting

### Build fails after stacking

```bash
gt restack                    # rebase all branches onto updated parents
bun run build                 # verify
```

### Tests fail in a downstream branch

```bash
gt top                        # go to top
gt absorb -a -f               # route fixes to correct branches
gt submit --stack --no-interactive
```

### Spec ambiguity during implementation

The implementer should **stop and report** rather than make design decisions. The spec is the source of truth. If the spec is ambiguous, the orchestrator resolves it by updating the spec, then resumes the implementer.

### Reviewer finds issues

Resume the implementer with the reviewer's specific findings. Do not start a new implementer — context matters. After fixes, re-run the reviewer.

## Step Summary

| Step | Branch | Spec | ~LOC |
|------|--------|------|------|
| 0 | `v0/phase1-integration-tests` | test plan | 800 |
| 1 | `v0/action-registry` | 10 | 400 |
| 2 | `v0/sdk-integration` | 11 | 500 |
| 3 | `v0/admin-keys` | 12 | 400 |
| 4a | `v0/cli-scaffolding` | 13 (1/6) | 200 |
| 4b | `v0/cli-daemon` | 13 (2/6) | 250 |
| 4c | `v0/cli-admin-socket` | 13 (3/6) | 300 |
| 4d | `v0/cli-commands` | 13 (4/6) | 400 |
| 4e | `v0/cli-direct-mode` | 13 (5/6) | 200 |
| 4f | `v0/cli-runtime` | 13 (6/6) | 200 |
| 5 | `v0/mcp-transport` | 14 | 500 |
| 6 | `v0/handler-sdk` | 15 | 400 |

12 branches, 12 commits, 12 PRs. ~4550 LOC total.
