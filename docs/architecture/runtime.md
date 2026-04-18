# Runtime Architecture

This document describes the package layout, runtime seams, and wire-level
surfaces in `xmtp-signet`. For the conceptual model, see
[../concepts.md](../concepts.md). For key management and threat model, see
[../security.md](../security.md).

## Package Tiers

Dependencies flow downward only across tiers.

```text
+---------------------------------------------------+
|                     Client                        |
|                       sdk                         |
+---------------------------------------------------+
|                   Transport                       |
|            ws . mcp . cli / http                  |
+---------------------------------------------------+
|                    Runtime                        |
|    core . keys . sessions . seals . policy        |
|                   . verifier                      |
+---------------------------------------------------+
|                   Foundation                      |
|                schemas . contracts                |
+---------------------------------------------------+
|                integration tests                  |
+---------------------------------------------------+
```

## Foundation

Stable types and contracts that other packages build on.

### `@xmtp/signet-schemas`

- resource IDs: `op_`, `cred_`, `conv_`, `policy_`, `seal_`, `msg_`, `xmtp_`
- permission scopes and deny-wins scope-set resolution
- operator, policy, credential, seal, reveal, request, response, and event
  schemas
- content type definitions and baseline allowlist
- shared error taxonomy: `validation`, `not_found`, `permission`, `auth`,
  `internal`, `timeout`, `cancelled`

### `@xmtp/signet-contracts`

- service interfaces such as `SignetCore`, `OperatorManager`,
  `CredentialManager`, and `SealManager`
- `HandlerContext` with `requestId`, `signal`, and optional auth identifiers
- authored action specs, surface derivation helpers, and registry validation
- shared runtime types for reveal state, daemon status, and replay surfaces

## Runtime

Packages that implement the signet's behavior.

### `@xmtp/signet-core`

- XMTP client lifecycle and SDK integration
- durable identity store in `${dataDir}/identities.db`
- per-identity XMTP MLS/message state in `${dataDir}/db/${env}/${identityId}.db3`
- client registry rebuilt from durable identity state on startup
- conversation, message, inbox, lookup, and search actions
- onboarding scheme contract exported from `packages/core/src/schemes/`

### `@xmtp/signet-keys`

- root, operational, and admin key hierarchy
- OWS-compatible encrypted vault
- BIP-39/44 derivation
- admin authentication
- operational key rotation and signer providers

### `@xmtp/signet-sessions`

- credential issuance, renewal, revocation, and updates
- reveal state stores
- pending-action tracking and confirmation surfaces
- materiality checks for in-place updates vs reauthorization

### `@xmtp/signet-seals`

- seal issuance and validation
- seal chaining and message-seal binding
- TTL-driven refresh
- materiality-gated reissue
- republish and revocation behavior

### `@xmtp/signet-policy`

- effective scope resolution with deny-wins semantics
- content type allowlist resolution
- projection pipeline and reveal-aware visibility decisions
- read-history gating and egress validation

### `@xmtp/signet-verifier`

- seal trust verification
- source, build, signature-chain, and schema checks

## Cross-Cutting Runtime Seams

### Handler contract

All domain logic uses transport-agnostic handlers:

```typescript
type Handler<TInput, TOutput, TError extends SignetError> = (
  input: TInput,
  ctx: HandlerContext,
) => Promise<Result<TOutput, TError>>;
```

Handlers:

- receive pre-validated input
- return `Result<T, E>`
- never throw for ordinary operational failures
- know nothing about CLI parsing, HTTP envelopes, MCP calls, or WebSocket frames

### Onboarding scheme seam

The onboarding flow is now modeled as a core extension seam:

- the shared interface lives in
  `packages/core/src/schemes/onboarding-scheme.ts`
- shared invite crypto helpers live in
  `packages/core/src/schemes/invite-crypto.ts`
- the current concrete implementation is
  `createConvosOnboardingScheme()` in
  `packages/core/src/convos/onboarding-scheme.ts`

That seam owns:

- invite generation, parsing, and verification
- host-side join request processing
- profile update and snapshot encoding
- profile resolution from message history
- onboarding codec registration and content-type detection

The abstraction is real, but the user-facing onboarding behavior is still
Convos-specific today.

## Transport

Transport packages are thin adapters over the shared handler and core surfaces.

### `@xmtp/signet-ws`

- primary harness-facing transport
- credential authentication and effective scope delivery
- sequenced frames and replay recovery
- connection state management and heartbeat monitoring

### `@xmtp/signet-mcp`

- credential-scoped MCP tool surface
- tool derivation from the shared action registry
- reveal-aware read workflows

### `@xmtp/signet-cli`

- `xs` binary and composition root
- daemon lifecycle, admin socket, and optional HTTP admin/action routes
- top-level lifecycle and utility commands such as `init`, `status`, `lookup`,
  `search`, and `consent`
- grouped surfaces for `daemon`, `operator`, `cred`, `inbox`, `chat`, `msg`,
  `policy`, `seal`, `wallet`, and `key`
- onboarding scheme resolution at startup before wiring conversation actions,
  invite hosting, and SDK client factories

## Client

### `@xmtp/signet-sdk`

- TypeScript harness client
- typed event stream with async iteration
- reconnection and replay-aware state handling
- onboarding-scheme-aware codec registration and content-type detection

## Event Model

The signet emits a typed event stream over the canonical WebSocket surface. Key
runtime events include:

- projected messages becoming visible or revealed
- seal creation and refresh
- credential issuance, expiry, scope updates, and reauthorization
- action confirmation requirements
- heartbeat and recovery completion

All outbound events are wrapped in a sequenced frame before delivery so replay
and resume stay explicit.

## Auth Surfaces

The runtime distinguishes two broad auth modes:

- credential-scoped auth for harness-facing conversation, message, and tool
  behavior
- admin auth for local management surfaces, with explicit owner-approved
  elevation required for sensitive message reads

The v1 role hierarchy remains:

```text
Owner -> Admin -> Operator -> Credential -> Seal
```

## Where To Read Next

- [onboarding-schemes.md](./onboarding-schemes.md) for the current invite/join
  architecture
- [../configuration.md](../configuration.md) for the live config model
- [../security.md](../security.md) for admin-read elevation and threat model
