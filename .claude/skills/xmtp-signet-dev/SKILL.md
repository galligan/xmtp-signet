---
name: xmtp-signet-dev
description: >
  Work on the xmtp-signet codebase — add features, fix bugs, write handlers,
  extend transports, create schemas, and understand the architecture. Teaches
  the handler contract, package tiers, error taxonomy, Result types, and testing
  patterns. Use this skill whenever working on any packages/* code, adding a new
  feature to the signet, writing or modifying a handler, creating or updating
  Zod schemas, extending a transport adapter, debugging signet internals,
  understanding how the packages relate, or asking "where does this code go?"
---

# Working on xmtp-signet

> [!IMPORTANT]
> **Core security invariant:** The harness never touches raw keys, raw DB, or
> raw XMTP SDK. Every design decision flows from this. If a change would expose
> raw credentials to a harness, stop and rethink.

## Where does my code go?

Start here. The signet is 13 packages organized into four tiers plus a test
package. Dependencies flow downward only — never import from a higher tier.

```
Client       sdk
             ↓
Transport    ws · mcp · cli · http
             ↓
Runtime      core · keys · sessions · seals · policy · verifier
             ↓
Foundation   schemas · contracts

Test         integration (test-only, cross-package)
```

### By intent

**"I'm adding a new message type or data shape"**
→ `schemas` (Zod schema + inferred type) → `contracts` (if it crosses package
boundaries) → `policy` (if it needs filtering or grant validation)

**"I'm adding an action an agent can perform"**
→ `schemas` (grant variant) → `policy` (grant validation function) → handler
in the relevant runtime package

**"I'm changing how messages are filtered or projected"**
→ `policy` (view projection pipeline: scope → content-type → visibility →
content projector)

**"I'm adding or changing a transport"**
→ `ws` as the reference implementation. `mcp` converts ActionSpecs to MCP
tools. `cli` is the composition root with daemon lifecycle and admin socket.
`http` handles non-streaming admin/session/health routes. Transports are thin
adapters: parse protocol input → call handler → format protocol output. They
never contain domain logic.

**"I'm working on key management or signing"**
→ `keys` (three-tier hierarchy: root → operational → session). See
`references/key-hierarchy.md` for the full model.

**"I'm working on seals or verification"**
→ `seals` (lifecycle, building, signing, publishing, delta computation) or
`verifier` (the 6-check trust verification service)

**"I'm working on session lifecycle"**
→ `sessions` (token generation, policy hashing, materiality detection)

**"I'm building a harness client"**
→ `sdk` — the harness-facing client SDK with typed events, Result-based
requests, and automatic reconnection

**"I'm working on the XMTP client itself"**
→ `core` — the only package that touches `@xmtp/node-sdk` directly

For the full package API surface, see `references/packages.md`.

## Handler contract

All domain logic uses transport-agnostic handlers:

```typescript
type Handler<TInput, TOutput, TError extends SignetError> = (
  input: TInput,
  ctx: HandlerContext,
) => Promise<Result<TOutput, TError>>;
```

`HandlerContext` is defined in `@xmtp/signet-contracts` with `requestId`,
`signal`, and optional `adminAuth`/`sessionId`.

**Rules:**
- Handlers receive pre-validated input (Zod parsing happens at the transport
  boundary, not inside handlers)
- Handlers return `Result<T, E>` from `better-result` — never throw
- Handlers know nothing about WebSocket frames, HTTP status codes, or CLI
  exit codes
- Transport adapters do all protocol mapping

**Example — grant validation in the policy package:**

```typescript
function validateSendMessage(
  grant: GrantConfig,
  groupId: string,
  scope: ViewConfig,
): Result<void, PermissionError> {
  if (!grant.messaging?.send) {
    return err(
      new PermissionError("send not granted", {
        category: "permission",
        grant: "messaging.send",
      }),
    );
  }
  return checkGroupInScope(groupId, scope);
}
```

## Result types

Functions that can fail return `Result<T, E>`. No `throw` in handler code.

```typescript
import { ok, err, type Result } from "better-result";

// Return success
return ok(parsedData);

// Return failure
return err(new ValidationError("bad input", { field: "groupId" }));

// Check results
const result = await handler(input, ctx);
if (!result.ok) {
  // result.error is typed as TError
  return err(result.error);
}
// result.value is typed as TOutput
```

**Why:** Exceptions are invisible in type signatures and break the handler
contract. Result types make failure explicit and composable.

## Error taxonomy

Every error has a `category` that maps to protocol-specific codes across all
transports:

| Category     | When to use                           | Retryable |
| ------------ | ------------------------------------- | --------- |
| `validation` | Bad input, schema violation           | No        |
| `not_found`  | Resource doesn't exist                | No        |
| `permission` | Grant denied, insufficient scope      | No        |
| `auth`       | Session expired, invalid token        | No        |
| `internal`   | Invariant violation, unexpected state | No        |
| `timeout`    | Operation exceeded time limit         | Yes       |
| `cancelled`  | Cancelled by signal or user           | No        |

Use the error constructors from `@xmtp/signet-schemas`:

```typescript
import {
  ValidationError,
  PermissionError,
  NotFoundError,
} from "@xmtp/signet-schemas";
```

## Schema-first types

Zod schemas are the single source of truth. Types are derived, never
hand-written:

```typescript
import { z } from "zod";

const ViewConfigSchema = z.object({
  mode: ViewMode,
  scope: z.array(ThreadScope).optional(),
  allowlist: ContentTypeAllowlist.optional(),
});

type ViewConfig = z.infer<typeof ViewConfigSchema>;
```

**No manual type duplication.** If the schema changes, the type changes
automatically. If you need a type that doesn't have a schema yet, write the
schema first.

## Testing

TDD — write the test before the code.

```typescript
import { describe, it, expect } from "bun:test";
import { ok, err } from "better-result";

describe("validateSendMessage", () => {
  it("returns ok when send is granted and group is in scope", () => {
    const result = validateSendMessage(grantWithSend, groupId, viewConfig);
    expect(result.ok).toBe(true);
  });

  it("returns permission error when send is not granted", () => {
    const result = validateSendMessage(grantWithoutSend, groupId, viewConfig);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("permission");
    }
  });
});
```

Tests live alongside code in `src/__tests__/*.test.ts`. Run with:

```bash
cd packages/<name> && bun test          # single package
bun run test                            # all packages
bun run check                           # lint + typecheck + test
```

## View projection pipeline

When a message arrives from XMTP, it passes through these stages in `policy`
before reaching any harness:

```
Raw XMTP Message
  → isInScope()           — is this group/thread in the agent's view?
  → isContentTypeAllowed() — is this content type in the allowlist?
  → resolveVisibility()    — full / redacted / reveal-only / summary?
  → projectContent()       — apply visibility mode to message body
  → ProjectionResult delivered to harness
```

Each stage can reject the message. Extend the pipeline by adding a new filter
stage, not by modifying existing ones.

## Adding a new transport

Use `ws` as the template. Existing transports:

- **ws** — WebSocket (primary harness transport) with session resumption,
  frame sequencing, backpressure tracking, and graceful shutdown
- **mcp** — Converts `ActionSpec` to MCP tools with session-scoped auth
- **cli** — Composition root with 8 command groups, daemon lifecycle, admin
  Unix socket (JSON-RPC 2.0), HTTP server, and direct mode fallback
- **http** — Non-streaming admin/session/health routes via `Bun.serve()`

A transport adapter:

1. Accepts protocol connections (WebSocket, HTTP, CLI stdin)
2. Parses incoming frames/requests with Zod schemas at the boundary
3. Validates session tokens via the auth handler
4. Routes requests through the handler contract (or the `ActionRegistry`)
5. Formats Result values into protocol-specific responses
6. Broadcasts events from the signet to connected harnesses

The transport never contains domain logic. If you're writing an `if` statement
about grants or views inside a transport adapter, that logic belongs in
`policy`.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Throwing instead of returning `err()` | Handlers return `Result`, never throw |
| Using `any` or `as` casts | Narrow with type guards or Zod parsing |
| Hand-writing types that mirror schemas | Use `z.infer<typeof Schema>` |
| Putting domain logic in a transport | Move it to the appropriate runtime package |
| Importing from a higher tier | Dependencies flow downward only |
| Skipping the test | Write it first. Red → Green → Refactor |
| Catching exceptions in handler code | Let the transport boundary handle unexpected throws |
| Adding a dependency without checking | Check blessed deps in CLAUDE.md first |
| Using "attestations" instead of "seals" | The package is `seals`; attestations are the signed data inside a seal |

## File size guardrails

- Under 200 LOC: healthy
- 200–400 LOC: identify seams for splitting
- Over 400 LOC: refactor before extending

## References

- `references/packages.md` — Per-package API surface, exports, and dependencies
- `references/architecture.md` — Package tier diagram, data flow, dependency rules
- `references/key-hierarchy.md` — Three-tier key model, vault, platform detection
