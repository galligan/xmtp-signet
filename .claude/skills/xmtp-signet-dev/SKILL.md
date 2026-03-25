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
             ↓
Transport    ws · mcp · cli / http
             ↓
Runtime      core · keys · sessions · seals · policy · verifier
             ↓
Foundation   schemas · contracts

Test         integration
```

### By intent

**"I'm adding a new data shape or boundary type"**
→ `schemas`, then `contracts` if it crosses package boundaries

**"I'm adding a new operator capability or auth flow"**
→ `schemas` for inputs, `policy` for scope logic, then the relevant runtime
package for behavior

**"I'm changing credential lifecycle behavior"**
→ `sessions`

**"I'm changing how messages are filtered or revealed"**
→ `policy` for projection and scope checks, `sessions` for reveal state, and
`ws` or `sdk` only if the wire shape changes

**"I'm working on key material or signing"**
→ `keys`

**"I'm working on seals or trust disclosure"**
→ `seals` or `verifier`

**"I'm exposing or adapting an action on a transport"**
→ define or update the action spec, then wire CLI or MCP metadata where needed

**"I'm working on the actual XMTP integration"**
→ `core`

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

- `validation`
- `not_found`
- `permission`
- `auth`
- `internal`
- `timeout`
- `cancelled`

In this repo, `auth` usually means invalid or expired admin tokens or
credentials.

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

The current scope categories are:

- messaging
- group-management
- metadata
- access
- observation
- egress

## Projection model

Harnesses do not receive raw XMTP traffic. Messages are projected before
delivery:

```text
Raw XMTP event
  → chat scope check
  → permission / reveal check
  → content projection
  → transport event to harness
```

If a change affects what a harness can see, start in `policy` and work outward.

## Action registry

The action registry is the define-once, expose-everywhere pattern.

Each action spec contains:

- an action id
- a Zod input schema
- a handler
- optional CLI metadata
- optional MCP metadata

CLI, MCP, and WebSocket consume the same action definitions.

## Transport notes

- `ws` is the primary harness-facing transport
- `mcp` exposes the scoped tool surface
- `cli` is the composition root and also owns the HTTP admin API
- `xs credential ...` is the public credential lifecycle surface
- `xs seal ...` is the public seal inspection and verification surface

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
qmd query "your query" -c xmtp-signet-plans
qmd query "your query" -c xmtp-signet-claude
```
