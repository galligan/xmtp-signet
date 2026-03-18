# Remaining Work: Phase 1 Completion and Phase 2 Delivery

**Created:** 2026-03-17
**Updated:** 2026-03-18
**Context:** Phase 2C (Convos interop, conversation management, devnet connectivity) is complete across 38 stacked PRs. This document tracked what remained before the signet was feature-complete for Phase 1 (PRD) and ready for Phase 2 delivery to external developers.

**Status: All items complete.** Phase 1 and Phase 2 gaps have been closed across the stacked PR series. Pending merge to main.

---

## Phase 1 Gaps — COMPLETE

### P1-1: Secure Enclave Key Binding — DONE

Delivered in 4 stacked PRs (`v0/signet-signer` → `v0/se-tracer`):
- `signet-signer/` Swift CLI: P-256 SE key create, sign, info, delete
- TypeScript subprocess bridge with Zod-validated IPC
- Platform detection dispatches to SE or software-vault automatically
- Private key material never enters the TypeScript process
- Validated end-to-end: create → sign → verify with `@noble/curves/p256`
- Graceful degradation: non-macOS or missing binary falls back to software-vault

### P1-2: Reveal-Only View Mode — DONE

Delivered in `v0/reveal-handlers` and `v0/reveal-projection`:
- Reveal grant/revoke handlers with session-scoped state
- View projection pipeline for outbound events

---

## Phase 2 Gaps — COMPLETE

| Item | PR | Status |
|------|----|--------|
| P2-1: Deployment Templates | `v0/deploy-templates` | Done |
| P2-2: Runtime Seal Publishing Wiring | `v0/seal-publisher` | Done |
| P2-3: Build Provenance Verification | `v0/build-provenance` | Done |
| P2-4: Session Permission Editing | `v0/session-update` | Done |
| P2-5: HTTP API Adapter | `v0/http-api` | Done |
| P2-6: Action Confirmations | `v0/action-confirm` | Done |
| P2-7: Historical Docs Terminology Cleanup | `v0/docs-cleanup` | Done |
