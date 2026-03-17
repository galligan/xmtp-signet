# CLAUDE.md -- xmtp-broker

An agent broker for XMTP. The broker is the real XMTP client; agent harnesses connect through a controlled interface with scoped views and grants. See [README.md](README.md) for an overview and [.agents/docs/init/xmtp-broker.md](.agents/docs/init/xmtp-broker.md) for the full PRD.

## Status

Active development. Phase 2C complete across 38 stacked PRs, all review feedback addressed. CLI daemon with real XMTP network connectivity (devnet), Convos invite protocol, conversation management (create, list, info, join, invite, add-member, members). Tracer bullet validated end-to-end on devnet with QR code invite flow. Ready for merge to main.

## Project Structure

- `packages/` — Versioned libraries (source in `src/`, tests in `src/__tests__/`)
- `.agents/docs/` — Planning documents and PRD
- `.agents/plans/` — Specs, execution plans, and design decisions
- `.agents/notes/` — Working notes and research (not permanent docs)
- `.reference/` — Read-only reference codebases (gitignored)
- `.trail/` — Session handoff notes and working logs
- `docs/` — Architecture, concepts, and development guides

Tests live alongside code in `src/__tests__/` with `*.test.ts` files.

## Commands

```bash
# Bootstrap
bun run bootstrap              # install deps, hooks, and local CLI tools

# Build
bun run build

# Test
bun run test                    # all packages
cd packages/<pkg> && bun test   # single package

# Lint / Format
bun run lint                    # oxlint
bun run format:check            # oxfmt check
bun run format:fix              # oxfmt fix
bun run typecheck               # tsc --noEmit

# Documentation lookup (XMTP SDK, protocol, etc.)
blz query -s xmtp "your query" --limit 5 --text   # search
blz get xmtp:1234-1280 --raw                       # retrieve lines
blz query -s xmtp "your query" -C all --text       # search + expand sections

# Project documentation search (specs, architecture, design docs)
qmd query "your query" -c xmtp-broker-plans        # specs + execution plans
qmd query "your query" -c xmtp-broker              # architecture + dev docs
qmd query "your query" -c xmtp-broker-claude        # skills + agent configs
qmd get xmtp-broker-plans/plans/v0/13-daemon-cli.md:50 -l 40  # read specific section
```

**Documentation lookup**: Delegate XMTP questions to the `xmtp-expert` agent (`.claude/agents/xmtp-expert.md`), which preloads the `xmtp-docs-blz` skill and maintains project-scoped memory of past lookups. For quick manual searches, use `blz` directly. The XMTP SDK evolves frequently — always verify patterns against documentation.

**Project documentation search**: Three qmd collections are indexed with embeddings for semantic search:

| Collection | Contents | Files |
|------------|----------|-------|
| `xmtp-broker` | `docs/` — architecture, concepts, development guides | 5 |
| `xmtp-broker-plans` | `.agents/` — Phase 2 specs (10–15), execution plans, PRD, design decisions | 30 |
| `xmtp-broker-claude` | `.claude/` — skills, agent configs, agent memory | 13 |

Use `qmd query` for semantic search across these collections. Use `qmd get` to read specific file sections by path and line offset. Run `qmd update` after changing docs to re-index, then `qmd embed` to refresh embeddings.

## Development Principles

### Non-Negotiable

**TDD-First** — Write the test before the code. Always.

1. **Red**: Write a failing test that defines behavior
2. **Green**: Minimal code to pass
3. **Refactor**: Improve while green

**Result Types** — Functions that can fail return `Result<T, E>`, not exceptions. No `throw` in handler code.

**Schema-First** — Zod schemas are the single source of truth for types and validation. Use `z.infer<>` for TypeScript types. No manual type duplication.

**No Raw Credentials in Harness** — The core security invariant of the entire project. The harness never touches raw keys, raw DB, or raw XMTP SDK.

### Strong Preferences

**Bun-First** — Use Bun-native APIs before npm packages (`Bun.hash()`, `Bun.Glob`, `bun:sqlite`, `Bun.serve()`, etc.).

**Small Files** — Under 200 LOC is healthy. 200-400: identify seams. Over 400: refactor before extending.

**Transport-Agnostic Handlers** — Domain logic knows nothing about WebSocket, MCP, or CLI. Handlers receive typed input and context, return `Result<T, E>`. Transport adapters handle protocol concerns.

**Validate at Boundaries** — Parse external data (harness requests, config, env vars) with Zod schemas at the edge. Trust types internally.

### Blessed Dependencies

| Concern           | Package                     |
| ----------------- | --------------------------- |
| Result type       | `better-result`             |
| Schema validation | `zod`                       |
| Testing           | `bun:test`                  |
| XMTP SDK          | `@xmtp/node-sdk`           |
| CLI framework     | `commander`                 |
| TOML parsing      | `smol-toml`                 |
| MCP SDK           | `@modelcontextprotocol/sdk` |
| Schema to JSON    | `zod-to-json-schema`        |
| Ethereum crypto   | `viem`                      |
| Elliptic curves   | `@noble/curves`             |
| Hash functions    | `@noble/hashes`             |
| AEAD ciphers      | `@noble/ciphers`            |
| Protobuf          | `protobufjs`                |
| QR codes          | `qrcode`                    |

