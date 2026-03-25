# Architecture

This document describes the package layout, handler contract, and runtime
boundaries in xmtp-signet as they exist in the current v1 stack.

> [!NOTE]
> The domain model is operator/policy/credential/seal based. Public interfaces
> use that v1 vocabulary directly.

## Package tiers

Dependencies flow downward only across tiers.

```text
┌─────────────────────────────────────────────────┐
│                    Client                       │
│                      sdk                        │
├─────────────────────────────────────────────────┤
│                  Transport                      │
│             ws · mcp · cli / http               │
├─────────────────────────────────────────────────┤
│                   Runtime                       │
│   core · keys · sessions · seals · policy      │
│                  · verifier                     │
├─────────────────────────────────────────────────┤
│                  Foundation                     │
│               schemas · contracts               │
├─────────────────────────────────────────────────┤
│                integration tests                │
└─────────────────────────────────────────────────┘
```

### Foundation

Stable types and contracts that other packages build on.

**`@xmtp/signet-schemas`**

- Resource IDs: `op_`, `cred_`, `conv_`, `policy_`, `seal_`, `msg_`, `xmtp_`
- Permission scopes and scope-set resolution
- Operator, policy, credential, seal, reveal, request, response, and event
  schemas
- Error taxonomy and typed error constructors

**`@xmtp/signet-contracts`**

- `SignetCore`, `OperatorManager`, `PolicyManager`, `CredentialManager`,
  `ScopeGuard`, and `SealManager`
- `HandlerContext`, action specs, action registry, and wire-format contracts
- Shared runtime types such as reveal snapshots and daemon status surfaces

### Runtime

Packages that implement the signet's actual behavior.

**`@xmtp/signet-core`**

- XMTP client lifecycle and SDK integration
- Identity store and conversation/message streaming
- Raw network-facing operations that stay behind the signet boundary

**`@xmtp/signet-keys`**

- Local key backend and encrypted vault
- Admin authentication material
- Operational key rotation and signer plumbing
- OWS-inspired storage and derivation direction

**`@xmtp/signet-sessions`**

- Credential issuance, lookup, renewal, and revocation
- Reveal state stores and pending-action tracking
- Action surfaces used by CLI, WebSocket, and MCP
- Materiality checks that decide when a credential update becomes a
  reauthorization event

**`@xmtp/signet-seals`**

- Seal issuance, chaining, lookup, refresh, and revocation
- Message-to-seal provenance structures
- Public transparency surface for scoped agent behavior

**`@xmtp/signet-policy`**

- Effective scope resolution with allow/deny semantics
- Projection and filtering of chat events before they reach a harness
- Read-history, reveal, and materiality decisions

**`@xmtp/signet-verifier`**

- Verification pipeline for seal trust
- Source, build, signing, chain, and schema checks

### Transport

Transport packages are thin adapters over the handler contract.

**`@xmtp/signet-ws`**

- Primary harness-facing transport
- Credential authentication and event delivery
- Replay, sequencing, and connection lifecycle management

**`@xmtp/signet-mcp`**

- MCP surface for credential-scoped tool access
- Tool registration from action specs
- Read and reveal workflows for LLM-driven harnesses

**`@xmtp/signet-cli`**

- `xs` binary and composition root
- Daemon lifecycle, admin socket, and HTTP admin API
- Direct v1 command groups such as `xs credential`

### Client

**`@xmtp/signet-sdk`**

- TypeScript client for harness developers
- Typed events and Result-based requests
- Reconnection and state management for signet clients

### Test

**`@xmtp/signet-integration`**

- Cross-package validation of credential flows, scope enforcement, seals, and
  transport behavior

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

## Identity and auth model

The v1 role hierarchy is:

```text
Owner -> Admin -> Operator -> Credential -> Seal
```

- **Owner**: bootstraps the signet, holds the root trust boundary, approves
  privileged operations
- **Admin**: manages operators and credentials
- **Operator**: purpose-built agent profile
- **Credential**: time-bound, chat-scoped authorization bound to an operator
- **Seal**: public declaration of an operator's scope and permissions in a chat

The signet distinguishes two auth surfaces:

- **Admin auth** for CLI and daemon management
- **Credential auth** for harness traffic over WebSocket and MCP

## Permission model

Permissions are expressed as scope sets with explicit `allow` and `deny`
entries. Deny wins. Policies provide reusable bundles; credentials can further
override them inline.

The current scope categories are:

- `messaging`
- `group-management`
- `metadata`
- `access`
- `observation`
- `egress`

This replaces the older v0 `view` plus `grant` pairing. The runtime still
projects messages before delivery, but authorization is described in terms of
policies, inline scope overrides, and credential status.

## Seal protocol

Seals are the public transparency layer of the signet. They let other chat
participants inspect what an operator can do and whether its permissions have
changed.

Important properties in the v1 design:

- seals are issued per credential and chat
- new seals chain to previous seals
- credential mutations can trigger seal refresh
- message provenance binds outbound actions to a seal lineage

The implementation is still catching up in a few public docs, but the runtime
and contracts now assume credential-scoped seals rather than operator-scoped
ambient access.

## Action registry

The action registry is the define-once, expose-everywhere pattern for signet
operations.

Each `ActionSpec` includes:

- a unique action identifier
- a Zod input schema
- a transport-agnostic handler
- optional CLI and MCP metadata

Transports consume the same registry:

- **CLI** builds command handlers
- **MCP** builds tool definitions
- **WebSocket** routes request names to handlers

This keeps behavior centralized while letting each surface present the same
operation in its native form.
