# Remaining Work: Phase 1 Completion and Phase 2 Delivery

**Created:** 2026-03-17
**Updated:** 2026-03-17
**Context:** Phase 2C (Convos interop, conversation management, devnet connectivity) is complete across 38 stacked PRs. This document tracks what remains before the signet is feature-complete for Phase 1 (PRD) and ready for Phase 2 delivery to external developers.

**Note:** The XMTP Signet rename is now complete in the live code and public runtime surface. This document reflects the current `signet` naming. Historical planning notes may still use `broker` or `attestation` terminology where they describe earlier design phases.

## Current State

The signet runs on XMTP devnet with:
- Dual-identity registration and management
- Group creation, listing, info, add-member, members
- Convos invite generate/parse/verify/join roundtrip
- Session-scoped WebSocket with policy enforcement
- WebSocket event streaming and heartbeat/liveness handling
- Vault-backed key hierarchy (root, operational, session)
- Seal lifecycle and Ed25519 seal stamping in package/integration flows
- Session-scoped MCP transport with conversation tools wired from ActionSpecs
- Reference verifier (trust chain, seal chain)
- CLI daemon with admin socket

Validated end-to-end via tracer bullet on devnet (17/17 steps, 3 bugs fixed).

---

## Phase 1 Gaps (from PRD)

Items the PRD scopes to Phase 1 that are not yet complete.

### P1-1: Secure Enclave Key Binding

**What:** Upgrade `rootKeyPolicy` from `"open"` (software-only vault) to hardware-backed storage using macOS Secure Enclave (P-256) for the root key.

**Why:** The PRD's hard requirement: "Signing keys stored in hardware-backed storage where available (Secure Enclave, TEE)." Currently the root key is generated and stored in an encrypted vault file, but the encryption key itself is not hardware-bound.

**Scope:** `packages/keys/` — add a `SecureEnclaveRootKeyProvider` alongside the existing `SoftwareRootKeyProvider`. The key hierarchy stays the same (root -> operational -> session); only the root key storage changes.

**Effort:** Large. Requires Swift interop (Bun FFI or child process) for Secure Enclave access. Platform-specific (macOS/iOS only; Linux falls back to software vault).

---

### P1-2: Reveal-Only View Mode

**What:** Enforce `reveal-only` view mode in the policy engine. Currently all views are effectively `full` — the agent sees complete message content. In `reveal-only` mode, messages should be redacted by default with explicit per-message or per-thread reveal.

**Why:** The PRD lists "Support basic view modes (full, reveal-only)" as Phase 1. The schema defines view modes but the policy engine doesn't enforce anything beyond `full`.

**Scope:** `packages/policy/` — add content filtering in the view projection layer. When `mode: "reveal-only"`, messages are projected as placeholders unless explicitly revealed. Requires a reveal state store (which messages/threads have been revealed).

**Effort:** Medium. Schema already has the mode field. Policy engine needs a filter pass. Reveal state needs persistence (probably a table in the identity store DB).

---

## Phase 2 Gaps (from PRD)

### P2-1: Deployment Templates

**What:** Dockerfile, docker-compose.yml, Railway template for running the signet outside the source tree.

**Effort:** Small-medium.

### P2-2: Runtime Seal Publishing Wiring

**What:** Replace the CLI/runtime startup stubs in `packages/cli/src/start.ts` with real seal manager wiring so daemon-issued sessions and group operations publish real seals through the runtime composition root.

**Why:** The package layer already has real Ed25519 seal stamping and publish interfaces, and integration tests exercise that path. The remaining gap is the production runtime composition root, which still creates a stub signer/publisher during startup.

**Effort:** Medium.

### P2-3: Build Provenance Verification

**What:** Real Sigstore/GitHub OIDC verification in the verifier (currently v0 stub).

**Effort:** Medium.

### P2-4: Session Permission Editing

**What:** Modify a session's view/grant without revoke + reissue.

**Effort:** Medium.

### P2-5: HTTP API Adapter

**What:** REST API for non-streaming operations.

**Effort:** Medium.

### P2-6: Action Confirmations

**What:** Confirmation flow for sensitive actions (tool calls, group management).

**Effort:** Medium-large.

### P2-7: Historical Docs Terminology Cleanup

**What:** Update historical plans, skills, and notes that still say `broker` / `attestation` where they now refer to `signet` / `seal`.

**Why:** The live code and public runtime surface are renamed, but hidden docs under `.agents/`, `.claude/`, and `.trail/` still contain older terminology. This is not a runtime blocker, but it does create friction for future agent and contributor onboarding.

**Effort:** Small-medium.

---

## Suggested Execution Order

### Next: Phase 1 Close-Out

| Order | Item | Effort | Rationale |
|-------|------|--------|-----------|
| 1 | P1-2: Reveal-Only View Mode | Medium | Core privacy feature still missing from Phase 1 |
| 2 | P1-1: Secure Enclave | Large | Important PRD security gap; platform-specific |
| 3 | P2-2: Runtime Seal Publishing Wiring | Medium | Completes the production seal path |

### Follow-On: Phase 2 Delivery

| Order | Item | Effort |
|-------|------|--------|
| 4 | P2-1: Deployment Templates | Small-medium |
| 5 | P2-3: Build Provenance | Medium |
| 6 | P2-4: Session Permission Editing | Medium |
| 7 | P2-5: HTTP API | Medium |
| 8 | P2-6: Action Confirmations | Medium-large |
| 9 | P2-7: Historical Docs Terminology Cleanup | Small-medium |
