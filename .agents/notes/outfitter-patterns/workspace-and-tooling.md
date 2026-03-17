# Workspace and Tooling Patterns

Extracted from `outfitter/stack` as reference for xmtp-broker scaffolding.

## Bun Workspace

- Root `package.json` with `"type": "module"` (ESM-only)
- Workspaces: `packages/*`, `apps/*`, `plugins/*`, `examples/*`
- Bun version pinned in `.bun-version` (e.g., `1.3.10`) — CI reads from this file
- `packageManager` field in root package.json for toolchain enforcement
- **Bun catalogs** for centralized dependency versions — workspace packages use `catalog:` instead of specific versions
- Internal packages use `workspace:*` for cross-references

## TypeScript

Shared base config (`tsconfig.base.json`) extended by all packages.

Key strictness settings:
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `noPropertyAccessFromIndexSignature: true`
- `noImplicitReturns: true`
- `noFallthroughCasesInSwitch: true`
- `noUnusedLocals: true` / `noUnusedParameters: true`
- `isolatedModules: true` / `isolatedDeclarations: true`
- `verbatimModuleSyntax: true`

Module settings:
- `target: "ESNext"`
- `moduleResolution: "bundler"`
- `declaration: true` with source maps

Per-package configs extend base with `outDir: "./dist"`, `rootDir: "./src"`, exclude `node_modules`, `dist`, `src/__tests__`.

## Linting: oxlint

Config in `.oxlintrc.json`:
- `correctness` and `suspicious` categories set to `error`
- Custom plugin (`@outfitter/oxlint-plugin`) for org-specific rules:
  - `max-file-lines`: warn at 200, error at 400
  - `handler-must-return-result`: error
  - `no-console-in-packages`: error
  - `no-cross-tier-import`: error (architecture enforcement)
  - `no-deep-relative-import`: warn
  - `no-throw-in-handler`: warn
  - `prefer-bun-api`: warn
- Ignores: `node_modules/**`, `dist/**`, `.turbo/**`, `*.gen.ts`, `__snapshots__/**`, `fixtures/**`

## Formatting: oxfmt

Config in `.oxfmtrc.jsonc`:
- Print width: 80
- Indent: 2 spaces
- Double quotes
- Trailing commas: ES5
- Semicolons: always
- Import sorting: ASC order with newline separators

## Build System: Turbo

Config in `turbo.json`:
- Remote cache enabled (signed)
- Global deps: `.bun-version`, `.oxlintrc.json` invalidate all caches
- `build` depends on upstack builds; inputs `src/**`, `scripts/**`, `tsconfig.json`; outputs `dist/**`
- `test` depends on build; **cache disabled** (always runs)
- `typecheck` depends on upstack builds
- `lint` depends on upstack builds + oxlint-plugin build

Build tool: **bunup** (Bun's native bundler) with a lock script to serialize builds and prevent package.json race conditions under parallel Turbo.

## Testing: bun:test

- Test files: `src/__tests__/*.test.ts`
- Snapshots: `src/__snapshots__/*.snap`
- Run via `bun test` (per-package) or `bun run test` (root, via Turbo)
- Test cache disabled in Turbo — always reruns

## Git Hooks: Lefthook

`.lefthook.yml`:
- **Pre-commit**: runs linter/formatter on staged files with `stage_fixed: true`
- **Pre-push**: full verification including schema drift, block drift, docs sentinel

## Package Conventions

- Scope: `@outfitter/*`
- `publishConfig.access: "public"`
- Explicit, granular exports (e.g., `@outfitter/contracts/result`, `@outfitter/contracts/errors`)
- Entry points: `./dist/index.js` with types at `./dist/index.d.ts`
- Three-tier hierarchy: Foundation (contracts, types) -> Runtime (cli, mcp, config, logging) -> Tooling (outfitter CLI, presets, docs)

## Adaptation Notes for xmtp-broker

**Adopt directly:**
- Bun workspace with `.bun-version` pin
- ESM-only with `"type": "module"`
- Max-strict tsconfig base config
- oxlint + oxfmt (but without the custom plugin initially)
- Turbo for build orchestration
- Lefthook for git hooks
- bun:test as test runner

**Adapt:**
- No need for Bun catalogs until there are multiple packages
- Custom oxlint rules can come later once patterns stabilize
- bunup lock script only needed with parallel package builds
- Start simpler — single package, grow into workspace as needed

**Skip:**
- @outfitter/* packages themselves (goal is zero dependency on them)
- Changesets (not publishing to npm initially)
