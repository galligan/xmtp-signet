---
created: 2026-03-18T15:45:00Z
type: handoff
session: stack-review-main-head-cleanup
---

# Handoff 2026-03-18 Stack Review / Cleanup

## Scope

- Review was intentionally run against `main...HEAD`, not just the top branch's local diff. Matt explicitly called out that this is a Graphite stack and the top branch contains downstack changes.
- Cleanup mode is broader than "what this stack introduced". If a real bug surfaced while tracing stack changes and it appears to come from `main`, it is still in scope to report.
- Matt is actively fixing findings underfoot. Before re-raising any already-known issue, reopen the current worktree version of the file first.

## Scope Update After Follow-Up Verification

- A second pass was run after Matt landed several fixes.
- Re-checks were done against the current worktree, then compared back to the earlier `main...HEAD` review findings.
- The current worktree at the time of this update only showed the handoff note itself as untracked in `git status --short`.

## Review Method

- Start broad with `git diff --stat main...HEAD`.
- Slice by subsystem with `git diff --unified=80 main...HEAD -- <paths>`.
- Follow new surfaces end-to-end with `rg`: schema -> handler/action -> runtime -> transport -> tests.
- When intent was ambiguous, verify against plans/docs with `qmd query` / `qmd get`.
- A few findings came from intermediate live-worktree changes rather than committed `HEAD`; those are called out separately below so they are not treated as stack facts without re-checking.

## High-Yield Commands

```bash
git diff --stat main...HEAD

git diff --unified=80 main...HEAD -- \
  packages/cli/src/ws/request-handler.ts \
  packages/cli/src/ws/event-projector.ts \
  packages/ws/src/server.ts \
  packages/sessions/src/reveal-actions.ts \
  packages/sessions/src/update-actions.ts \
  packages/sessions/src/pending-actions.ts

git diff --unified=80 main...HEAD -- \
  packages/seals/src/publisher.ts \
  packages/core/src/core-context.ts \
  packages/core/src/xmtp-client-factory.ts \
  packages/core/src/sdk/sdk-client.ts

git diff --unified=80 main...HEAD -- \
  packages/verifier/src/checks/build-provenance.ts \
  packages/verifier/src/checks/sigstore-bundle.ts \
  packages/verifier/src/service.ts \
  packages/verifier/src/config.ts

git diff --unified=80 main...HEAD -- \
  packages/keys/src/root-key.ts \
  packages/keys/src/se-bridge.ts \
  signet-signer/Sources/SignetCore/SecureEnclaveManager.swift \
  signet-signer/Sources/signet-signer/CreateCommand.swift \
  signet-signer/Sources/signet-signer/SignCommand.swift

rg -n "view\\.updated|grant\\.updated|session\\.reauthorization_required|message\\.revealed|action\\.confirmation_required" packages -g'*.ts'
rg -n "sendMessage\\(|contentType|ContentType" packages -g'*.ts'
rg -n "createSession\\(" packages -g'*.ts'

qmd get xmtp-signet-plans/plans/v0/08-websocket-transport.md:260 -l 24
qmd get xmtp-signet-plans/plans/v0/04-policy-engine.md:430 -l 20
```

## Areas Already Covered

- WebSocket auth/request lifecycle
- Live broadcast and replay behavior
- View update and materiality flows
- Reveal request/state/projection flows
- Pending action confirmation flow
- HTTP server wiring
- Seal publisher -> core send path
- Verifier build provenance path
- Secure Enclave / signer bridge
- Session issuance / concurrency internals

## Productive Heuristics

- When a new schema or event type was added, trace whether anything actually emits it on the live path.
- When a function signature gained richer semantics, compare every lower layer for dropped parameters. This is how the seal content-type bug surfaced.
- Compare sibling handlers for missing state checks. This is how `reveal.request` missing `session.state === "active"` stood out beside `update-actions`.
- Read tests, then verify whether they stub around the real runtime boundary. Several bugs hid because tests asserted top-layer call shape instead of the production XMTP path.

## Verification Slices Already Run

```bash
bun test \
  packages/cli/src/__tests__/http-server.test.ts \
  packages/cli/src/__tests__/event-projector.test.ts \
  packages/cli/src/__tests__/ws-request-handler.test.ts

bun test \
  packages/sessions/src/__tests__/reveal-actions.test.ts \
  packages/sessions/src/__tests__/pending-actions.test.ts

bun test \
  packages/verifier/src/__tests__/build-provenance.test.ts \
  packages/seals/src/__tests__/seal-wiring.test.ts \
  packages/keys/src/__tests__/se-bridge.test.ts

bun test packages/core/src/__tests__/sdk-type-mapping.test.ts
```

- Those targeted slices all passed in the follow-up verification pass.
- No full-repo test run was done from this note.

## Reconciled Status

### Verified Fixed

