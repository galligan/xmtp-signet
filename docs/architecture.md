# Architecture

This document describes the package layout, handler contract, runtime
boundaries, and wire protocols in xmtp-signet. For the conceptual model, see
[concepts.md](concepts.md). For key management and threat model, see
[security.md](security.md).

## Package tiers

Dependencies flow downward only across tiers.

```text
+---------------------------------------------------+
|                     Client                        |
|                       sdk                         |
+---------------------------------------------------+
|                   Transport                       |
|            ws . mcp . cli / http                  |
+---------------------------------------------------+
|                    Runtime                         |
|    core . keys . sessions . seals . policy        |
|                   . verifier                      |
+---------------------------------------------------+
|                   Foundation                      |
|                schemas . contracts                |
+---------------------------------------------------+
|                integration tests                  |
+---------------------------------------------------+
```

### Foundation

Stable types and contracts that other packages build on.

**`@xmtp/signet-schemas`**

- Resource IDs: `op_`, `cred_`, `conv_`, `policy_`, `seal_`, `msg_`, `xmtp_`
- Permission scopes (30 scopes across 6 categories) and scope-set resolution
  with deny-wins semantics
- Operator, policy, credential, seal, reveal, request, response, and event
  schemas — all Zod-based with inferred TypeScript types
- Content type definitions and baseline allowlist
- Error taxonomy and typed error constructors (`validation`, `not_found`,
  `permission`, `auth`, `internal`, `timeout`, `cancelled`)

**`@xmtp/signet-contracts`**

- Service interfaces: `SignetCore`, `OperatorManager`, `PolicyManager`,
  `CredentialManager`, `ScopeGuard`, `SealManager`
- `HandlerContext` with `requestId`, `signal`, optional `adminAuth`,
  `operatorId`, and `credentialId`
- Authored action specs, derivation helpers, registry validation, surface maps,
  and wire-format contracts
- Credential types including `CredentialRecord`, `CredentialIssuer`, and
  update/reauthorization semantics
- Shared runtime types: reveal snapshots, daemon status surfaces, replay state

### Runtime

Packages that implement the signet's actual behavior.

**`@xmtp/signet-core`**

- XMTP client lifecycle and SDK integration
- Persistent identity store in `${dataDir}/identities.db`
- Per-identity XMTP MLS and message state in `${dataDir}/db/${env}/${identityId}.db3`
- Ephemeral runtime client registry rebuilt from durable identity state on startup
- Conversation and message streaming
- Raw network-facing operations that stay behind the signet boundary

**`@xmtp/signet-keys`**

- Three-tier key hierarchy: root (P-256), operational (Ed25519, BIP-39/44
  derived), admin (Ed25519, independent)
- Encrypted vault: Keystore v3 format with scrypt + AES-256-GCM
- BIP-39 mnemonic generation with BIP-44 derivation paths (passes Trezor
  test vectors)
- Admin authentication with JWT signing
- Operational key rotation and signer provider
- Seal stamper for message-seal binding signatures
- Key manager compatibility layer for dual-signature support

**`@xmtp/signet-sessions`**

- Credential issuance with issuer provenance tracking (`CredentialIssuer` /
  `CredentialIssuerType`)
- Credential lookup, renewal, revocation, and scope-narrowing updates
- Reveal state stores: per-credential, five granularities (message, thread,
  sender, content-type, time-window), with expiration and snapshot/restore
- Pending-action tracking and action confirmation surfaces
- Materiality checks that decide when a credential update becomes a
  reauthorization event vs an in-place update

**`@xmtp/signet-seals`**

- Seal issuance with Ed25519 signature in `SealEnvelope`
- Seal chaining: inline previous payload + computed delta + chain validation
  (matching IDs, monotonic timestamps)
- Message-seal binding: `createMessageBinding` / `verifyMessageBinding` over
  canonical `{ messageId, sealId }`
- TTL-based renewal (24h default, 75% threshold)
- Materiality-gated refresh: skips reissue when delta is empty
- Auto-republish to all affected chats with exponential backoff retry
- Revocation seals with permanent credential-chat pair tracking

**`@xmtp/signet-policy`**

- Effective scope resolution with allow/deny semantics and deny-wins
- Content type allowlist resolution: baseline + signet-level intersection
  via `resolveEffectiveAllowlist()` (per-credential tier planned)
- Four-stage message projection pipeline:
  1. Scope filter — credential chat membership
  2. Content type filter — effective allowlist check
  3. Visibility resolver — `visible` / `revealed` / `historical` / `hidden`
  4. Content projector — pass-through or redaction
