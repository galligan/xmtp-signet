# 01 — Repo Scaffolding

## Overview

This spec defines the workspace structure, build tooling, and developer conventions for xmtp-broker. It is the foundation every other spec depends on — nothing compiles, tests, or lints until this is in place.

The broker is a Bun-first TypeScript monorepo using workspaces from day one. The monorepo structure enforces the three-tier architecture (Foundation, Runtime, Transport) through package boundaries rather than convention alone. Each tier maps to a set of packages with explicit dependency rules: dependencies flow downward only.

Monorepo from day one is the right call. The tier boundaries are load-bearing for security (raw plane vs. derived plane isolation), and enforcing them through package imports is cheaper than enforcing them through lint rules. The cost is minimal — Bun workspaces + Turbo handle the orchestration, and each package starts as a single `src/index.ts` file.

## Dependencies

This spec has no code dependencies. It produces the workspace root and per-package scaffolding that all other specs build on.

**Produces:**
- Root `package.json`, `tsconfig.base.json`, `turbo.json`, `.lefthook.yml`
- Per-package `package.json` and `tsconfig.json` stubs
- Linting and formatting configs
- CI pipeline

**Consumed by:** Every other spec (02 through 09).

## Public Interfaces

N/A — this spec produces configuration, not code.

## Zod Schemas

N/A.

## Behaviors

### Workspace Layout

```
xmtp-broker/
├── .agents/                    # Plans, notes, agent docs (existing)
├── .bun-version                # Bun version pin (read by CI)
├── .github/
│   └── workflows/
│       └── ci.yml              # Lint, typecheck, test on PR
├── .lefthook.yml               # Git hooks
├── .oxfmtrc.jsonc              # Formatter config
├── .oxlintrc.json              # Linter config
├── .reference/                 # Read-only reference codebases (gitignored)
├── apps/                          # Runnable entrypoints (empty for now)
├── packages/
│   ├── schemas/                # @xmtp-broker/schemas
│   ├── contracts/              # @xmtp-broker/contracts
│   ├── core/                   # @xmtp-broker/core
│   ├── policy/                 # @xmtp-broker/policy
│   ├── sessions/               # @xmtp-broker/sessions
│   ├── attestations/           # @xmtp-broker/attestations
│   ├── keys/                   # @xmtp-broker/keys
│   ├── ws/                     # @xmtp-broker/ws
│   └── verifier/               # @xmtp-broker/verifier
├── package.json                # Workspace root
├── tsconfig.base.json          # Shared TypeScript config
├── turbo.json                  # Build orchestration
├── AGENTS.md
├── CLAUDE.md
└── README.md
```

Each package follows the same internal structure:

```
packages/<name>/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                # Public exports
│   └── __tests__/
│       └── *.test.ts
```

### Root package.json

```jsonc
{
  "name": "xmtp-broker",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "packageManager": "bun@1.2.9",
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "lint": "turbo run lint",
    "format:check": "oxfmt --check .",
    "format:fix": "oxfmt .",
    "check": "turbo run lint typecheck test"
  },
  "devDependencies": {
    "@biomejs/js-api": "catalog:",
    "lefthook": "catalog:",
    "oxlint": "catalog:",
    "turbo": "catalog:",
    "typescript": "catalog:"
  }
}
```

**Note on Bun catalogs:** Use the `[catalog]` field in root `package.json` to centralize shared dependency versions. Workspace packages reference them with `"catalog:"` instead of pinned versions. This avoids version drift across packages.

```jsonc
// Root package.json (additional field)
{
  "catalog": {
    "better-result": "^1.1.0",
    "zod": "^3.24.0",
    "typescript": "^5.8.0",
    "oxlint": "^0.18.0",
    "turbo": "^2.5.0",
    "lefthook": "^1.11.0"
  }
}
```

### .bun-version

```
1.2.9
```

Pin the Bun version. CI reads this file. Developers use `bun upgrade` to match.

### Per-Package package.json Template

```jsonc
{
  "name": "@xmtp-broker/<name>",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "bun build ./src/index.ts --outdir ./dist --target bun",
    "typecheck": "tsc --noEmit",
    "lint": "oxlint .",
    "test": "bun test"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "catalog:"
  }
}
```

**Package-specific dependencies** (added per spec, not all at once):

| Package | Runtime deps | Workspace deps |
|---------|-------------|----------------|
| `schemas` | `zod`, `better-result` | — |
| `contracts` | `better-result` | `@xmtp-broker/schemas` |
| `core` | `@xmtp/node-sdk`, `better-result` | `@xmtp-broker/schemas`, `@xmtp-broker/contracts` |
| `policy` | `better-result` | `@xmtp-broker/schemas`, `@xmtp-broker/contracts` |
| `sessions` | `better-result` | `@xmtp-broker/schemas`, `@xmtp-broker/contracts` |
| `attestations` | `better-result` | `@xmtp-broker/schemas`, `@xmtp-broker/contracts` |
| `keys` | `better-result` | `@xmtp-broker/schemas`, `@xmtp-broker/contracts` |
| `ws` | `better-result` | `@xmtp-broker/schemas`, `@xmtp-broker/contracts`, `@xmtp-broker/core`, `@xmtp-broker/policy`, `@xmtp-broker/sessions` |
| `verifier` | `better-result`, `zod` | `@xmtp-broker/schemas` |

