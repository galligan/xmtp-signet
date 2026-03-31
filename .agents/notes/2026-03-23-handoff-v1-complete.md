---
created: 2026-03-24T02:30:00.000Z
type: handoff
session: v1-full-stack
---

# Handoff: v1 Full Stack Complete

## Done

- **37-PR Graphite stack** — PRs #132-196, all as drafts
- **Phase 1** (Steps 1-9): Foundation schemas — resource IDs, permission scopes, operator, policy, credential, seal v2, ID mapping, contracts. 335 tests.
- **Phase 2** (Steps 10-17): Fix downstream — policy rewrite (scope-based), keys update, sessions→credentials, seals update, WS/MCP/SDK/CLI updates.
- **Phase 3** (Steps 18-21): Key management — KeyBackend interface, BIP-39/44 derivation (passes Trezor vectors), OWS-compatible Keystore v3 vault (scrypt+AES-256-GCM), key manager rewrite.
- **Phase 4** (Steps 22-26): Identity runtime — operator manager, policy manager, credential manager with scope resolution, scope guard, integration tests.
- **Phase 5** (Steps 27-29): Seal protocol v2 — chain validation, message-seal binding, auto-republish with retry.
- **Phase 6** (Steps 30-33): CLI restructure — `xs` binary with all command groups (operator, cred, chat, msg, policy, seal, wallet, key, logs, lookup, search, consent).
- **Phase 7** (Steps 34-37): Integration — full build fix (12/12 packages), security boundary tests (15 tests), E2E tracer bullet (28 tests), CLAUDE.md docs update.
- **56 GitHub issues created** — 7 epics (#112-118), 4 research (#119-122), 9 Phase 1 (#123-131), 28 Phases 2-7 (#141-168), plus the 9 original PRs (#132-140)

## State

- On `v1/docs-update` branch (top of 37-branch stack)
- All PRs submitted as drafts on Graphite
- `bun run build` passes (12/12 packages)
- `bun run lint` passes (21/21)
- `bun run typecheck` passes for most packages (integration fixtures still use v0 types)
- Individual package tests pass: schemas (311), contracts (24), policy (103), keys (134+), sessions (177+), seals (100), ws, mcp, sdk, cli

## Not Done

- Integration package test fixtures still reference v0 types
- CLI smoke test (launches real daemon) not wired to v1 yet
- XMTP network connectivity not tested with v1 model
- Research issues (#119-122) still open: Bun NAPI, Convos MLS, Convos passkey, KeyBackend design
- OWS plugin provider (only internal provider implemented)
- Privilege elevation (biometric gate for admin message read)
- Attachment support, approval queues, XIP proposals

## Next

- [ ] Review and merge the 37-PR stack
- [ ] Fix integration package test fixtures
- [ ] Wire xs CLI to daemon (full command dispatch)
- [ ] Network tracer bullet with v1 model on devnet
- [ ] Research: Bun NAPI (#119), Convos MLS (#120), passkey flow (#121)
- [ ] OWS plugin provider (Phase 2 of key management)
