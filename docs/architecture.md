# Architecture

This document describes the package architecture, handler contract, and key design decisions in xmtp-signet.

## Package tiers

Dependencies flow downward only across tiers. No package may import from a higher tier. Intra-tier dependencies exist (e.g., seals depends on policy within the Runtime tier).

```
┌─────────────────────────────────────────────────┐
│                    Client                        │
│                      sdk                         │
├─────────────────────────────────────────────────┤
│                   Transport                      │
│           ws · mcp · cli · http                   │
├─────────────────────────────────────────────────┤
│                    Runtime                       │
│    core · keys · sessions · seals · policy       │
│                   verifier                       │
├─────────────────────────────────────────────────┤
│                   Foundation                     │
│              schemas · contracts                  │
├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤
│              integration (test-only)             │
└─────────────────────────────────────────────────┘
```

### Foundation

Stable types and contracts that change infrequently.

**`@xmtp/signet-schemas`** — Zod schemas are the single source of truth. All TypeScript types are derived via `z.infer<>`. Covers content types, views, grants, seals, sessions, events, requests, responses, and the error taxonomy. Phase 2 added action result schemas (`ActionResultSchema`, `ActionErrorResultSchema`) and pagination for structured command output.

**`@xmtp/signet-contracts`** — Service and provider interfaces that define the boundaries between packages. Includes `SignetCore`, `SessionManager`, `SealManager`, `SignerProvider`, and wire format types. Phase 2 added the action system: `ActionSpec` (define-once action descriptors with per-surface metadata), `ActionRegistry` (type-safe registry of all signet actions), `ActionResult` (structured result envelope), and `HandlerContext` (canonical handler context with `requestId`, `signal`, optional `adminAuth` and `sessionId`). Runtime packages implement these contracts; transport packages consume them.

### Runtime

Core signet functionality. Each package has a focused responsibility.

**`@xmtp/signet-core`** — The XMTP client abstraction layer. Defines the `XmtpClient` interface and manages client lifecycle, identity store (one inbox per agent via `bun:sqlite`), group and message streams, and raw event emission. Phase 2 wired `@xmtp/node-sdk` as a real dependency via `createSdkClientFactory` — the production `XmtpClientFactory` implementation that creates SDK clients, signers, and Result-wrapped stream adapters (`wrapMessageStream`, `wrapGroupStream`, `wrapSdkCall`).