Workspace deps use `"workspace:*"` in the `dependencies` field.

### TypeScript Configuration

**tsconfig.base.json:**

```jsonc
{
  "compilerOptions": {
    // Strictness
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,

    // Modules
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "isolatedDeclarations": true,
    "resolveJsonModule": true,
    "esModuleInterop": false,

    // Output
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true
  }
}
```

**Per-package tsconfig.json:**

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["bun-types"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/__tests__"]
}
```

### Linting: oxlint

**.oxlintrc.json:**

```jsonc
{
  "rules": {
    "correctness": "error",
    "suspicious": "error"
  },
  "ignorePatterns": [
    "node_modules/**",
    "dist/**",
    ".turbo/**",
    ".reference/**",
    "*.gen.ts"
  ]
}
```

No custom plugin for v0. The built-in `correctness` and `suspicious` categories catch real bugs without noise. Custom rules (max-file-lines, no-throw-in-handler, no-cross-tier-import) are a post-v0 concern once patterns stabilize.

### Formatting: oxfmt

**.oxfmtrc.jsonc:**

```jsonc
{
  "printWidth": 80,
  "indentWidth": 2,
  "useTabs": false,
  "quoteStyle": "double",
  "trailingCommas": "es5",
  "semicolons": "always"
}
```

### Build System: Turbo

**turbo.json:**

```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": [".bun-version", ".oxlintrc.json"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "tsconfig.json", "package.json"],
      "outputs": ["dist/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "tsconfig.json", "package.json"],
      "outputs": []
    },
    "lint": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", ".oxlintrc.json"],
      "outputs": []
    },
    "test": {
      "dependsOn": ["^build"],
      "cache": false,
      "inputs": ["src/**"],
      "outputs": []
    }
  }
}
```

Test caching is disabled — tests always run. This is deliberate: tests are cheap in Bun and stale test results are dangerous.

### Git Hooks: Lefthook

**.lefthook.yml:**

```yaml
pre-commit:
  parallel: true
  commands:
    format:
      glob: "*.{ts,tsx,js,json,jsonc}"
      run: bunx oxfmt {staged_files}
      stage_fixed: true
    lint:
      glob: "*.{ts,tsx,js}"
      run: bunx oxlint {staged_files}

pre-push:
  commands:
    typecheck:
      run: bun run typecheck
    test:
      run: bun run test
    lint:
      run: bun run lint
```

Pre-commit is fast (format + lint on staged files only). Pre-push runs the full verification suite. This catches issues before they hit CI without slowing down commits.

### CI Pipeline

**.github/workflows/ci.yml:**

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  check:
    name: Lint, Typecheck, Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Read Bun version
        id: bun-version
        run: echo "version=$(cat .bun-version)" >> "$GITHUB_OUTPUT"

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: ${{ steps.bun-version.version }}

      - run: bun install --frozen-lockfile

      - name: Format check
        run: bun run format:check

      - name: Lint
        run: bun run lint

      - name: Typecheck
        run: bun run typecheck

      - name: Test
        run: bun run test
```

Single job for v0. Split into parallel jobs when the build time justifies it. Format check runs first because it is the cheapest gate.

### Blessed Dependencies

Complete table of what to use for each concern. Do not add dependencies outside this list without explicit discussion.

| Concern | Package | Notes |
|---------|---------|-------|
| Result type | `better-result` | All fallible functions return `Result<T, E>` |
| Schema validation | `zod` | Single source of truth for types via `z.infer<>` |
| Testing | `bun:test` | Built-in, zero-config |
| XMTP SDK | `@xmtp/node-sdk` | The broker wraps this; only `core` package imports it |
| WebSocket server | `Bun.serve()` | Built-in WebSocket support; no external package |
| SQLite | `bun:sqlite` | For session/key storage if needed |
| Hashing | `Bun.hash()` / `Bun.CryptoHasher` | Built-in; no `crypto` import needed |
| File I/O | `Bun.file()` / `Bun.write()` | Built-in |
| Linting | `oxlint` | Dev dependency, root only |
| Formatting | `oxfmt` | Dev dependency, root only |
| Build orchestration | `turbo` | Dev dependency, root only |
| Git hooks | `lefthook` | Dev dependency, root only |
| TypeScript | `typescript` | Dev dependency, type checking only (Bun runs TS directly) |

