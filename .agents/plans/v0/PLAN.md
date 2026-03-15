# xmtp-broker v0 Architecture Plan

**Version:** 0.2.0
**Status:** Draft
**Created:** 2026-03-13
**Updated:** 2026-03-14

## One-Line Summary

A brokered agent architecture where the broker is the real XMTP client, agents consume filtered views through scoped grants, and group-visible attestations make permissions inspectable.

## Architecture Overview

The broker separates raw XMTP access from agent consumption through three planes:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Agent Harness A                          │
│                    (any framework/language)                      │
├──────────────────────────┬──────────────────────────────────────┤
│                          │ WebSocket (Phase 1)                  │
│                          │ MCP / CLI / HTTP (later)             │
│                     ┌────▼────┐                                 │
│                     │ Session │ ← scoped token, short-lived     │
│                     └────┬────┘                                 │
│ ╔════════════════════════╪═══════════════════════════════════╗  │
│ ║              DERIVED PLANE (agent-facing)                  ║  │
│ ║  Filtered event stream · Scoped action interface           ║  │
│ ╠════════════════════════╪═══════════════════════════════════╣  │
│ ║               POLICY PLANE (enforcement)                   ║  │
│ ║  ┌──────────┐  ┌──────────────┐  ┌──────────────────────┐ ║  │
│ ║  │   View   │  │    Grant     │  │    Attestation       │ ║  │
│ ║  │ Filter   │  │  Enforcer    │  │    Manager           │ ║  │
│ ║  └──────────┘  └──────────────┘  └──────────────────────┘ ║  │
│ ║  ┌──────────────────┐  ┌─────────────────────────────────┐ ║  │
│ ║  │ Session Manager  │  │  Reveal State                   │ ║  │
│ ║  └──────────────────┘  └─────────────────────────────────┘ ║  │
│ ╠════════════════════════╪═══════════════════════════════════╣  │
│ ║                RAW PLANE (broker-only)                      ║  │
│ ║  ┌────────────┐ ┌───────────┐ ┌──────────┐ ┌────────────┐ ║  │
│ ║  │ XMTP       │ │ Raw DB +  │ │ Signer   │ │ Per-Group  │ ║  │
│ ║  │ Client     │ │ Enc Keys  │ │ Material │ │ Identity   │ ║  │
│ ║  └────────────┘ └───────────┘ └──────────┘ └────────────┘ ║  │
│ ╚════════════════════════════════════════════════════════════╝  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              KEY MANAGEMENT LAYER                        │   │
│  │  Root Key (Secure Enclave) → Operational → Session Keys  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

External:
  ┌───────────────────┐
  │  Reference        │   Verifies broker claims via XMTP DM
  │  Verifier         │   Deployable to CF Workers / Railway
  └───────────────────┘