**`@xmtp/signet-keys`** — Three-tier key hierarchy inspired by [keypo-cli](https://github.com/xmtp/keypo-cli). Root key storage is platform-adaptive: on macOS with Apple Silicon, keys are backed by the Secure Enclave (P-256) via the `signet-signer` Swift CLI subprocess (see `signet-signer/` and the bridge in `packages/keys/src/se-bridge.ts`); on all other platforms, an encrypted software vault (AES-GCM + `bun:sqlite`) is used. Platform detection is automatic via `detectPlatform()`, which checks for signer binary availability and SE hardware support. The `findSignerBinary()` discovery chain checks `SIGNET_SIGNER_PATH` env var, then local build output, then `$PATH`. Subprocess calls use a 30-second timeout to accommodate biometric (Touch ID) prompts. On the SE path, root key private material never enters the TypeScript process. Operational keys handle day-to-day signing. Session keys are ephemeral and scoped to individual harness connections. All keys live in an encrypted vault. Phase 2 added **admin keys** — a separate key type (peer to the root→operational→session hierarchy) for authenticating CLI and admin socket operations. Includes `createAdminKeyManager`, JWT encode/decode/sign/verify, and base64url utilities.

**`@xmtp/signet-sessions`** — Session lifecycle management. Generates cryptographically secure tokens, tracks session state, computes policy hashes, and detects material changes that require reauthorization.

**`@xmtp/signet-seals`** — Builds, signs, encodes, and publishes seal messages to the XMTP network. Manages seal chains and computes input deltas to determine when a new seal is needed.

**`@xmtp/signet-policy`** — The view projection pipeline. Filters messages by scope, content type, and visibility mode. Validates harness requests against the active grant. Tracks reveal state. Classifies changes as material or routine.

**`@xmtp/signet-verifier`** — Standalone verification service with 6 discrete checks (source available, build provenance, release signing, seal signature, seal chain, schema compliance). Build provenance performs structural verification (DSSE envelope validity, digest matching) and returns a `skip` verdict; cryptographic DSSE signature verification is TODO. Produces trust tier verdicts with rate limiting and statement caching.

### Transport

Protocol adapters. Each transport is a thin layer that maps protocol concerns to the handler contract.

**`@xmtp/signet-ws`** — WebSocket transport built on `Bun.serve()`. Implements a connection state machine (connecting → authenticating → active → draining → closed), session resumption via circular replay buffers, backpressure tracking, frame sequencing, and auth handshake. This is the primary harness-facing transport.

**`@xmtp/signet-mcp`** — MCP (Model Context Protocol) transport for harness-facing tool integration. Converts `ActionSpec` definitions into MCP tools via `actionSpecToMcpTool`. Session-scoped authentication ensures each MCP session receives only the tools its grant allows. Supports stdio and embedded server modes. Dependencies: `@modelcontextprotocol/sdk`, `zod-to-json-schema`.

**`@xmtp/signet-cli`** — Composition root and command-line interface. Provides the `xmtp-signet` command (alias `xs`) with 8 command groups (identity, session, grant, seal, message, conversation, admin, plus start/stop/status). Handles config/TOML loading, daemon lifecycle (PID files, signal handling, graceful shutdown), and an admin Unix socket using JSON-RPC 2.0. Includes direct mode fallback for vault-based key access when no daemon is running. Dependencies: `commander`, `smol-toml`.

### Client

SDK for harness developers. Lives outside the signet's runtime boundary.

**`@xmtp/signet-sdk`** — Client SDK for agent harnesses. Provides `SignetHandler`, a WebSocket client with typed events (`AsyncIterable<SignetEvent>`), Result-based request methods (`sendMessage`, `sendReaction`, `listConversations`), automatic reconnection with exponential backoff, and a connection state machine (disconnected → connecting → authenticating → connected → reconnecting → closed). No runtime dependencies beyond `@xmtp/signet-schemas` and `better-result`.

### Test

**`@xmtp/signet-integration`** — Test-only package (not published). 7 test suites validating Phase 1 cross-package composition: key hierarchy, session lifecycle, contract verification, policy enforcement, happy path flows, seal lifecycle, and WebSocket edge cases.

## Action registry

The action registry is the define-once-expose-everywhere pattern for signet operations. Each action is defined as an `ActionSpec` — a descriptor that includes:

- A unique action name and description
- A Zod input schema
- A handler function (`Handler<TInput, TOutput, TError>`)
- Per-surface metadata: `CliSurface` (command path, options, output format) and `McpSurface` (tool name, annotations)

The registry (`createActionRegistry`) collects all action specs. Each transport reads the registry and exposes actions in its native format:

- **CLI** reads `CliSurface` to generate commander commands with flags, options, and output formatting
- **MCP** reads `McpSurface` to register MCP tools with JSON Schema input validation
- **WebSocket** routes action names to handlers directly

This means adding a new signet operation requires defining one `ActionSpec`. All transports pick it up automatically.

## Action confirmation flow

When a session's grant sets `grant.messaging.draftOnly` to true, outbound actions require explicit confirmation before execution:

- **`PendingActionStore`** queues actions that need confirmation, tracking expiry
- **`confirm_action`** re-validates the action against the current session policy before executing, preventing policy bypass via stale confirmations
- **Expiry** — pending actions that exceed their TTL are auto-rejected
- **Events** — broadcasts `action.confirmation_required` event to the harness when an action is queued for confirmation

## Admin authentication

Admin operations (daemon control, direct-mode CLI commands) use a separate authentication path from harness sessions. The `AdminKeyManager` in `@xmtp/signet-keys` manages admin key pairs and issues JWTs for authentication.

The flow:

1. Admin key pair is generated and stored in the vault alongside agent keys
2. CLI commands authenticate via JWT signed with the admin key
3. The admin Unix socket validates JWTs before dispatching JSON-RPC requests
4. `AdminAuthContext` on `HandlerContext` carries the authenticated admin identity

Admin keys are peers to the root→operational→session hierarchy, not derived from it. They serve a different purpose: authorizing management operations rather than signing messages or establishing harness sessions.

## Handler contract

All domain logic uses transport-agnostic handlers:

```typescript
type Handler<TInput, TOutput, TError extends SignetError> = (
  input: TInput,
  ctx: HandlerContext,
) => Promise<Result<TOutput, TError>>;
```

`HandlerContext` is defined in `@xmtp/signet-contracts` and includes `requestId`, `signal` (for cancellation), and optional `adminAuth` and `sessionId` fields. `CoreContext` remains available for core-specific operations.

Handlers:

- Receive pre-validated input (parsed by Zod schemas at the transport boundary)
- Receive a context object with session, identity, and service access
- Return `Result<T, E>` from `better-result` — never throw
- Know nothing about WebSocket frames, HTTP status codes, or CLI exit codes

Transport adapters handle all protocol concerns: parsing wire formats, mapping error categories to protocol-specific codes, managing connection lifecycle.

## Error taxonomy

Errors are categorized for consistent handling across all transports:

| Category     | When to use                           | Retryable |
| ------------ | ------------------------------------- | --------- |
| `validation` | Bad input, schema violation           | No        |
| `not_found`  | Resource doesn't exist                | No        |
| `permission` | Grant denied, insufficient scope      | No        |
| `auth`       | Session expired, invalid token        | No        |
| `internal`   | Invariant violation, unexpected state | No        |
| `timeout`    | Operation exceeded time limit         | Yes       |
| `cancelled`  | Cancelled by signal or user           | No        |

Each category maps to:

- **CLI** — exit codes
- **HTTP** — status codes
- **WebSocket** — close codes and error frames
- **MCP** — JSON-RPC error codes

## Key hierarchy

The three-tier key hierarchy provides defense in depth:

```
Root Key (platform-bound)
  └─ Operational Key (daily signing, rotatable)
       └─ Session Key (per-connection, ephemeral)
```

**Root keys** are platform-adaptive with automatic detection via `detectPlatform()`:

- **macOS with Apple Silicon**: Secure Enclave (P-256) via `signet-signer` Swift CLI subprocess. Private key material never enters the TypeScript process. The `se-bridge.ts` module manages subprocess communication with a 30-second timeout for biometric prompts.
- **All other platforms**: Encrypted software vault (AES-GCM + `bun:sqlite`).
- **Planned**: Linux TPM 2.0 support.

**Operational keys** are derived from the root and handle routine signing operations (seals, message provenance). They can be rotated without changing the root.

**Session keys** are ephemeral, generated per harness connection, and automatically discarded when the session ends.

The platform detection system maps hardware capabilities to trust tiers, which feed into the seal's hosting mode declaration.

## View projection pipeline

When a message arrives from the XMTP network, it passes through the view projection pipeline before reaching any harness:

```
Raw XMTP Message
  → Scope filter (is this group/thread in the agent's view?)
  → Content type filter (is this content type in the allowlist?)
  → Visibility resolver (full / redacted / reveal-only / summary)
  → Content projector (apply visibility mode to message content)
  → Projected message delivered to harness
```

Each stage can reject the message. A message that passes all stages is delivered as a typed event over the transport.

## Threading model

XMTP has no native thread concept at the protocol level. Threading is derived client-side:

- `threadId` is extracted from the Reply content type's `referenceId` field in `toDecodedMessage()`
- The value flows through `XmtpDecodedMessage` → `RawMessageEvent` → `MessageEvent` → the view projector
- Scope filtering matches `threadId` against the session's `threadScopes` to determine visibility

This allows harnesses to request thread-scoped views without protocol-level thread support.

## Transports

### WebSocket

The WebSocket transport implements a connection state machine:

```
connecting → authenticating → active → draining → closed
```

Key features:

- **Auth handshake** — first frame must be an `AuthFrame` with a valid session token
- **Frame sequencing** — every outbound frame gets a monotonic sequence number for ordering
- **Session resumption** — circular replay buffer allows reconnecting clients to catch up on missed events
- **Backpressure** — tracks per-connection send buffer depth and notifies the harness when it should slow down
- **Graceful shutdown** — draining phase allows in-flight messages to complete before closing
- **Session freshness** — fail-closed session validation model:
  - Fresh `sessionManager.lookup()` on every inbound frame (errors close the socket)
  - Heartbeat refreshes session state for idle sockets
  - Post-mutation re-sync after `update_view` / `reveal_content`
  - `invalidateSession(sessionId)` API for push-based refresh from external sources
  - `onSessionMutated` callback on the session manager wired to `invalidateSession()`
  - Non-active sessions close the socket with proper close codes

### MCP

The MCP transport exposes signet actions as MCP tools for LLM-driven harnesses:

- **Tool registration** — `actionSpecToMcpTool` converts each `ActionSpec` into an MCP tool definition with JSON Schema input validation (via `zod-to-json-schema`)
- **Session scoping** — each MCP session authenticates and receives only the tools its grant allows
- **Output formatting** — `ActionResult` values are formatted as MCP content responses
- **Modes** — stdio (for CLI-launched tool servers) and embedded (for in-process use)

### CLI

The CLI is the composition root that wires everything together:

- **8 command groups** — identity, session, grant, seal, message, conversation, admin, plus start/stop/status
- **Daemon lifecycle** — PID files, signal handlers (SIGINT/SIGTERM for graceful shutdown), status reporting
- **Admin socket** — Unix domain socket with JSON-RPC 2.0 protocol for out-of-band management
- **Direct mode** — fallback for when no daemon is running; accesses the vault directly for key operations
- **Config** — TOML-based configuration with path resolution and environment overrides

### HTTP

The HTTP transport provides a `Bun.serve()` adapter for non-streaming admin and status operations:

- **Routes** — `GET /v1/health` (unauthenticated status), `POST /v1/admin/:method` (admin-authenticated dispatcher). Session routes (`POST /v1/session/:method`) are defined but not yet implemented
- **Auth** — Bearer token extraction with admin JWT verification for admin routes
- **Error mapping** — error taxonomy categories map to HTTP status codes (400, 401, 403, 404, 408, 499, 500)
- **Status provider** — async status callback injected via `HttpServerDeps` for health endpoint

## Data flow

A typical request from harness to signet:

```
Harness                          Signet
  │                                │
  ├─ WebSocket frame ────────────► │
  │                                ├─ Parse frame (Zod)
  │                                ├─ Validate session token
  │                                ├─ Check grant (policy)
  │                                ├─ Execute handler
  │                                ├─ Return Result<T, E>
  │  ◄──────────── Response frame ─┤
  │                                │
```

A message arriving from the XMTP network:

```
XMTP Network                     Signet                          Harness
  │                                │                                │
  ├─ Raw message ────────────────► │                                │
  │                                ├─ Decode message                │
  │                                ├─ Run view projection pipeline  │
  │                                ├─ Sequence event                │
  │                                ├─ Event frame ────────────────► │
  │                                │                                │
```

## Dependencies

The project uses a minimal, deliberate set of dependencies:

| Concern           | Package                    | Why                                                      |
| ----------------- | -------------------------- | -------------------------------------------------------- |
| Result type       | `better-result`            | Typed success/failure without exceptions                 |
| Schema validation | `zod`                      | Runtime validation with TypeScript type inference        |
| Runtime           | `bun`                      | Native APIs for crypto, SQLite, HTTP server, test runner |
| XMTP SDK          | `@xmtp/node-sdk`          | The XMTP client this signet wraps (used by `core`)      |
| CLI framework     | `commander`                | Command parsing and help generation (used by `cli`)      |
| TOML parsing      | `smol-toml`                | Config file loading (used by `cli`)                      |
| MCP SDK           | `@modelcontextprotocol/sdk`| MCP server and tool protocol (used by `mcp`)             |
| Schema→JSON       | `zod-to-json-schema`       | Convert Zod schemas to JSON Schema for MCP (used by `mcp`)|
| Elliptic curves   | `@noble/curves`            | P-256 signature verification for SE tests (used by `keys`)|
| QR codes          | `qrcode`                   | QR code generation for invite links (used by `cli`)       |

Build tooling: TypeScript, Turbo, oxlint, oxfmt, Lefthook.

New dependencies require discussion. If a concern isn't listed above, check whether Bun or the existing stack already covers it.