**Explicitly not used:**
- No `express`, `fastify`, `hono` — `Bun.serve()` handles HTTP/WS
- No `jest`, `vitest` — `bun:test` is the runner
- No `eslint`, `prettier` — `oxlint` and `oxfmt` replace them
- No `esbuild`, `tsup`, `unbuild` — `bun build` is sufficient
- No `@outfitter/*` — zero dependency on external frameworks

### Package Stub Content

Each package starts with a minimal `src/index.ts` that exports nothing meaningful:

```typescript
// src/index.ts
// Placeholder — see spec 0X for real exports.
export {};
```

This ensures `bun build`, `tsc --noEmit`, and `bun test` all pass on the empty workspace before any real code is written.

## Error Cases

N/A — configuration spec.

## Open Questions Resolved

| Question | Resolution | Rationale |
|----------|-----------|-----------|
| Mono-package vs monorepo? | Monorepo from day one with Bun workspaces. | The tier boundaries (Foundation/Runtime/Transport) are security-critical. Package boundaries enforce them through the module system. The overhead is minimal — each package is a `package.json`, `tsconfig.json`, and `src/index.ts`. Turbo handles build ordering. |
| Bun catalogs? | Yes, use `catalog:` for shared dependency versions. | Prevents version drift across 8 packages. One place to update `zod`, `better-result`, etc. |
| Custom oxlint plugin? | Not for v0. | Patterns haven't stabilized. Built-in `correctness` + `suspicious` categories are sufficient. Custom rules (max-file-lines, no-cross-tier-import) are a post-v0 concern. |
| Build tool (bunup vs bun build)? | `bun build` directly. No bunup lock script. | The broker is not published to npm, so advanced bundling is unnecessary. `bun build` produces ESM output. If parallel build races surface, add a lock script then. |
| Remote Turbo cache? | Not for v0. | No shared CI infra yet. Add when build times justify it. |

## Deferred

- **Custom oxlint plugin** — rules like `no-cross-tier-import`, `max-file-lines`, `no-throw-in-handler`. Add once patterns are stable.
- **Changesets / versioning** — not publishing to npm; versions stay at `0.0.0`.
- **Remote Turbo cache** — no shared build infra yet.
- **`apps/` directory** — workspace glob included (`apps/*`), but no runnable application until the broker CLI exists (post-v0).
- **Bun bunup** — `bun build` is sufficient for non-published packages.
- **Import sorting** — oxfmt handles this; no additional tooling.

## Testing Strategy

The scaffolding itself is verified by running the full toolchain on the empty workspace:

1. `bun install` — workspace resolution succeeds
2. `bun run build` — all packages build (empty exports)
3. `bun run typecheck` — all packages pass type checking
4. `bun run lint` — no lint errors on empty stubs
5. `bun run format:check` — all files formatted
6. `bun run test` — test runner executes (no tests yet, zero failures)

These are manual verification steps, not automated tests. The scaffolding spec's "test" is that the toolchain works end to end.

### Smoke Test File

Add one test file to `packages/schemas/` to verify the test runner works:

```typescript
// packages/schemas/src/__tests__/smoke.test.ts
import { describe, expect, it } from "bun:test";

describe("workspace", () => {
  it("test runner works", () => {
    expect(true).toBe(true);
  });
});
```

## File Layout

Exact files to create, with brief descriptions:

```
.bun-version                                    # "1.2.9"
.github/workflows/ci.yml                        # CI pipeline
.lefthook.yml                                   # Git hooks config
.oxfmtrc.jsonc                                  # Formatter config
.oxlintrc.json                                  # Linter config
package.json                                    # Workspace root
tsconfig.base.json                              # Shared TS config
turbo.json                                      # Build orchestration

packages/schemas/package.json                   # @xmtp-broker/schemas
packages/schemas/tsconfig.json                  # Extends base
packages/schemas/src/index.ts                   # Export stub
packages/schemas/src/__tests__/smoke.test.ts    # Smoke test

packages/contracts/package.json                 # @xmtp-broker/contracts
packages/contracts/tsconfig.json
packages/contracts/src/index.ts

packages/core/package.json                      # @xmtp-broker/core
packages/core/tsconfig.json
packages/core/src/index.ts

packages/policy/package.json                    # @xmtp-broker/policy
packages/policy/tsconfig.json
packages/policy/src/index.ts

packages/sessions/package.json                  # @xmtp-broker/sessions
packages/sessions/tsconfig.json
packages/sessions/src/index.ts

packages/attestations/package.json              # @xmtp-broker/attestations
packages/attestations/tsconfig.json
packages/attestations/src/index.ts

packages/keys/package.json                      # @xmtp-broker/keys
packages/keys/tsconfig.json
packages/keys/src/index.ts

packages/ws/package.json                        # @xmtp-broker/ws
packages/ws/tsconfig.json
packages/ws/src/index.ts

packages/verifier/package.json                  # @xmtp-broker/verifier
packages/verifier/tsconfig.json
packages/verifier/src/index.ts
```

Total: 31 files. All are configuration or stubs — no domain logic.