Add new dependencies deliberately. Check here first — if a concern isn't listed, discuss before pulling something in.

## Architecture

### Handler Contract

All domain logic uses transport-agnostic handlers:

```typescript
type Handler<TInput, TOutput, TError extends BrokerError> = (
  input: TInput,
  ctx: HandlerContext,
) => Promise<Result<TOutput, TError>>;
```

`HandlerContext` is defined in `@xmtp-broker/contracts` with `requestId`, `signal`, and optional `adminAuth`/`sessionId`. `CoreContext` remains available for core-specific operations.

Handlers receive pre-validated input and a context object. They return `Result`, never throw. CLI, WebSocket, MCP, and HTTP are thin adapters over the same handlers.

### Package Tiers (dependency flows downward only)

**Foundation** — Stable types and contracts:

- Schemas (views, grants, attestations, sessions, events)
- Result/Error types and error taxonomy
- Shared type utilities

**Runtime** — Core broker functionality:

- XMTP client management (raw plane)
- Policy engine (view filtering, grant enforcement)
- Session management
- Attestation lifecycle
- Key management

**Transport** — Protocol adapters:

- WebSocket (primary, Phase 1)
- MCP (Phase 2)
- CLI (Phase 2)
- HTTP (Phase 3)

### Error Taxonomy

Errors are categorized for consistent handling across transports:

| Category   | When to use                           |
| ---------- | ------------------------------------- |
| validation | Bad input, schema violation           |
| not_found  | Resource doesn't exist                |
| permission | Grant denied, insufficient scope      |
| auth       | Session expired, invalid token        |
| internal   | Invariant violation, unexpected state |
| timeout    | Operation exceeded time limit         |
| cancelled  | Cancelled by signal or user           |

Each category maps to exit codes (CLI), status codes (HTTP), and JSON-RPC codes (MCP). Only `timeout` errors are retryable.

## Code Style

### TypeScript

Strict mode with maximum safety:

- `strict: true` with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- `verbatimModuleSyntax`, `isolatedDeclarations`
- No `any`, no `as` casts — narrow instead of assert
- ESM-only (`"type": "module"`)

### Formatting

oxfmt: 80-char width, 2-space indent, double quotes, trailing commas (ES5), semicolons.

### Linting

oxlint with `correctness` and `suspicious` categories at error level.

## Testing

- Runner: `bun:test`
- Test files: `src/__tests__/*.test.ts`
- Write tests first (TDD). New behavior needs tests unless trivially obvious.

## Git Workflow

- Trunk-based development on `main`
- Conventional commits: `feat(scope):`, `fix(scope):`, `test(scope):`
- Stacked PRs via Graphite (`gt` over `git`)
- Pre-commit: format + lint on staged files (Lefthook)
- Pre-push: full verification

## Reference Material

The `.reference/` directory (gitignored) contains source material from related projects. These are read-only context — do not modify them.

| Directory                     | What it is                                                                                                                                          | Why it matters                                                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.reference/keypo-cli/`       | Hardware-bound key management CLI (Secure Enclave P-256 + encrypted vault). Swift signer, Rust wallet, Solidity smart account.                      | Reference architecture for the broker's key management layer. The PRD calls out keypo-cli's Secure Enclave patterns as direct inspiration for the derived key hierarchy (root -> operational -> session).                                   |
| `.reference/xmtp-js/`         | Official XMTP TypeScript monorepo: browser SDK, node SDK, agent SDK, content types, and CLI.                                                        | The broker wraps the XMTP client that these SDKs provide. Understanding the node SDK and agent SDK interfaces is essential for designing the broker's raw plane and the harness-facing derived plane.                                       |
| `.reference/skills/`          | Claude Code agent skills for XMTP: documentation lookup (`xmtp-docs`) and agent identity/messaging (`xmtp-agent`).                                  | Useful for querying current XMTP SDK patterns and methods during development.                                                                                                                                                               |
| `.reference/convos-node-sdk/` | Convos Node SDK by XMTP Labs. Opinionated wrapper around `@xmtp/node-sdk` with per-group identity keys, agent runtime, and conversation management. | Key patterns for the broker: separate identity keys per group chat, agent lifecycle management, and how an opinionated client layer sits above the raw XMTP SDK. Per-group identity is a strong candidate for a first-class broker feature. |
| `.reference/convos-cli/`      | Convos CLI by XMTP Labs. Command-line interface for Convos agent operations.                                                                        | Reference for CLI patterns around XMTP agent management, conversation commands, and how a CLI surfaces XMTP operations.                                                                                                                     |
| `.reference/convos-agents/`   | Convos Agents by XMTP Labs. Agent runtime, pool management, and dashboard for running XMTP agents at scale.                                         | Reference for agent orchestration patterns: runtime lifecycle, pool scaling, monitoring, and multi-agent coordination.                                                                                                                      |

## Research Notes

Working notes from codebase analysis are in `.agents/notes/outfitter-patterns/`. These capture patterns extracted from `outfitter/stack` that informed the conventions above. They are working documents, not permanent documentation.
