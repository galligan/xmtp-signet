# v1 Completion Stack

Status: active
Last updated: 2026-04-14
Parent issue: #299

## Goal

Finish the local and self-hosted v1 follow-ons that make the current signet
feel complete before we move into split host/remote work.

This stack is intentionally about tightening the existing v1 surface, not
quietly pulling forward v2 or hosted-signing architecture.

## In scope

- `#279` real daemon-backed `xs lookup`
- `#296` admin scoped read-elevation policy boundary
- `#121` signet-native passkey or biometric strategy for sensitive owner actions
- `#297` first Apple-first Secure Enclave approval path
- `#120` Convos MLS and state persistence model
- `#298` Convos interop tracer bullet
- `#299` docs and backlog cleanup at the end of the tranche

## Explicitly out of scope

- split host/remote
- Remote-MLS or minimum-trust hosted design
- `#282` external wallet provider or OWS work
- `#283` network-level seal validation
- Convos iOS identity or passkey parity as an implementation target

## Working assumptions

- Apple-first implementation is acceptable for the first passkey-backed flow
- Sensitive actions come first; we are not making passkey approval mandatory for
  every admin action in this tranche
- Convos identity compatibility is mostly about stable inbox and MLS state, not
  about passkeys
- We should be explicit about what is implemented now versus deferred

## Execution order

1. `#279` Implement `lookup.resolve` and wire `xs lookup`
2. `#296` Define the admin read-elevation request, approval, expiry, and audit model
3. `#121` Lock the signet-native passkey or biometric assumptions that support `#297`
4. `#297` Implement the first Secure Enclave-backed approval path
5. `#120` Capture the repo-grounded Convos state model
6. `#298` Run the Convos tracer bullet and fix the local gaps it exposes
7. `#299` Refresh docs and backlog state

## Progress

### Completed

- `#279` `xs lookup` is now daemon-backed through `lookup.resolve`
  - resolves local inbox IDs, network ID mappings, identity labels, operator labels,
    policy labels, and credential IDs from local signet state
  - includes focused tests in `packages/core` and `packages/cli`
  - verified with targeted tests, full typecheck, lint, and docs coverage
- `#120` Convos MLS and state persistence model is now explicit
  - the repo-grounded boundary note lives at
    `.agents/notes/2026-04-13-convos-mls-state-boundary.md`
  - public docs now state the durable split between the identity store,
    per-identity XMTP databases, and derived key material
  - no core storage redesign is needed for the current local and self-hosted
    v1 Convos interop story
- `#298` Convos interop tracer bullet now passes on devnet
  - the live artifact is `.test/tracers/v1-devnet-convos/REPORT.md`
  - the hosted join loop now completes end to end on devnet:
    host init -> daemon start -> chat create -> invite -> join -> same-session
    joiner send -> daemon restart -> post-restart joiner send
  - closing fixes were:
    - stream all XMTP messages instead of only group messages
    - stream all new conversations instead of only groups
    - scan newly discovered conversations for invite slugs
    - attach joined identities to the live runtime without restart
- `#296` Admin read-elevation policy boundary is now real in the runtime
  - plain `adminAuth` message reads fail closed
  - explicit `AdminReadElevation` scope and handler context are in place
  - both admin transports can now inject elevation instead of relying on
    ambient admin access

### In progress

- `#121` Signet-native passkey or biometric assumptions
  - Apple-first path is narrowing toward existing Secure Enclave biometric
    primitives rather than a broader cross-platform passkey design
  - current code-boundary note:
    `.agents/notes/2026-04-13-signet-passkey-biometric-boundary.md`
- `#297` First Secure Enclave-backed approval path
  - the daemon can now prompt the dedicated `adminReadElevation` gate and mint
    a short-lived, session-scoped elevation on both the admin socket and HTTP
    admin routes
  - audit entries are appended for approval, denial, reuse, and expiry on that
    path
  - active elevation now refreshes the current public seal so `adminAccess`
    stays honest while the elevation is live, and refreshes again on expiry
  - the current disclosure is intentionally root-admin scoped and surfaced as
    `adminAccess.operatorId: "owner"` in the local v1 model
  - remaining follow-on questions are mostly about whether we ever want
    cross-restart persistence or a richer admin subject model
  - current code-boundary note:
    `.agents/notes/2026-04-13-admin-read-elevation-boundary.md`

### Pending

- `#299` final docs and backlog cleanup

## Notes

- The first lookup slice is intentionally local-first. It provides real
  cross-reference resolution without pretending to do reachability or other
  network validation.
- The passkey tranche should stay signet-native. If we later need Convos iOS
  parity, that should be treated as a new source-of-truth exercise rather than
  implicitly folded into this stack.
