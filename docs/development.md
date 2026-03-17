# Development Guide

## Requirements

- [Bun](https://bun.sh) 1.2.9+
- Node.js 20+ (for some tooling)
- macOS, Linux, or WSL

## Setup

```bash
git clone https://github.com/xmtp/xmtp-signet.git
cd xmtp-signet
bun install
bunx lefthook install
```

This installs workspace dependencies and sets up git hooks via Lefthook.

## Project structure

```
xmtp-signet/
├── packages/
│   ├── schemas/          # Zod schemas, types, error taxonomy
│   ├── contracts/        # Service interfaces, action specs, wire formats
│   ├── core/             # XMTP client lifecycle, SDK integration
│   ├── keys/             # Key hierarchy, vault, signers, admin keys
│   ├── sessions/         # Session lifecycle, token generation
│   ├── seals/            # Seal lifecycle, signing
│   ├── policy/           # View projection, grant validation
│   ├── verifier/         # 6-check verification service
│   ├── ws/               # WebSocket transport (Bun.serve)
│   ├── mcp/              # MCP transport (Model Context Protocol)
│   ├── cli/              # CLI entry point, daemon, admin socket
│   ├── handler/          # Harness client SDK (WebSocket)
│   └── integration/      # Cross-package integration tests
├── docs/                 # Documentation
└── .agents/              # Planning docs and working notes
```

Each package has the same internal layout:

```
packages/<name>/
├── src/
│   ├── index.ts          # Public API exports
│   ├── *.ts              # Implementation modules
│   └── __tests__/
│       └── *.test.ts     # Tests alongside code
├── package.json
└── tsconfig.json
```

## Commands

### Build and test

```bash
bun run build              # Build all packages (Turbo)
bun run test               # Test all packages
bun run check              # Lint + typecheck + test (full verification)
```

### Single package

```bash
cd packages/<name>
bun test                   # Run tests for this package
bun run build              # Build this package
bun run typecheck           # Type-check this package
bun run lint                # Lint this package
```

### Formatting and linting

```bash
bun run format:check       # Check formatting (oxfmt)
bun run format:fix         # Fix formatting
bun run lint               # Run linter (oxlint)
bun run typecheck          # Type-check all packages (tsc --noEmit)
```

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

- No `any` — use `unknown` and narrow
- No `as` casts — narrow instead of assert
- ESM-only (`"type": "module"`)
- Types derived from Zod schemas via `z.infer<>`

### Result types

Functions that can fail return `Result<T, E>` from `better-result`:

```typescript
import { ok, err, type Result } from "better-result";

function parseConfig(raw: unknown): Result<Config, ValidationError> {
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return err(new ValidationError("Invalid config", parsed.error));
  }
  return ok(parsed.data);
}
```

No `throw` in handler code. Exceptions are reserved for truly unrecoverable situations (programmer errors, not operational failures).

### Schema-first

Zod schemas are the single source of truth:

```typescript
import { z } from "zod";

const MessageSchema = z.object({
  id: z.string(),
  content: z.string(),
  timestamp: z.number(),
});

type Message = z.infer<typeof MessageSchema>;
```

No manual type duplication. If the schema changes, the type changes automatically.

### File size

- Under 200 LOC: healthy
- 200–400 LOC: identify seams for splitting
- Over 400 LOC: refactor before extending

### Formatting

oxfmt with these settings:

- 80-character line width
- 2-space indent
- Double quotes
- Trailing commas (ES5)
- Semicolons

## Testing

### TDD workflow

1. **Red** — Write a failing test that defines the expected behavior
2. **Green** — Write the minimal code to make it pass
3. **Refactor** — Improve the code while keeping it green

```bash
# Watch mode for a single package
cd packages/<name>
bun test --watch
```

### Test structure

Tests live alongside code in `src/__tests__/`:

```typescript
import { describe, it, expect } from "bun:test";

describe("parseConfig", () => {
  it("returns ok for valid input", () => {
    const result = parseConfig({
      /* valid */
    });
    expect(result.ok).toBe(true);
  });

  it("returns err for missing fields", () => {
    const result = parseConfig({});
    expect(result.ok).toBe(false);
  });
});
```

### Validate at boundaries

Parse external data at the edge with Zod schemas. Trust types internally — don't re-validate inside handler code.

## Git workflow

### Branching

Trunk-based development on `main`. Stacked PRs via [Graphite](https://graphite.dev):

```bash
gt create 'feat/my-feature' -am "feat(scope): description"
gt submit --no-interactive
```

Use `gt` commands instead of raw `git` — see the [Graphite docs](https://graphite.dev/docs) for the full workflow.

### Commits

Conventional commits with scope:

```
feat(schemas): add reveal request schema
fix(policy): handle empty allowlist edge case
test(sessions): add materiality detection tests
refactor(core): extract client registry
docs(readme): update package table
```

### Pre-commit hooks

Lefthook runs on every commit:

- **Pre-commit**: format and lint staged files
- **Pre-push**: full verification (`bun run check`)

If a hook fails, fix the issue before committing. Don't skip hooks.

## Adding a new package

1. Create the directory structure:

```bash
mkdir -p packages/<name>/src/__tests__
```

2. Add `package.json` following the existing pattern (see any package for reference)
3. Add `tsconfig.json` extending the root config
4. Export the public API from `src/index.ts`
5. Add the package to the dependency graph if other packages need it

## Dependencies

Check the blessed dependencies list before adding anything new:

| Concern           | Package                     |
| ----------------- | --------------------------- |
| Result type       | `better-result`             |
| Schema validation | `zod`                       |
| Testing           | `bun:test`                  |
| XMTP SDK          | `@xmtp/node-sdk`           |
| CLI framework     | `commander`                 |
| TOML parsing      | `smol-toml`                 |
| MCP SDK           | `@modelcontextprotocol/sdk` |
| Schema→JSON       | `zod-to-json-schema`        |

Prefer Bun-native APIs (`Bun.hash()`, `Bun.Glob`, `bun:sqlite`, `Bun.serve()`) over npm packages. If a concern isn't covered by the blessed list or Bun, discuss before pulling in a new dependency.