- Production WS `update_view` wiring now passes `internalSessionManager` when available. Files: `packages/cli/src/start.ts`.
- Request-path WS handling now does fresh session lookup, fails closed on lookup failure, rejects non-active sessions, and stops heartbeat on close. Files: `packages/ws/src/server.ts`.
- Event projection for `message.visible` now always goes through `projectMessage()`, so full/thread-only no longer bypass scope/content-type filtering. Files: `packages/cli/src/ws/event-projector.ts`.
- Pending action confirmation now enforces expiry and revalidates queued sends against the current grant/view before executing. Files: `packages/cli/src/ws/request-handler.ts`.
- `/v1/health` now awaits async `status()`. Files: `packages/cli/src/http/server.ts`.
- Seal/revocation publishing now preserves custom XMTP content types through the core send path. Files: `packages/seals/src/publisher.ts`, `packages/core/src/core-context.ts`, `packages/core/src/xmtp-client-factory.ts`, `packages/core/src/sdk/sdk-client.ts`.
- `reveal.request` now rejects non-active sessions. Files: `packages/sessions/src/reveal-actions.ts`.
- Verifier config wiring now passes `config.buildProvenance` into the build provenance check. Files: `packages/verifier/src/service.ts`.
- `buildProvenance.expectedIdentityPattern` docs now match the current prefix semantics instead of claiming regex support. Files: `packages/verifier/src/config.ts`.
- Secure Enclave signer timeout is now 30s instead of 5s. Files: `packages/keys/src/se-bridge.ts`.
- `signet-signer create --label` is now explicitly advisory and echoed in output rather than silently pretending to be stored. Files: `signet-signer/Sources/signet-signer/CreateCommand.swift`.
- End-to-end live `threadId` propagation now exists. The current path derives `threadId` from reply `referenceId` in SDK type mapping, carries it through `XmtpDecodedMessage`, `raw.message`, `SignetCore`, and public `message.visible`, and the event projector consumes it. Files: `packages/core/src/sdk/type-mapping.ts`, `packages/core/src/xmtp-client-factory.ts`, `packages/core/src/raw-events.ts`, `packages/core/src/signet-core.ts`, `packages/schemas/src/events.ts`, `packages/cli/src/ws/event-projector.ts`.

### Improved But Not Fully Closed

- The websocket `reveal_content` handler now mirrors the action-side thread check for `scope === "thread"`, which narrows the original gap.
- That said, the reveal model still does not carry enough thread context for non-thread reveal scopes inside a thread-scoped session. See "Deeper-Dive Follow-Ups" below.

### Still Open Review Findings

- `[P1]` WebSocket broadcasts still project against `ws.data.sessionRecord`, so an idle socket can still receive pushed events under stale view/state until it sends another frame. Files: `packages/ws/src/server.ts`.
- `[P1]` `reveal_content` still stores grants without replaying already-hidden content or emitting `message.revealed`. Files: `packages/cli/src/ws/request-handler.ts`, `packages/schemas/src/events.ts`, `.agents/plans/v0/08-websocket-transport.md`, `.agents/plans/v0/04-policy-engine.md`.
- `[P2]` `build_provenance` still returns `pass` without cryptographic Sigstore / DSSE verification; the file explicitly documents this as not yet implemented. Files: `packages/verifier/src/checks/build-provenance.ts`, `packages/verifier/src/checks/sigstore-bundle.ts`.

## Findings Raised Against Intermediate Live Worktree Versions

- A temporary `packages/ws/src/server.ts` version awaited fresh lookup during broadcast, which introduced a sequence-order race and payload reordering risk. Current checked-out tree no longer has that exact shape.
- That same intermediate server version also kept stale sockets open and heartbeating after returning a revoked/expired response. Current checked-out tree appears to close and stop heartbeat instead.

## Deeper-Dive Follow-Ups

These are the places where the cleanup pass starts turning into product/policy design rather than a quick review-response patch.

- Reveal semantics for non-thread scopes inside a thread-scoped session.
  A message/sender/content-type/time-window reveal currently does not prove that the underlying message(s) live inside the allowed thread. Closing that completely likely requires message lookup or history access at reveal time, not just schema validation.
- Reveal replay for already-hidden content.
  The TODO is still real. A proper solution likely needs a message history surface plus a replay/emission path for `message.revealed`.
- End-to-end `threadId` propagation on live XMTP traffic.
  This now looks implemented in code. If deeper work continues here, the main remaining question is coverage depth: most current tests still exercise `threadId: null`, so explicit non-null reply-thread behavior is a good follow-up validation target.
- Cryptographic build provenance verification.
  The current check is structurally useful but not cryptographically strong. A real completion likely means integrating `sigstore-js` or equivalent.

These are good GitHub issue candidates. They are deeper follow-up work, not just "tighten one guard clause".

## Paths I Investigated But Did Not Count As Confirmed Bugs

- `packages/cli/src/http/server.ts` hardcodes `adminKeyFingerprint: "http-admin"`, but I did not find any current consumer of `ctx.adminAuth`, so I did not treat that as a live authorization bug.
- `packages/sessions/src/session-manager.ts` now revokes-before-dedup on direct `createSession()` calls, but the public `createSessionService.issue()` path still dedups first. I treated this as an internal oddity, not a confirmed user-facing regression.
- Production `sealManager.issue()` still has an unwired `resolveInput` stub in `packages/cli/src/start.ts`, but I did not find a live CLI/admin/MCP surface invoking it. If a new surface wires seal issuance, revisit immediately.

## Best Next Steps For The Next Reviewer

- Keep reviewing against `main...HEAD`; do not narrow to "files changed on the top branch only".
- Before re-reporting anything already listed above, reopen the current worktree version of the file because Matt is fixing issues live.
- Favor fresh surfaces over replaying already-closed findings:
- Admin/MCP/HTTP action paths for session-state parity with WS
- Any newly added schema/event/action surface that still lacks a live emitter
- Reveal/history plumbing if the goal shifts from cleanup into deeper product hardening
- Verifier trust model if the goal shifts from structural checks into actual provenance assurance
- Main-origin cleanup bugs are acceptable in this pass. If you find one while tracing the stack, keep it.
