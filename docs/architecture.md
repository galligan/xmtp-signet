# Architecture

This document describes the package architecture, handler contract, and key design decisions in xmtp-broker.

## Package tiers

Dependencies flow downward only across tiers. No package may import from a higher tier. Intra-tier dependencies exist (e.g., attestations depends on policy within the Runtime tier).

```
┌─────────────────────────────────────────────────┐
│                   Transport                      │
│                      ws                          │
├─────────────────────────────────────────────────┤
│                    Runtime                       │
│  core · keys · sessions · attestations · policy  │
│                   verifier                       │
├─────────────────────────────────────────────────┤
│                   Foundation                     │
│              schemas · contracts                  │
└─────────────────────────────────────────────────┘
```

### Foundation

Stable types and contracts that change infrequently.

**`@xmtp-broker/schemas`** — Zod schemas are the single source of truth. All TypeScript types are derived via `z.infer<>`. Covers content types, views, grants, attestations, sessions, events, requests, responses, and the error taxonomy.

**`@xmtp-broker/contracts`** — Service and provider interfaces that define the boundaries between packages. Includes `BrokerCore`, `SessionManager`, `AttestationManager`, `SignerProvider`, and wire format types. Runtime packages implement these contracts; transport packages consume them.

### Runtime

Core broker functionality. Each package has a focused responsibility.

**`@xmtp-broker/core`** — The XMTP client abstraction layer. Defines the `XmtpClient` interface and manages client lifecycle, identity store (one inbox per agent via `bun:sqlite`), group and message streams, and raw event emission. `@xmtp/node-sdk` integration is planned but not yet present as a dependency.

**`@xmtp-broker/keys`** — Three-tier key hierarchy inspired by [keypo-cli](https://github.com/xmtp/keypo-cli). v0 currently uses the encrypted software vault path on every platform; Secure Enclave and TPM-backed root keys are planned follow-on work. Operational keys handle day-to-day signing. Session keys are ephemeral and scoped to individual harness connections. All keys live in an encrypted vault.

**`@xmtp-broker/sessions`** — Session lifecycle management. Generates cryptographically secure tokens, tracks session state, computes policy hashes, and detects material changes that require reauthorization.

**`@xmtp-broker/attestations`** — Builds, signs, encodes, and publishes attestation messages to the XMTP network. Manages attestation chains and computes input deltas to determine when a new attestation is needed.

**`@xmtp-broker/policy`** — The view projection pipeline. Filters messages by scope, content type, and visibility mode. Validates harness requests against the active grant. Tracks reveal state. Classifies changes as material or routine.

**`@xmtp-broker/verifier`** — Standalone verification service with 6 discrete checks (source available, build provenance, release signing, attestation signature, attestation chain, schema compliance). Produces trust tier verdicts with rate limiting and statement caching.

### Transport

Protocol adapters. Each transport is a thin layer that maps protocol concerns to the handler contract.

**`@xmtp-broker/ws`** — WebSocket transport built on `Bun.serve()`. Implements a connection state machine (connecting → authenticating → active → draining → closed), session resumption via circular replay buffers, backpressure tracking, frame sequencing, and auth handshake. This is the primary transport for Phase 1.

Future transports (MCP, CLI, HTTP) will follow the same pattern: parse protocol input → call handler → format protocol output.

## Handler contract

All domain logic uses transport-agnostic handlers:

```typescript
type Handler<TInput, TOutput, TError extends BrokerError> = (
  input: TInput,
  ctx: HandlerContext,
) => Promise<Result<TOutput, TError>>;
```

Note: `HandlerContext` is the planned canonical type. The current implementation uses `CoreContext` from `@xmtp-broker/contracts`.

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

**Root keys** use the encrypted software vault in v0. Planned future targets
for hardware-backed storage are:

- macOS: Secure Enclave (P-256)
- Linux: TPM 2.0
- Fallback: Software-derived keys with encrypted vault

**Operational keys** are derived from the root and handle routine signing operations (attestations, message provenance). They can be rotated without changing the root.

**Session keys** are ephemeral, generated per harness connection, and automatically discarded when the session ends.

The platform detection system maps hardware capabilities to trust tiers, which feed into the attestation's hosting mode declaration.

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

## WebSocket transport

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

## Data flow

A typical request from harness to broker:

```
Harness                          Broker
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
XMTP Network                     Broker                          Harness
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

| Concern           | Package          | Why                                                      |
| ----------------- | ---------------- | -------------------------------------------------------- |
| Result type       | `better-result`  | Typed success/failure without exceptions                 |
| Schema validation | `zod`            | Runtime validation with TypeScript type inference        |
| Runtime           | `bun`            | Native APIs for crypto, SQLite, HTTP server, test runner |
| XMTP SDK          | `@xmtp/node-sdk` | The XMTP client this broker wraps (planned, not yet a dependency) |

Build tooling: TypeScript, Turbo, oxlint, oxfmt, Lefthook.

New dependencies require discussion. If a concern isn't listed above, check whether Bun or the existing stack already covers it.