```

## Key Decisions

These decisions resolve PRD open questions and establish constraints for all specs:

| Decision | Resolution | Rationale |
|----------|-----------|-----------|
| Min attestation schema | Full schema from PRD day one; optional fields use `null` not omission | Prevents schema drift; clients always know the shape |
| Stale attestation rendering | Clients show staleness badge after `expiresAt`; messages still render with "produced under expired attestation" note | Don't hide history, but flag currency |
| Reveal history UX | Out of scope for v0 specs (client concern) | Broker provides the data; UX is per-client |
| Per-thread session scoping | Sessions scope to agent+groups, not individual threads; thread filtering is a view concern | Simpler session model; threads are view config |
| In-group vs off-chain policy | Attestations in-group; full policy config off-chain in broker | Keeps groups clean; attestation is the public summary |
| Recovery for hosted deployments | Deferred to post-v0; v0 focuses on local broker | Hosted adds TEE complexity; local Secure Enclave is Phase 1 |
| Verification classes at launch | Source-verified only; runtime-attested is Phase 2 | Ship something useful fast |
| Default heartbeat interval | 30 seconds; configurable per-agent | Balances liveness visibility with noise |
| Content type allowlist updates | Material change → new attestation; broker logs the delta | Consistent with materiality rules |
| Per-group identity | Default-on, configurable; each group gets a unique identity key | Strongest isolation; matches convos-node-sdk pattern |
| Mono-package vs monorepo | Monorepo with Bun workspaces from day one | Clean dependency boundaries between tiers |
| Foundation tier split | `schemas` = data shapes (Zod schemas, enums, error taxonomy); `contracts` = cross-package interfaces (service/provider contracts, event types). `contracts` imports from `schemas` only. | 22 interfaces defined in runtime specs belong in Foundation. Separating shapes from contracts keeps `schemas` zero-dep beyond Zod and gives runtime packages a stable interface layer. |
| `summary-only` view mode | Schema defined in v0; implementation deferred to Phase 2 | Schema completeness now; summarization logic is non-trivial and not needed for initial transport |
| CLI framework | Commander.js | Lightweight, Bun-compatible, composes well with Zod for argument validation |
| Config format | TOML at `~/.config/xmtp-broker/config.toml` with `smol-toml` parser | XDG conventions; `smol-toml` is zero-dep, spec-compliant |
| Admin auth | Admin key JWT only; peer credentials deferred to post-v0 | Cross-platform; no native FFI in v0 |
| Admin JWT TTL | 2 minutes default, 1 hour max, `--ttl` flag for scripts | CLI generates fresh JWT per command; short TTL limits leaked token exposure |
| Key access | Vault only (Secure Enclave root key); no env vars, keyfiles, or CLI args for raw keys | Core security invariant — raw keys never exposed to users or environment |
| MCP surface | Harness-facing (messages, conversations, identity creation); NOT admin-facing | MCP callers are agent participants, not administrators; consistent with Convos approach |
| Multi-identity | v0 is single-identity; CLI structured for future `--identity` flag | Ship simple; identity command group exists for expansion |
| MCP SDK | `@modelcontextprotocol/sdk` with stdio transport | Official SDK, maintained, works with Bun; lightweight enough |
| MCP tool naming | `broker/{group}/{action}` (e.g., `broker/session/list`) | Namespaced to avoid collision; matches CLI command structure |
| Streaming output | NDJSON with `--json`; human-readable tables default | Scriptable with `jq`; human-friendly by default |
| Audit trail | Append-only JSONL at `$XDG_STATE_HOME/xmtp-broker/audit.jsonl` | Minimum viable audit for admin operations |

## Component Map

### Foundation Tier (dependency-free)

| Spec | Package | Purpose |
|------|---------|---------|
| [01-repo-scaffolding](01-repo-scaffolding.md) | (workspace root) | Build tooling, config, conventions |
| [02-schemas](02-schemas.md) | `@xmtp-broker/schemas` | Zod schemas, inferred types, error taxonomy, enums |
| [02b-contracts](02b-contracts.md) | `@xmtp-broker/contracts` | Cross-package interfaces, provider contracts, event types |
| [10-action-registry](10-action-registry.md) | `@xmtp-broker/contracts` + `@xmtp-broker/schemas` | ActionSpec, ActionResult envelope, extended HandlerContext |

### Runtime Tier (depends on Foundation)

| Spec | Package | Purpose |
|------|---------|---------|
| [03-broker-core](03-broker-core.md) | `@xmtp-broker/core` | XMTP client lifecycle, raw plane, per-group identity |
| [04-policy-engine](04-policy-engine.md) | `@xmtp-broker/policy` | View filtering, grant enforcement, reveal state |
| [05-sessions](05-sessions.md) | `@xmtp-broker/sessions` | Session issuance, binding, lifecycle |
| [06-attestations](06-attestations.md) | `@xmtp-broker/attestations` | Attestation lifecycle, signing, publishing |
| [07-key-management](07-key-management.md) | `@xmtp-broker/keys` | Secure Enclave, derived key hierarchy |
| [11-sdk-integration](11-sdk-integration.md) | `@xmtp-broker/core` | Wire `@xmtp/node-sdk` into production client factory |
| [12-admin-keys](12-admin-keys.md) | `@xmtp-broker/keys` | Admin key pair, JWT auth |

### Transport Tier (depends on Runtime)

| Spec | Package | Purpose |
|------|---------|---------|
| [08-websocket-transport](08-websocket-transport.md) | `@xmtp-broker/ws` | Phase 1 harness-facing interface |
| [13-daemon-cli](13-daemon-cli.md) | `@xmtp-broker/cli` | Daemon lifecycle, CLI commands, admin socket, direct mode |
| [14-mcp-transport](14-mcp-transport.md) | `@xmtp-broker/mcp` | MCP tools via `@modelcontextprotocol/sdk` |

### Client Tier (depends on Transport)

| Spec | Package | Purpose |
|------|---------|---------|
| [15-handler-sdk](15-handler-sdk.md) | `@xmtp-broker/handler` | TypeScript client for harness developers to connect agents to broker |

### External Services

| Spec | Package | Purpose |
|------|---------|---------|
| [09-verifier](09-verifier.md) | `@xmtp-broker/verifier` | Reference verification service |

## Dependency Graph

```
                [01-scaffolding]
                       │
                 [02-schemas]
                       │
               [02b-contracts]
                       │
              [10-action-registry]  ← extends contracts + schemas
                /    |    |    \
       [03-core] [04-policy] [05-sessions] [06-attestations]
           │          │            │              │
       [07-key-mgmt]  │            │              │
           │          │            │              │
      [11-sdk-integ]  │            │              │
           │          │            │              │
      [12-admin-keys] │            │              │
           │          │            │              │
           └──────────┴────────────┴──────────────┘
                              │
                     [08-ws-transport]
                              │
                      [09-verifier]
                              │
                  [13-daemon-cli]  ← composition root
                              │
                  [14-mcp-transport]
                              │
                  [15-handler-sdk]  ← client library for harness devs