- Reveal state integration for visibility decisions
- Read-history gating for pre-credential messages
- Egress validation via `validateEgress()`

**`@xmtp/signet-verifier`**

- Multi-check verification pipeline for seal trust
- Source availability checks
- Build provenance verification
- Signing chain verification (Ed25519 signature + key fingerprint)
- Seal chain integrity (monotonic timestamps, matching IDs, delta correctness)
- Schema compliance checks

### Transport

Transport packages are thin adapters over the handler contract.

**`@xmtp/signet-ws`**

- Primary harness-facing transport
- Credential-based authentication with effective scope delivery
- `SequencedFrame` wire format: monotonically incrementing `seq` per
  connection for ordered delivery
- Per-credential `CredentialReplayState` with circular buffer for
  reconnection recovery via `lastSeenSeq`
- Connection state machine: `authenticating` -> `active` -> `draining`
- In-flight request tracking with per-request timeout timers
- Heartbeat monitoring: 30-second interval, 3 missed = dead
- Graceful draining on revocation: no new requests, cancel in-flight, close

**`@xmtp/signet-mcp`**

- MCP surface for credential-scoped tool access
- Tool registration from action specs in the action registry, including
  derived MCP tool names and safety annotations
- Read and reveal workflows for LLM-driven harnesses
- Credential context threading through MCP tool calls

**`@xmtp/signet-cli`**

- `xs` binary and composition root
- Daemon lifecycle, admin socket, and contract-driven HTTP admin/action routes
- Direct v1 command groups: `credential`, `seal`, `policy`, `conversation`,
  `message`, `identity`, `admin`, `keys`, `config`
- Admin fingerprint preservation through HTTP credential routes

### Client

**`@xmtp/signet-sdk`**

- TypeScript client for harness developers
- Typed event stream with async iteration
- Result-based requests with correlation IDs
- Automatic reconnection with exponential backoff
- State management: credential info, connection status, listener registration
- Heartbeat monitoring on the client side

### Test

**`@xmtp/signet-integration`**

- Cross-package validation of credential flows, scope enforcement, seals, and
  transport behavior
- Shared test runtime with in-memory fixtures
- Security boundary tests for role isolation and credential scoping

## Handler contract

All domain logic uses transport-agnostic handlers:

```typescript
type Handler<TInput, TOutput, TError extends SignetError> = (
  input: TInput,
  ctx: HandlerContext,
) => Promise<Result<TOutput, TError>>;
```

`HandlerContext` carries:

- `requestId`
- `signal`
- optional `adminAuth`
- optional `operatorId`
- optional `credentialId`

Handlers:

- receive pre-validated input
- return `Result<T, E>`
- never throw for operational failures
- know nothing about WebSocket frames, MCP tool envelopes, or CLI parsing

Transport layers translate protocol input into handler calls and map typed
errors back into protocol-specific responses.

## Event model

The signet emits a discriminated union of 11 event types to harnesses:

| Event | When |
|-------|------|
| `message.visible` | A projected message passes the pipeline |
| `message.revealed` | Previously hidden content becomes visible via reveal |
| `seal.stamped` | A seal is created or updated |
| `credential.issued` | A new credential is issued to this operator |
| `credential.expired` | The active credential has naturally expired |
| `credential.reauthorization_required` | A scope expansion requires fresh auth |
| `scopes.updated` | Permission scopes changed for the active credential |
| `agent.revoked` | The agent is revoked from a group |
| `action.confirmation_required` | An action needs owner confirmation |
| `heartbeat` | Liveness signal on the active connection |
| `signet.recovery.complete` | Signet finished catching up after downtime |

Harnesses can send 7 request types:

| Request | Purpose |
|---------|---------|
| `send_message` | Send a text message to a chat |
| `send_reaction` | React to a message |
| `send_reply` | Reply in a thread |
| `update_scopes` | Request scope changes |
| `reveal_content` | Request reveal of hidden content |
| `confirm_action` | Confirm a pending action |
| `heartbeat` | Client-side liveness signal |

All events are wrapped in a `SequencedFrame` with a monotonically incrementing
`seq` number before delivery over WebSocket.

## Identity and auth model

The v1 role hierarchy is:

```text
Owner -> Admin -> Operator -> Credential -> Seal
```

- **Owner**: bootstraps the signet, holds the root trust boundary, approves
  privileged operations via biometric gate
- **Admin**: manages operators and credentials within its scope
- **Operator**: purpose-built agent profile with role levels
  (`operator` / `admin` / `superadmin`)
