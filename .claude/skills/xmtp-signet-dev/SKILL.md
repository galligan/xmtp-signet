---
name: xmtp-signet-dev
description: >
  Work on the xmtp-signet codebase — add features, fix bugs, write handlers,
  extend transports, create schemas, and understand the current v1
  architecture. Teaches the handler contract, package tiers, error taxonomy,
  Result types, and testing patterns. Use this skill whenever working on any
  packages/* code, adding a new feature to the signet, writing or modifying a
  handler, creating or updating Zod schemas, extending a transport adapter,
  debugging signet internals, understanding how the packages relate, or asking
  "where does this code go?"
---

# Working on xmtp-signet

> [!IMPORTANT]
> **Core security invariant:** the harness never touches raw keys, raw DB, or
> the XMTP SDK directly. Every design decision flows from this.

> [!NOTE]
> The current runtime model is v1: operator, policy, credential, seal. The
> public CLI and transport surfaces are credential-native. Do not reintroduce
> `session` / `view` / `grant` language unless you are documenting historical
> design work.

## Where does my code go?

The signet is a 13-package workspace organized into four tiers plus a test
package.

```text
Client       sdk
             |
Transport    ws . mcp . cli / http
             |
Runtime      core . keys . sessions . seals . policy . verifier
             |
Foundation   schemas . contracts

Test         integration
```

### By intent

**"I'm adding a new data shape or boundary type"**
-> `schemas`, then `contracts` if it crosses package boundaries

**"I'm adding a new operator capability or auth flow"**
-> `schemas` for inputs, `policy` for scope logic, then the relevant runtime
package for behavior

**"I'm changing credential lifecycle behavior"**
-> `sessions`

**"I'm changing how messages are filtered or revealed"**
-> `policy` for projection and scope checks, `sessions` for reveal state, and
`ws` or `sdk` only if the wire shape changes

**"I'm working on key material or signing"**
-> `keys`

**"I'm working on seals or trust disclosure"**
-> `seals` or `verifier`

**"I'm exposing or adapting an action on a transport"**
-> define or update the action spec, author semantics first, then add CLI/MCP/HTTP overrides only where needed

**"I'm working on the actual XMTP integration"**
-> `core`

**"I'm adding a new event type"**
-> `schemas` for the event schema, `contracts` for wire format, `ws` for
delivery, `sdk` for client-side typing

## Handler contract

All domain logic uses transport-agnostic handlers:

```typescript
type Handler<TInput, TOutput, TError extends SignetError> = (
  input: TInput,
  ctx: HandlerContext,
) => Promise<Result<TOutput, TError>>;
```

`HandlerContext` includes:

- `requestId`
- `signal`
- optional `adminAuth`
- optional `operatorId`
- optional `credentialId`

Rules:

- parse with Zod at the boundary, not inside handlers
- return `Result<T, E>`, never throw for normal failures
- keep protocol concerns in transports, not handlers

### Adding a handler

1. Define input/output schemas in `schemas`
2. Register an `ActionSpec` in `contracts` with action ID, input schema, and
   authored semantics (`description`, `intent`, `idempotent`). Add output
   schemas, examples, or CLI/MCP/HTTP overrides only when the defaults are not
   enough. HTTP-exposed actions must declare `http.auth`.
3. Implement the handler in the appropriate runtime package
4. Write the test first (TDD is non-negotiable)
5. CLI, admin JSON-RPC, MCP, and HTTP derive their surface from the action
   registry. WebSocket only needs extra wiring if the request/event protocol
   itself changes

## Result types

Use `better-result` for operations that can fail:

```typescript
import { err, ok, type Result } from "better-result";

function requireScope(
  scope: PermissionScopeType,
  effective: Set<PermissionScopeType>,
): Result<void, PermissionError> {
  if (!effective.has(scope)) {
    return err(
      PermissionError.create("Scope not allowed", {
        scope,
      }),
    );
  }
  return ok(undefined);
}
```

Exceptions are for programmer errors or truly unrecoverable failures, not
normal control flow.

## Error taxonomy

Use the shared categories from `@xmtp/signet-schemas`:

| Category | When to use |
|----------|-------------|
| `validation` | Input fails schema validation or business rules |
| `not_found` | Requested resource does not exist |
| `permission` | Caller lacks the required scope |
| `auth` | Invalid or expired credential/admin token |
| `internal` | Unexpected runtime failure |
| `timeout` | Operation exceeded its deadline |
| `cancelled` | Operation cancelled via abort signal |

## Schema-first types

Zod schemas are the source of truth:

```typescript
import { z } from "zod";

const CredentialIssueInput = z.object({
  operatorId: z.string(),
  chatIds: z.array(z.string()),
});

type CredentialIssueInput = z.infer<typeof CredentialIssueInput>;
```

Do not hand-write types that should be inferred from schemas.

## Permission model

The v1 permission system uses allow/deny scope sets. Deny wins.

Typical flow:

1. resolve policy scopes
2. merge credential inline overrides
3. compute effective scopes
4. enforce per-request in handlers or policy helpers

30 scopes across 6 categories: messaging, group-management, metadata, access,
observation, egress.

## Projection pipeline

Harnesses do not receive raw XMTP traffic. Messages pass through a four-stage
pipeline in `packages/policy/src/pipeline/`:

```text
Stage 1: Scope filter        — isInScope() checks credential chat membership
Stage 2: Content type filter — isContentTypeAllowed() checks effective allowlist
Stage 3: Visibility resolver — resolveVisibility() produces visibility state
Stage 4: Content projector   — projectContent() passes or redacts
```

Five internal visibility states: `visible`, `historical`, `revealed`,
`redacted`, `hidden`. Harness sees only the first four; `hidden` stays
internal to the daemon.

If a change affects what a harness can see, start in `policy` and work outward.

## Event model

11 event types in a discriminated union (`SignetEvent`):

- `message.visible`, `message.revealed`, `seal.stamped`
- `credential.issued`, `credential.expired`,
  `credential.reauthorization_required`
- `scopes.updated`, `agent.revoked`, `action.confirmation_required`
- `heartbeat`, `signet.recovery.complete`

7 request types (`HarnessRequest`):

- `send_message`, `send_reaction`, `send_reply`
- `update_scopes`, `reveal_content`, `confirm_action`, `heartbeat`

All events are wrapped in `SequencedFrame` with monotonic `seq` for ordered
delivery over WebSocket.

## Connection lifecycle

The WebSocket transport (`packages/ws/`) manages a state machine:

```text
authenticating -> active -> draining -> closed
```

Key mechanics:

- **Auth**: credential token + optional `lastSeenSeq` for replay
- **Active**: sequenced frames, 30s heartbeat, per-request timeout timers
- **Reconnection**: replay from per-credential `CircularBuffer` via
  `lastSeenSeq`, historical messages tagged with `historical` visibility
- **Draining**: on revocation — no new requests, cancel in-flight, close,
  publish revocation seal

## Seal lifecycle

The seal manager (`packages/seals/`) handles:

- **Issuance**: Ed25519 signature in `SealEnvelope`, chain to previous
- **Chaining**: inline previous payload + computed delta + validation
  (matching IDs, monotonic timestamps)
- **Message binding**: `createMessageBinding` signs canonical
  `{ messageId, sealId }`
- **Renewal**: TTL-based (24h default, renew at 75% elapsed)
- **Materiality**: `isMaterialChange()` skips reissue when delta is empty
- **Republish**: `republishToChats()` with exponential backoff retry
- **Revocation**: `RevocationSeal` permanently marks credential-chat pairs

## Action registry

The action registry is the authored-contract layer for signet actions.

Each action spec contains:

- an action id
- a Zod input schema
- a handler
- optional output schema and examples
- authored semantics such as `description`, `intent`, and `idempotent`
- optional CLI, MCP, and HTTP overrides

The registry derives:

- CLI commands plus the canonical admin RPC method
- MCP tool names plus standard safety annotations
- HTTP method/path/input source for exposed actions

Registry validation catches duplicate action IDs, reserved/conflicting HTTP
routes, and contradictory authored MCP annotations. WebSocket still shares the
same handlers, but it is not a mechanically generated action surface.

## Transport notes

- `ws` is the primary harness-facing transport with sequenced frames and replay
- `mcp` exposes the scoped tool surface with credential context
- `cli` is the composition root and also owns the contract-driven HTTP
  admin/action surface
- `xs cred ...` is the public credential lifecycle surface
- `xs seal ...` is the public seal inspection and verification surface
- `xs policy ...` is the public policy management surface

Do not reintroduce a parallel v0 session/view/grant model when editing these
surfaces.

## Testing

TDD first.

```bash
cd packages/<name> && bun test
bun run test
bun run check
```

Tests live alongside code in `src/__tests__/`.

## Documentation lookup

Use repo tools before guessing:

```bash
blz query -s xmtp "your query" --limit 5 --text
qmd query "your query" -c xmtp-signet
qmd query "your query" -c xmtp-signet-notes
qmd query "your query" -c xmtp-signet-claude
```