```

Notes:
- `02b-contracts` imports from `02-schemas` only; defines cross-package interfaces
- `10-action-registry` extends both `contracts` (ActionSpec type) and `schemas` (ActionResult envelope)
- `07-key-mgmt` is Runtime tier (used by core, sessions, attestations for signing)
- `08-ws-transport` is the orchestrator connecting core, policy, sessions, and attestations
- `09-verifier` depends only on schemas (standalone service)
- `11-sdk-integration` extends `core` with production `@xmtp/node-sdk` wiring
- `12-admin-keys` extends `keys` with admin key pair and JWT auth
- `13-daemon-cli` is the composition root wiring all packages into a running process
- `14-mcp-transport` exposes ActionSpecs as MCP tools
- `04-policy` owns the canonical materiality logic; `06-attestations` imports from it
- Dependencies flow downward only within tiers

## Package Scope Convention

All internal packages use the `@xmtp-broker/` scope. This is a workspace-internal scope, not published to npm. It provides clean import paths and prevents accidental external dependency.

## Spec Template

Every spec doc follows this structure:

1. **Overview** — What this component does and why
2. **Dependencies** — What it imports, what imports it
3. **Public Interfaces** — Exported types, functions, classes
4. **Zod Schemas** — Complete schema definitions (or references to 02-schemas)
5. **Behaviors** — How the component works, state machines, flows
6. **Error Cases** — What can go wrong, error types returned
7. **Open Questions Resolved** — PRD questions answered in this spec
8. **Deferred** — What's explicitly out of scope for v0
9. **Testing Strategy** — What to test, how to test it
10. **File Layout** — Exact files to create

## Phase Boundaries

**Phase 1 (specs 01-09):**
- Local broker on macOS with Secure Enclave
- WebSocket transport
- Core view/grant/attestation model
- Per-group identity (default-on)
- Reference verifier (source-verified tier)
- Single-owner governance

**Phase 2 (specs 10-15):**
- Phase 1 integration test suite (validation gate before new code)
- Action registry: define once, expose everywhere
- Production SDK integration (`@xmtp/node-sdk` wired into core)
- Admin key system (separate from inbox keys, JWT auth)
- Daemon lifecycle, CLI with 8 command groups, Unix socket admin
- MCP transport (harness-facing, session-scoped) for Claude Code / LLM tool integration
- Handler SDK (`@xmtp-broker/handler`) — TypeScript client for harness developers

**Deferred (not in v0 specs):**
- Hosted/managed broker deployment
- HTTP transport
- Runtime attestation (TEE)
- Group governance beyond owner-only
- Cross-broker federation
- Formal XIP proposals

## Conventions

All specs assume:
- **Bun-first**: Bun-native APIs before npm packages
- **TDD**: Test before code, always
- **Result types**: `better-result` for all fallible operations
- **Schema-first**: Zod schemas define types; `z.infer<>` for TS types
- **No @outfitter/* deps**: Zero external framework dependencies
- **ESM-only**: `"type": "module"` throughout
- **Strict TS**: Full strictness flags as defined in 01-scaffolding

## Working Reference

The full PRD is preserved as [SPEC.md](SPEC.md) in this directory. All specs should reference it for context but resolve (not defer) open questions within their scope.
