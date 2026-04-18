# Development Guide

## Requirements

- [Bun](https://bun.sh) 1.2.9+
- Node.js 20+ for some tooling
- macOS, Linux, or WSL
- Xcode Command Line Tools on macOS for Secure Enclave support

## Setup

```bash
git clone https://github.com/xmtp/xmtp-signet.git
cd xmtp-signet
bun run bootstrap
```

Bootstrap installs workspace dependencies, repo hooks, and local CLI tools.

For the current docs map, start with [index.md](./index.md).

## Project structure

```text
xmtp-signet/
+-- packages/
|   +-- schemas/          # Zod schemas, types, error taxonomy
|   +-- contracts/        # Service interfaces, handler contract, action specs
|   +-- core/             # XMTP client lifecycle and SDK integration
|   +-- keys/             # Key backend, vault, admin auth, rotation
|   +-- sessions/         # Credential lifecycle, reveal state, pending actions
|   +-- seals/            # Seal lifecycle and provenance
|   +-- policy/           # Scope resolution, projection pipeline, materiality
|   +-- verifier/         # Verification pipeline
|   +-- ws/               # WebSocket transport
|   +-- mcp/              # MCP transport
|   +-- cli/              # CLI entry point, daemon, admin socket, HTTP admin API
|   +-- sdk/              # Harness client SDK
|   +-- integration/      # Cross-package integration tests
+-- adapters/             # First-party harness adapters and reference integrations
+-- signet-signer/        # Swift CLI for Secure Enclave support (macOS)
+-- scripts/              # Bootstrap and repo utilities
+-- docs/                 # Public documentation
+-- .agents/              # Plans, PRDs, notes
+-- .claude/              # Local skills and agent guidance
```

Each package follows the same layout:

```text
packages/<name>/
+-- src/
|   +-- index.ts
|   +-- *.ts
|   +-- __tests__/
|       +-- *.test.ts
+-- package.json
+-- tsconfig.json
```

First-party adapters under `adapters/` should follow the same workspace shape
as packages, while keeping harness-specific setup and runtime logic out of the
core CLI package.

## Terminology

The runtime model is v1. Key terms:

| Term | Meaning |
|------|---------|
| **Operator** | Purpose-built agent profile with role levels |
| **Policy** | Reusable allow/deny permission bundle |
| **Credential** | Time-bound, chat-scoped authorization issued to an operator |
| **Seal** | Signed, group-visible declaration of operator scope |
| **Scope** | Individual permission (e.g., `send`, `read-messages`) |
| **Projection** | Four-stage pipeline filtering messages before harness delivery |
| **Reveal** | Explicit mechanism for surfacing hidden content |
| **Materiality** | Test that determines whether a state change warrants a new seal |

See [concepts.md](concepts.md) for the full conceptual model.

## Commands

### Build and verify

```bash
bun run build
bun run test
bun run typecheck
bun run lint
bun run docs:check
bun run check          # runs all of the above
```

### Single package

```bash
cd packages/<name>
bun test
bun run build
bun run typecheck
bun run lint
```

### CLI

After bootstrap, the local CLI is available as `xs`:

```bash
xs --help
xs daemon start
xs status --json
xs cred issue --op alice-bot --chat conv_9e2d1a4b8c3f7e60 --allow send,reply
xs cred info cred_b2c1
```

If you want to run the entrypoint directly from the repo:

```bash
bun packages/cli/src/bin.ts --help
```

For current-state command and config references:

- [cli.md](./cli.md)
- [configuration.md](./configuration.md)

## Code conventions

### TypeScript

Strict mode with maximum safety:

```jsonc
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "verbatimModuleSyntax": true,
  "isolatedDeclarations": true,
}
```

Defaults:

- no `any`
- avoid `as` casts unless there is no better narrowing path
- ESM only
- derive types from Zod with `z.infer<>`

### Result types

Functions that can fail return `Result<T, E>` from `better-result`:

```typescript
import { err, ok, type Result } from "better-result";

function parseConfig(raw: unknown): Result<Config, ValidationError> {
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return err(ValidationError.create("config", "Invalid config"));
  }
  return ok(parsed.data);
}
```

Do not throw for normal operational failures inside handlers.

### Schema first

Zod schemas are the source of truth:

```typescript
import { z } from "zod";

const CredentialInput = z.object({
  operatorId: z.string(),
  chatIds: z.array(z.string()),
});

type CredentialInput = z.infer<typeof CredentialInput>;
```

### Error taxonomy

Use the shared error categories from `@xmtp/signet-schemas`:

| Category | When to use |
|----------|-------------|
| `validation` | Input fails schema validation or business rules |
| `not_found` | Requested resource does not exist |
| `permission` | Caller lacks the required scope |
| `auth` | Invalid or expired credential/admin token |
| `internal` | Unexpected runtime failure |
| `timeout` | Operation exceeded its deadline |
| `cancelled` | Operation cancelled via abort signal |

### File size

- under 200 LOC: healthy
- 200-400 LOC: look for seams
- over 400 LOC: refactor before extending

## Adding a handler

All domain logic uses the handler contract. To add a new operation:

1. **Define the schema** in `packages/schemas/src/` — input, output, and error
   types as Zod schemas with inferred TypeScript types.

2. **Register the action** in `packages/contracts/src/` — create an
   `ActionSpec` with a unique ID, the input schema, and the authored contract
   semantics that the transports should derive from: `description`, `intent`,
   and `idempotent` when relevant. Add `output`, `examples`, or CLI/MCP/HTTP
   overrides only when the defaults are not enough. HTTP-exposed actions must
   declare `http.auth`.

3. **Implement the handler** in the appropriate runtime package — the function
   receives pre-validated input and `HandlerContext`, returns
   `Result<TOutput, TError>`.

4. **Write the test first** — TDD is non-negotiable. Create the test in the
   package's `src/__tests__/` directory.

5. **Registry-derived surfaces pick it up automatically** — CLI, admin
   JSON-RPC, MCP, and HTTP project from the shared action registry. WebSocket
   still uses the same handlers, but only needs extra wiring when the request
   or event protocol changes.

```typescript
// Handler signature
type Handler<TInput, TOutput, TError extends SignetError> = (
  input: TInput,
  ctx: HandlerContext,
) => Promise<Result<TOutput, TError>>;
```

Handlers must:

- receive pre-validated input (validation happens at the transport boundary)
- return `Result<T, E>`, never throw
- know nothing about WebSocket frames, MCP tool envelopes, or CLI parsing
- use the `signal` from `HandlerContext` for cancellation

## Testing

### TDD workflow

1. Red: write a failing test
2. Green: make it pass
3. Refactor: improve without breaking behavior

```bash
cd packages/<name>
bun test --watch
```

### Test location

Tests live alongside code in `src/__tests__/`.

```typescript
import { describe, expect, it } from "bun:test";

describe("credential issuance", () => {
  it("returns a typed credential record", async () => {
    // ...
  });
});
```

### Boundary validation

Parse external data at the edge with Zod. Internals should operate on typed,
trusted values.

### Integration tests

Cross-package tests live in `packages/integration/`. They validate credential
flows, scope enforcement, seal lifecycle, and transport behavior using a shared
test runtime with in-memory fixtures.

## Documentation tooling

### Local docs lookup

For searching repo-local documentation:

```bash
# Repo-local docs and plans
qmd query "your query" -c xmtp-signet
qmd query "your query" -c xmtp-signet-notes
```

### XMTP SDK docs

For XMTP protocol and SDK reference:

```bash
blz query -s xmtp "your query" --limit 5 --text
```

### Refreshing indexes

If you change docs or skills, refresh the local index:

```bash
qmd update
qmd embed
```

### API doc coverage

Exported API documentation coverage is enforced by `bun run docs:check`. All
public exports must have TSDoc comments.
