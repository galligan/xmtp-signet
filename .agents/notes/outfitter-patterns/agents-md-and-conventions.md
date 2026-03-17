# AGENTS.md Structure and Development Conventions

Extracted from `outfitter/stack` as reference for xmtp-broker's agent-facing documentation.

## CLAUDE.md vs AGENTS.md

In outfitter/stack, CLAUDE.md is a thin wrapper:

```markdown
# CLAUDE.md
## Claude-Specific Instruction
- Unless otherwise specified, updates to this file should be made directly in `./AGENTS.md`.
## Agent Instructions
<!-- Do not edit below this line -->
@AGENTS.md
```

All substance lives in AGENTS.md. No `.claude/rules/` directory — single file is the source of truth. This keeps things simple and avoids fragmentation.

## AGENTS.md Structure (466 lines)

The file follows a clear progression:

1. **One-line summary** — "Bun-first TypeScript monorepo. Tests before code. Result types, not exceptions."
2. **Project overview** — what the project does, core idea, Linear team key
3. **Project structure** — where things live (apps/, packages/, docs/)
4. **Commands** — every build/test/lint/release command, copy-pasteable
5. **CI jobs** — table of all CI pipeline jobs and what they validate
6. **Architecture** — package tiers, handler contract, action registry, CommandBuilder API, streaming, output envelopes, error taxonomy
7. **Environment configuration** — profiles, env vars, precedence chain
8. **Development principles** — non-negotiable (TDD, Result types) vs strong preferences (Bun-first)
9. **Blessed dependencies** — canonical package for each concern
10. **Code style** — TypeScript strictness, formatting tool
11. **Testing** — runner, file patterns, snapshots
12. **Git workflow** — branch naming, commits, PRs, hooks, changesets
13. **Key files** — links to deeper docs

## Key Patterns Worth Adopting

### Lead with the non-negotiables

The "Development Principles" section is explicit about what's mandatory vs. preferred:

> **Non-Negotiable**
> - **TDD-First** — Write the test before the code. Always.
> - **Result Types** — Handlers return `Result<T, E>`, not exceptions.
>
> **Strong Preferences**
> - **Bun-First** — Use Bun-native APIs before npm packages.

This makes it unambiguous for both humans and agents.

### Blessed dependencies table

Explicit list of which package to use for each concern. Prevents agents from pulling in alternatives:

| Concern           | Package                     |
| ----------------- | --------------------------- |
| Result type       | `better-result`             |
| Schema validation | `zod`                       |
| CLI parsing       | `commander`                 |
| Logging           | `@logtape/logtape`          |
| MCP protocol      | `@modelcontextprotocol/sdk` |
| Prompts           | `@clack/prompts`            |

### Package tiers with dependency direction

Foundation -> Runtime -> Tooling, with the rule that dependencies flow one direction. This prevents circular deps and keeps the architecture layered.

### Copy-pasteable commands

Every command block is ready to run — no "replace X with Y" placeholders. Agents can execute directly.

### Environment precedence chain

Explicit resolution order prevents confusion:
```
env var override > explicit option > environment profile > package default
```

### CI job table

Agents know exactly what CI checks and can predict what will fail.

## Adaptation Notes for xmtp-broker

**Adopt:**
- Single AGENTS.md as source of truth (symlink CLAUDE.md to it, already done)
- Lead with one-line summary and core idea
- Non-negotiable vs. strong preference distinction
- Blessed dependencies table
- Copy-pasteable commands section
- Package tier / dependency direction rules
- Environment precedence chain pattern

**Adapt:**
- xmtp-broker is much simpler initially — AGENTS.md can be shorter
- CI section can wait until CI exists
- Package tiers will be different (broker core, transports, key management)

**Development principles for xmtp-broker (draft):**

### Non-Negotiable
- **TDD-First** — Write the test before the code. Always.
- **Result Types** — Functions that can fail return `Result<T, E>`, not exceptions.
- **Schema-First** — Zod schemas are the single source of truth for types and validation.
- **No Raw Credentials in Harness** — The core security invariant of the entire project.

### Strong Preferences
- **Bun-First** — Use Bun-native APIs before npm packages.
- **Small Files** — < 200 LOC healthy, 200-400 find seams, > 400 refactor first.
- **Transport-Agnostic Handlers** — Domain logic knows nothing about WebSocket, MCP, or CLI.
- **Validate at Boundaries** — Parse external data at the edge, trust types internally.

### Blessed Dependencies (starter)
| Concern           | Package           |
| ----------------- | ----------------- |
| Result type       | `better-result`   |
| Schema validation | `zod`             |
| Testing           | `bun:test`        |
| Logging           | TBD               |
| WebSocket         | TBD (Bun native?) |
| XMTP SDK          | `@xmtp/node-sdk`  |