- **Credential**: time-bound, chat-scoped authorization with issuer provenance
- **Seal**: public declaration of an operator's scope and permissions in a chat

The signet distinguishes two auth surfaces:

- **Admin auth** for CLI and daemon management — JWT signed with the admin key
- **Credential auth** for harness traffic over WebSocket and MCP — token signed
  with the operational key

These use independently generated keys. See [security.md](security.md) for
the full key hierarchy.

## Permission model

Permissions are expressed as scope sets with explicit `allow` and `deny`
entries. Deny wins. Policies provide reusable bundles; credentials can further
override them inline.

The current scope categories are:

- `messaging` — send, reply, react, read-receipt, attachment
- `group-management` — add-member, remove-member, promote-admin, demote-admin,
  update-permission
- `metadata` — update-name, update-description, update-image
- `access` — invite, join, leave, create-group, create-dm
- `observation` — read-messages, read-history, list-members,
  list-conversations, view-permissions, stream-messages, stream-conversations
- `egress` — forward-to-provider, store-excerpts, use-for-memory,
  quote-revealed, summarize

See [concepts.md](concepts.md) for the full scope reference.

## Seal protocol

Seals are the public transparency layer. They let other chat participants
inspect what an operator can do and whether its permissions have changed.

Properties in the v1 design:

- Seals are issued per credential and chat
- New seals chain to previous seals with inline previous payload and delta
- Message-seal binding provides cryptographic provenance via Ed25519 signature
  over `{ messageId, sealId }`
- Materiality checks prevent unnecessary seal noise
- Credential mutations trigger automatic republish with exponential backoff
- Revocation seals permanently mark credential-chat pairs
- TTL-based renewal at 24h with 75% threshold

Seals are published as XMTP messages using `xmtp.org/agentSeal:1.0`,
`xmtp.org/agentRevocation:1.0`, and `xmtp.org/agentLiveness:1.0` content
types.

See [concepts.md](concepts.md) for the full seal lifecycle and chaining
mechanics.

## Action registry

The action registry is the authored-contract layer for signet operations. Each
`ActionSpec` defines the behavior once, then the registry derives the
transport-specific shapes that should stay mechanically consistent.

Each `ActionSpec` includes:

- a unique action identifier (for example `credential.issue`)
- a Zod input schema and transport-agnostic handler
- optional output schema and named examples for docs/tests
- authored semantics such as `description`, `intent`, and `idempotent`
- optional CLI, MCP, and HTTP overrides when the default projection is not
  enough

Derived surfaces currently include:

- **CLI** command names plus the canonical admin RPC method
- **MCP** tool names plus standard safety annotations
- **HTTP** method, path, and input source (`GET` + query for reads, `POST` +
  body otherwise, unless overridden)

Registry validation fails early on:

- duplicate action IDs
- conflicting HTTP routes
- reserved HTTP paths
- contradictory authored MCP annotations

The contracts package also emits a deterministic action surface map and stable
hash so drift is visible in tests and reviews.

WebSocket still shares the same handler/runtime model, but it remains the
primary sequenced harness transport rather than a mechanically generated action
surface.

## Projection pipeline

All inbound messages pass through a four-stage pipeline before reaching a
harness. See [concepts.md](concepts.md) for the full pipeline description.

The pipeline produces six visibility states: `visible`, `historical`,
`revealed`, `redacted`, `hidden`, and `dropped`. The harness only ever sees
the first four; `hidden` and `dropped` messages are held silently inside the
signet.

## Connection lifecycle

### Authentication

1. Client connects to `ws://host:port/v1/agent`
2. Client sends `AuthFrame` with credential token and optional `lastSeenSeq`
3. Signet validates token, checks credential status, loads effective scopes
4. Signet responds with `AuthenticatedFrame` containing connection ID,
   credential details, effective scopes, and optional `resumedFromSeq`

### Active state

- All events delivered in `SequencedFrame` wrappers with monotonic `seq`
- Heartbeat every 30 seconds; 3 missed = connection dead
- Requests correlated via UUID with per-request timeout timers

### Reconnection

- Client passes `lastSeenSeq` in auth frame
- Signet replays missed events from per-credential circular buffer
- Replayed messages tagged as `historical` visibility
- `signet.recovery.complete` event signals catch-up finished

### Draining (revocation)

1. Credential revoked — connection enters `draining` phase
2. No new requests accepted
3. In-flight requests cancelled (timers cleared)
4. Connection closes gracefully
5. Revocation seal published to affected chats
