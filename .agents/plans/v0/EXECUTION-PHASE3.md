# Phase 3 Execution Plan — Feature Complete (Minus Secure Enclave)

**Version:** 2.0
**Created:** 2026-03-17
**Updated:** 2026-03-17
**Status:** Ready to execute
**Prerequisite:** Phase 2C complete, all 38 PRs merged, `refactor/signet-rename` branch clean

## Overview

Phase 2C proved the signet works end-to-end on devnet. Phase 3 closes every
remaining gap from the PRD except Secure Enclave key binding (P1-1), which
requires Swift interop and gets its own plan.

Phase 3 delivers:

1. **Reveal-only view mode** (P1-2) — agents on `reveal-only` sessions see
   nothing by default; content appears only after explicit reveal grants
2. **Runtime seal publishing** (P2-2) — real Ed25519 stamping and group-message
   publishing, replacing the stub signer/publisher
3. **Session permission editing** (P2-4) — modify view/grant in-place without
   revoke + reissue
4. **Action confirmations** (P2-6) — pending action queue with owner
   confirm/deny flow
5. **HTTP API adapter** (P2-5) — REST for non-streaming operations
6. **Build provenance verification** (P2-3) — real Sigstore/GitHub OIDC in
   the verifier
7. **Deployment templates** (P2-1) — Dockerfile, docker-compose, Railway
8. **Docs terminology cleanup** (P2-7) — remaining `broker`/`attestation`
   references in historical docs

Many wire schemas already exist (`RevealContentRequest`, `ConfirmActionRequest`,
`UpdateViewRequest`, `ActionConfirmationEvent`, `ViewUpdatedEvent`,
`GrantUpdatedEvent`, `RevealEvent`). The work is primarily handlers, runtime
wiring, and new packages.

```text
main (or current stack top)
  └── v0/reveal-handlers        Step 1: reveal handlers + session reveal state
       └── v0/reveal-projection  Step 2: view projection pipeline in WS broadcast
            └── v0/seal-stamper   Step 3: real Ed25519 SealStamper
                 └── v0/seal-publisher  Step 4: real SealPublisher + runtime wiring
                      └── v0/session-update   Step 5: session permission editing
                           └── v0/action-confirm  Step 6: pending action queue + confirmations
                                └── v0/http-api    Step 7: HTTP API adapter
                                     └── v0/build-provenance  Step 8: Sigstore verification
                                          └── v0/deploy-templates  Step 9: Docker + Railway
                                               └── v0/docs-cleanup  Step 10: terminology cleanup
                                                    └── v0/phase3-tracer  Step 11: comprehensive tracer
```

Each branch = one commit. One commit per PR.

## Pre-Flight Checklist

```bash
gt sync -f
bun run build
bun run test
bun run typecheck
bun run lint
```

## Agent Roles

Same orchestrator/implementer/reviewer pattern as Phase 2. See `EXECUTION.md`
for the full role definitions.

---

## Step 1: Reveal Handlers & Session Reveal State

**Branch:** `v0/reveal-handlers`
**Scope:** `packages/sessions/`, `packages/cli/`
**Estimated size:** ~250 LOC

### Context

The wire schemas already exist:
- `RevealContentRequest` (`reveal_content`) in `HarnessRequest` union
- `RevealEvent` (`message.revealed`) in `SignetEvent` union
- `RevealRequest`, `RevealGrant`, `RevealScope` domain types in `schemas/src/reveal.ts`
- `RevealStateStore` with `createRevealStateStore()` in `packages/policy/`

What's missing: handlers that process reveal requests and session-scoped state.

### Changes

**`packages/sessions/src/session-manager.ts`** — Add per-session
`RevealStateStore`:

- Each `InternalSessionRecord` gets a `revealState: RevealStateStore` field,
  lazily created via `createRevealStateStore()` on first access.
- Expose `getRevealState(sessionId)` on the internal manager.
- Wire through the session service adapter to the `SessionManager` contract.

**`packages/contracts/src/services.ts`** — Extend `SessionManager`:

```typescript
interface SessionManager {
  // ... existing ...
  getRevealState(sessionId: string): Result<RevealStateStore, SignetError>;
}
```

**New file: `packages/sessions/src/reveal-actions.ts`**

Three ActionSpecs:

| Action ID | Handler | Input | Output |
|-----------|---------|-------|--------|
| `reveal.request` | Validate scope against session's `view.threadScopes`, create `RevealGrant`, add to `RevealStateStore` | `RevealContentRequest` | `RevealGrant` |
| `reveal.revoke` | Remove grant from state store by `revealId` | `{ revealId }` | `{ revoked: true }` |
| `reveal.list` | Return active grants for the session | `{}` | `RevealGrant[]` |

Phase 3: the signet auto-grants reveals. `reveal.request` immediately creates
the grant. The full owner-approval flow is wired in Step 6 (Action
Confirmations).

**`packages/cli/src/ws/request-handler.ts`** — Add `reveal_content` case:

```typescript
case "reveal_content":
  return handleRevealContent(request, session);
```

**`packages/cli/src/runtime.ts`** — Register reveal actions in the action
registry.

**Commit:** `feat(sessions): reveal grant/revoke handlers with session-scoped state`

**Success gate:** Reveal actions route through WS and admin socket. State
survives across requests within a session. Expired grants are cleaned up.

**Gotchas:**
- Use `createRevealStateStore()` from `@xmtp/signet-policy` — don't rebuild.
- Reveal state is in-memory, scoped to session lifetime. Discarded on
  revocation/expiry.
- `reveal.request` must validate `groupId` is within `session.view.threadScopes`.

---

## Step 2: Wire Projection Pipeline into WS Event Stream

**Branch:** `v0/reveal-projection`
**Scope:** `packages/cli/`, `packages/ws/`
**Estimated size:** ~200 LOC

### Changes

Today `broadcast()` sends raw `SignetEvent` objects to all connections. For
`reveal-only` mode, outbound events must pass through the view projection
pipeline.

**New file: `packages/cli/src/ws/event-projector.ts`**

```typescript
export interface EventProjectorDeps {
  readonly getRevealState: (sessionId: string) => RevealStateStore | null;
}

export function createEventProjector(
  deps: EventProjectorDeps,
): (event: SignetEvent, session: SessionRecord) => SignetEvent | null
```

For `message.visible` events:
1. Look up session's `RevealStateStore`
2. Call `isRevealed(messageId, groupId, threadId, senderInboxId, contentType)`
3. Call `projectMessage(rawMessage, session.view, effectiveAllowlist, isRevealed)`
4. `drop` -> return `null`; `emit` -> return projected event

Non-message events: pass through unchanged.

**`packages/ws/src/server.ts`** — Add optional `projectEvent` to `WsServerDeps`:

```typescript
readonly projectEvent?: (
  event: SignetEvent,
  session: SessionRecord,
) => SignetEvent | null;
```

Modify `broadcastToSession()`: call `projectEvent` before `sendSequenced()`.
If `null`, skip.

**Effective allowlist caching**: compute once per session at issuance using
`resolveEffectiveAllowlist()`. Store alongside session state.

**Commit:** `feat(ws): view projection pipeline for outbound events`

**Success gate:** `reveal-only` sessions get no message events for unrevealed
content (dropped). `redacted` sessions get events with `content: null`.
`full` sessions see no change.

**Gotchas:**
- `reveal-only` *drops* (hidden -> never sent). `redacted` sends `content: null`.
  Already encoded in `resolveVisibility()`.
- Projection is per-connection, not per-session.
- `projectMessage` expects `RawMessage` — thin adapter needed from
  `message.visible` event shape.

---

## Step 3: Real SealStamper

**Branch:** `v0/seal-stamper`
**Scope:** `packages/seals/`, `packages/keys/`
**Estimated size:** ~150 LOC

### Changes

**New file: `packages/seals/src/stamper.ts`**

```typescript
export interface StamperDeps {
  readonly getSigningKey: (
    sessionId: string,
  ) => Promise<Result<SigningKeyHandle, SignetError>>;
}

export function createSealStamper(deps: StamperDeps): SealStamper
```

1. `canonicalize()` the seal payload (already exists)
2. Look up session's operational key via `deps.getSigningKey`
3. Sign canonical bytes with Ed25519 (`@noble/curves`)
4. Return `SealEnvelope` with signature, keyId, algorithm `"Ed25519"`

**`packages/keys/src/key-manager.ts`** — Add:

```typescript
getSessionSigningKey(sessionId: string): Promise<Result<SigningKeyHandle, KeyError>>
```

Resolves session key -> operational key and returns a handle.

**Commit:** `feat(seals): Ed25519 SealStamper backed by key hierarchy`

**Success gate:** Signatures verify against operational key's public key.
Tests use real key material from software vault.

---

## Step 4: Real SealPublisher + Runtime Wiring

**Branch:** `v0/seal-publisher`
**Scope:** `packages/seals/`, `packages/cli/`
**Estimated size:** ~180 LOC

### Changes

**New file: `packages/seals/src/publisher.ts`**

```typescript
export interface PublisherDeps {
  readonly sendMessage: (
    groupId: string,
    contentType: string,
    content: unknown,
  ) => Promise<Result<{ messageId: string }, SignetError>>;
}

export function createSealPublisher(deps: PublisherDeps): SealPublisher
```

Sends seal envelopes as `xmtp.org/seal:1.0` group messages. Revocations use
`xmtp.org/seal-revocation:1.0`.

**`packages/cli/src/start.ts`** — Replace the three stubs in
`createProductionDeps().createSealManager()` with real implementations:
stamper backed by key manager, publisher backed by `core.sendMessage`,
real `InputResolver` from session state.

**`packages/cli/src/runtime.ts`** — Pass `keyManager`, `sendMessage`, and
`sessionManager` to `createSealManager`.

**Commit:** `feat(seals): real SealStamper + SealPublisher wired into runtime`

**Success gate:** No more stub errors. Seal manager signs and publishes when
core is `"ready"`.

**Gotchas:**
- Publishing requires `"ready"` core state. `"ready-local"` returns error.
- `InputResolver` needs session state for view/grant hashes.

---

## Step 5: Session Permission Editing

**Branch:** `v0/session-update`
**Scope:** `packages/sessions/`, `packages/cli/`
**Estimated size:** ~200 LOC

### Context

Schemas already exist:
- `UpdateViewRequest` (`update_view`) in `HarnessRequest`
- `ViewUpdatedEvent` (`view.updated`) and `GrantUpdatedEvent` (`grant.updated`) in `SignetEvent`
- `checkMateriality()` and `isMaterialChange()` in sessions/policy

What's missing: a handler that applies the update.

### Changes

**New file: `packages/sessions/src/update-actions.ts`**

Two ActionSpecs:

| Action ID | Handler | Input | Output |
|-----------|---------|-------|--------|
| `session.updateView` | Check materiality, apply if non-material or if reauth granted | `{ sessionId, view: ViewConfig }` | `{ updated: true, material: boolean }` |
| `session.updateGrant` | Same materiality check for grant changes | `{ sessionId, grant: GrantConfig }` | `{ updated: true, material: boolean }` |

Non-material changes (e.g., narrowing scope, removing content types) apply
immediately. Material escalations (e.g., `reveal-only` -> `full`, adding
`send` permission) set session state to `reauthorization-required` and
return `{ updated: false, material: true, delta: PolicyDelta }`.

**`packages/sessions/src/session-manager.ts`** — Add `updateView()` and
`updateGrant()` to internal manager. Use existing `checkMateriality()` and
`computeDelta()` from policy.

**`packages/cli/src/ws/request-handler.ts`** — Add `update_view` case.
On success, broadcast `view.updated` or `grant.updated` event to the session.

**`packages/cli/src/runtime.ts`** — Register update actions.

**Commit:** `feat(sessions): in-place session permission editing with materiality check`

**Success gate:** Non-material view/grant changes apply immediately. Material
escalations trigger reauthorization state. `view.updated` / `grant.updated`
events are broadcast to the session's connections.

**Gotchas:**
- The existing `checkMateriality` already computes `PolicyDelta` — use it.
- Non-material changes apply without confirmation. Material changes require
  explicit reauthorization (separate from action confirmations in Step 6).
- Reauthorization clears the `reauthorization-required` state.

---

## Step 6: Action Confirmations

**Branch:** `v0/action-confirm`
**Scope:** `packages/sessions/`, `packages/cli/`
**Estimated size:** ~280 LOC

### Context

Schemas already exist:
- `ConfirmActionRequest` (`confirm_action`) in `HarnessRequest`
- `ActionConfirmationEvent` (`action.confirmation_required`) in `SignetEvent`
- `GrantConfig.messaging.draftOnly` — the flag that triggers confirmation

What's missing: a pending action queue and the confirm/deny flow.

### Changes

**New file: `packages/sessions/src/pending-actions.ts`**

```typescript
export interface PendingAction {
  readonly actionId: string;
  readonly sessionId: string;
  readonly actionType: string;
  readonly payload: unknown;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface PendingActionStore {
  add(action: PendingAction): void;
  get(actionId: string): PendingAction | null;
  confirm(actionId: string): PendingAction | null;
  deny(actionId: string): PendingAction | null;
  expireStale(now: Date): number;
  listBySession(sessionId: string): readonly PendingAction[];
}

export function createPendingActionStore(): PendingActionStore
```

In-memory store, scoped per runtime (not per session — admin may confirm
actions on behalf of sessions).

**`packages/cli/src/ws/request-handler.ts`** — Modify `handleSendMessage`:

When `session.grant.messaging.draftOnly` is `true`:
1. Create a `PendingAction` with the message payload
2. Broadcast `action.confirmation_required` event with preview
3. Return `{ pending: true, actionId }` instead of sending immediately

Add `confirm_action` case:
1. Look up pending action
2. If `confirmed: true`, execute the original action
3. If `confirmed: false`, discard and return `{ denied: true }`
4. Either way, remove from pending store

**Pending action expiry**: actions expire after a configurable timeout
(default: 5 minutes). Expired actions are auto-denied.

**`packages/cli/src/runtime.ts`** — Create `PendingActionStore` during
startup. Pass to request handler deps.

**Commit:** `feat(cli): action confirmation flow with pending action queue`

**Success gate:** `draftOnly` sessions get confirmation events instead of
immediate sends. `confirm_action` with `confirmed: true` executes the
original send. `confirmed: false` discards. Expired actions are cleaned up.

**Gotchas:**
- Phase 3 scope: confirmations only for `send_message` when `draftOnly`
  is true. Extending to group management and tool calls is follow-up.
- The `actionId` must be unique and correlatable across the confirmation
  round-trip.
- The `preview` field in `ActionConfirmationEvent` carries enough context
  for the harness to show the pending action to the user.

---

## Step 7: HTTP API Adapter

**Branch:** `v0/http-api`
**Scope:** New `packages/http/` or within `packages/cli/`
**Estimated size:** ~300 LOC

### Changes

REST API for non-streaming operations. Reuses the existing `ActionRegistry` —
each registered ActionSpec gets a corresponding HTTP endpoint.

**New file: `packages/cli/src/http/server.ts`**

```typescript
export interface HttpServerConfig {
  readonly port: number;
  readonly host: string;
}

export interface HttpServerDeps {
  readonly registry: ActionRegistry;
  readonly sessionManager: SessionManager;
  readonly adminDispatcher: AdminDispatcher;
}

export function createHttpServer(
  config: HttpServerConfig,
  deps: HttpServerDeps,
): HttpServer
```

Uses `Bun.serve()` (already blessed). Routes:

| Method | Path | Auth | Maps to |
|--------|------|------|---------|
| POST | `/v1/admin/:method` | Admin JWT (Bearer) | `AdminDispatcher.dispatch(method, params)` |
| POST | `/v1/session/:method` | Session token (Bearer) | ActionSpec handler |
| GET | `/v1/health` | None | Daemon status |

Request body: JSON. Response: JSON with `{ ok, data?, error? }` envelope
matching the WS response format.

Admin endpoints: session management, broker status/stop, reveal management.
Session endpoints: send_message, reveal_content, confirm_action.

**Auth middleware**: Extract `Authorization: Bearer <token>`, determine if
admin JWT or session token, attach appropriate context.

**`packages/cli/src/runtime.ts`** — Create HTTP server during startup, after
admin + WS servers. Add to shutdown sequence.

**`packages/cli/src/config/schema.ts`** — Add `HttpServerConfigSchema` with
port/host/enabled flag. Default: disabled (opt-in for Phase 3).

**Commit:** `feat(cli): HTTP API adapter for non-streaming operations`

**Success gate:** Admin and session endpoints work via curl. Health endpoint
returns daemon status. Error responses use the same category/code taxonomy as
WS. Auth errors return 401, validation 400, not_found 404, permission 403.

**Gotchas:**
- No streaming — HTTP is for request/response only. Message streaming stays
  on WebSocket.
- The HTTP server is optional (disabled by default in config). Enable with
  `[http] enabled = true` in config TOML.
- Session auth on HTTP: the session token is passed as `Authorization: Bearer`.
  Same token as WS auth. Looked up via `sessionManager.lookupByToken`.
- Status code mapping from error categories:
  `validation` -> 400, `auth` -> 401, `permission` -> 403, `not_found` -> 404,
  `timeout` -> 408, `internal` -> 500.

---

## Step 8: Build Provenance Verification

**Branch:** `v0/build-provenance`
**Scope:** `packages/verifier/`
**Estimated size:** ~250 LOC

### Changes

Replace the v0 stub in `packages/verifier/src/checks/build-provenance.ts`
with real Sigstore verification.

**`packages/verifier/src/checks/build-provenance.ts`** — Rewrite:

1. Decode the base64 build provenance bundle
2. Parse as a Sigstore bundle (DSSE envelope with in-toto statement)
3. Verify the signature against the Sigstore public good instance
   - Verify the certificate chain (Fulcio -> root)
   - Verify the signed timestamp (Rekor inclusion proof)
   - Verify the certificate's OIDC identity matches expected values
4. Extract the in-toto statement's subject and compare against
   `request.artifactDigest`
5. Return `pass` if all checks succeed, `fail` with specific reason otherwise

**New dependency: `sigstore`** — The official Sigstore JS SDK.
Add to `packages/verifier/package.json`.

**New file: `packages/verifier/src/checks/sigstore-client.ts`**

Thin wrapper around the `sigstore` package to:
- Fetch and cache the Sigstore TUF root
- Verify bundles
- Extract OIDC identity claims from the signing certificate

**`packages/verifier/src/config.ts`** — Add config for expected OIDC issuer
and subject identity patterns (e.g., GitHub Actions workflow identity).

**Commit:** `feat(verifier): real Sigstore build provenance verification`

**Success gate:** Valid Sigstore bundles from GitHub Actions verify
successfully. Invalid/tampered bundles fail with specific reasons. Missing
bundles still return `skip`.

**Gotchas:**
- The `sigstore` npm package handles the heavy cryptographic lifting. Don't
  reimplement certificate chain or Rekor verification.
- Offline verification using the TUF root is preferred over online Rekor
  lookups for reliability.
- Expected OIDC identity should be configurable — different repos have
  different workflow identities.
- The bundle format is Sigstore's protobuf-based format, not the legacy
  cosign format.

---

## Step 9: Deployment Templates

**Branch:** `v0/deploy-templates`
**Scope:** Root-level files
**Estimated size:** ~120 LOC

### Changes

**New file: `Dockerfile`**

Multi-stage build:
1. `base`: `oven/bun:1` with workspace install
2. `build`: `bun run build`
3. `runtime`: minimal image with built artifacts and `bun` binary

Entrypoint: `bun run packages/cli/src/index.ts`

Key decisions:
- Use `oven/bun:1-slim` for runtime stage
- Copy only `packages/*/dist/`, `package.json`, and lockfile
- Health check via the HTTP health endpoint (if enabled) or admin socket

**New file: `docker-compose.yml`**

```yaml
services:
  signet:
    build: .
    ports:
      - "8080:8080"   # WebSocket
      - "8081:8081"   # HTTP (optional)
    volumes:
      - signet-data:/data
    environment:
      - SIGNET_DATA_DIR=/data
      - SIGNET_ENV=dev
```

**New file: `railway.json`**

Railway deployment template with:
- Build command: `bun install && bun run build`
- Start command: `bun run packages/cli/src/index.ts start`
- Health check path: `/v1/health`
- Required env vars documented

**Commit:** `feat: Dockerfile, docker-compose, and Railway deployment templates`

**Success gate:** `docker build .` succeeds. `docker compose up` starts the
signet with a volume-backed data directory. Railway template validates.

**Gotchas:**
- The Bun lockfile (`bun.lock`) must be copied into the build stage for
  reproducible installs.
- Workspace hoisting: `bun install` in Docker must resolve workspace
  dependencies correctly.
- Config TOML in Docker: mount as a volume or use env var overrides.
- Railway needs `PORT` env var support — the HTTP server should respect it.

---

## Step 10: Historical Docs Terminology Cleanup

**Branch:** `v0/docs-cleanup`
**Scope:** `.agents/`, `.claude/`, `.trail/`
**Estimated size:** ~100 LOC (mechanical find/replace)

### Changes

Update historical planning documents that still use `broker`/`attestation`
where they now mean `signet`/`seal`:

- `.agents/plans/v0/*.md` — execution plans, specs
- `.agents/docs/` — PRD, design docs
- `.agents/notes/` — working notes
- `.claude/` — skills, agent configs
- `.trail/` — session notes

This is a mechanical rename with manual review for context-dependent terms:
- `broker` -> `signet` (when referring to the runtime, not the concept)
- `attestation` -> `seal` (when referring to the cryptographic artifact)
- `attest` -> `stamp`/`seal` (verb forms)
- Leave terms unchanged when they refer to the historical design phase

**Commit:** `docs: update historical plans to use signet/seal terminology`

**Success gate:** `rg -i "broker" .agents/ .claude/ .trail/` returns only
intentional historical references (e.g., "renamed from broker to signet").

**Gotchas:**
- Don't rename `xmtp-broker` in file paths or git history references.
- Keep the REMAINING-WORK.md note about the rename being complete.
- Some terms are genuinely dual-use — e.g., "broker" in the general sense
  of "intermediary" is fine in design discussions.

---

## Step 11: Comprehensive Tracer Bullet

**Branch:** `v0/phase3-tracer`
**Scope:** Test-only, no production code changes
**Estimated size:** ~300 LOC

### Tests

**New file: `packages/cli/src/__tests__/reveal-mode.test.ts`**

Reveal-only mode end-to-end:

1. Start daemon with temp config
2. `identity init`
3. `session issue` with `mode: "reveal-only"`, scoped to test group
4. Connect via WS
5. Trigger message event for scoped group
6. **Assert**: no event received (hidden)
7. Send `reveal_content` for the sender
8. Trigger another message from same sender
9. **Assert**: `message.visible` with `visibility: "revealed"` and full content
10. Send reveal revoke via admin action
11. Trigger another message
12. **Assert**: no event (hidden again)
13. `broker stop`

**New file: `packages/cli/src/__tests__/seal-wiring.test.ts`**

Seal signing verification:

1. Start daemon, `identity init`, `session issue`
2. Issue a seal via seal manager
3. **Assert**: signed with Ed25519, signature verifies
4. Stop

**New file: `packages/cli/src/__tests__/session-update.test.ts`**

Permission editing:

1. Start daemon, `identity init`
2. `session issue` with narrow view
3. Send `update_view` to widen scope (non-material)
4. **Assert**: `view.updated` event, session view changed
5. Send `update_view` to escalate mode (material)
6. **Assert**: session enters `reauthorization-required`, update rejected
7. Stop

**New file: `packages/cli/src/__tests__/action-confirm.test.ts`**

Confirmation flow:

1. Start daemon, `identity init`
2. `session issue` with `draftOnly: true`
3. Connect via WS, send `send_message`
4. **Assert**: `action.confirmation_required` event received
5. Send `confirm_action` with `confirmed: true`
6. **Assert**: message sent, response received
7. Send another `send_message`
8. Send `confirm_action` with `confirmed: false`
9. **Assert**: action denied, message not sent
10. Stop

**New file: `packages/cli/src/__tests__/http-api.test.ts`**

HTTP adapter:

1. Start daemon with HTTP enabled
2. `POST /v1/health` — assert 200
3. `POST /v1/admin/broker.status` with admin JWT — assert daemon status
4. `POST /v1/admin/session.issue` — assert session token returned
5. `POST /v1/session/send_message` with session token — assert routed
6. Unauthenticated request — assert 401
7. Stop

**Commit:** `test(cli): Phase 3 comprehensive tracer bullet`

**Success gate:**
- Reveal-only projection: hidden -> revealed -> hidden
- Seal stamping: valid Ed25519 signatures
- Session updates: non-material applies, material rejects
- Action confirmations: pending -> confirm/deny works
- HTTP API: admin + session auth, health check
- No regressions in existing smoke tests

---

## Key Design Decisions

### Reveal-only drops, redacted shows placeholders

Already encoded in `resolveVisibility()`. Phase 3 wires it through.

### Auto-grant reveals, confirmation layer follows

Step 1 auto-grants. Step 6 adds the pending action queue for `draftOnly`
sessions. The reveal flow can optionally route through confirmations in a
follow-up by flagging reveal requests as confirmation-required.

### Projection at broadcast time

Per-connection in `broadcastToSession()`. Different sessions see different
projections of the same raw event.

### HTTP is opt-in

Default disabled. Avoids opening another port for users who don't need REST.
The WS transport remains primary.

### Sigstore SDK for build provenance

Don't reimplement crypto. The `sigstore` package handles certificate chains,
Rekor proofs, and TUF root management.

### Docs cleanup is mechanical

Find/replace with manual review. Not a refactor — just terminology alignment.

---

## File Summary

| Step | New Files | Modified Files |
|------|-----------|----------------|
| 1 | `sessions/src/reveal-actions.ts` | `sessions/src/session-manager.ts`, `contracts/src/services.ts`, `cli/src/ws/request-handler.ts`, `cli/src/runtime.ts` |
| 2 | `cli/src/ws/event-projector.ts` | `cli/src/start.ts`, `ws/src/server.ts` |
| 3 | `seals/src/stamper.ts` | `keys/src/key-manager.ts` |
| 4 | `seals/src/publisher.ts` | `cli/src/start.ts`, `cli/src/runtime.ts` |
| 5 | `sessions/src/update-actions.ts` | `sessions/src/session-manager.ts`, `cli/src/ws/request-handler.ts`, `cli/src/runtime.ts` |
| 6 | `sessions/src/pending-actions.ts` | `cli/src/ws/request-handler.ts`, `cli/src/runtime.ts` |
| 7 | `cli/src/http/server.ts` | `cli/src/runtime.ts`, `cli/src/config/schema.ts` |
| 8 | `verifier/src/checks/sigstore-client.ts` | `verifier/src/checks/build-provenance.ts`, `verifier/src/config.ts` |
| 9 | `Dockerfile`, `docker-compose.yml`, `railway.json` | — |
| 10 | — | `.agents/**/*.md`, `.claude/**/*.md` |
| 11 | 4 test files | — |

## Step Summary

| Step | Branch | Focus | ~LOC |
|------|--------|-------|------|
| 1 | `v0/reveal-handlers` | Reveal handlers + session state | 250 |
| 2 | `v0/reveal-projection` | View projection in WS broadcast | 200 |
| 3 | `v0/seal-stamper` | Ed25519 SealStamper | 150 |
| 4 | `v0/seal-publisher` | SealPublisher + runtime wiring | 180 |
| 5 | `v0/session-update` | Session permission editing | 200 |
| 6 | `v0/action-confirm` | Pending action queue + confirmations | 280 |
| 7 | `v0/http-api` | HTTP API adapter | 300 |
| 8 | `v0/build-provenance` | Sigstore verification | 250 |
| 9 | `v0/deploy-templates` | Docker + Railway | 120 |
| 10 | `v0/docs-cleanup` | Terminology cleanup | 100 |
| 11 | `v0/phase3-tracer` | Comprehensive tracer bullet | 300 |

11 branches, 11 commits, 11 PRs. ~2330 LOC total.

## Gotchas

- **Schemas already exist** for most wire types. Don't re-create them.
- **Reveal-only drops, redacted shows null.** Different behaviors.
- **`RevealStateStore` already implemented** — use `createRevealStateStore()`.
- **Seal publishing requires `"ready"` core state.** Signing works in
  `"ready-local"`, publishing does not.
- **`checkMateriality` already exists** — use it for session permission editing.
- **HTTP API is opt-in** — default disabled in config.
- **`sigstore` is a new dependency** — only for the verifier package.
- **Docs cleanup is context-dependent** — not all "broker" references should
  change. Historical design discussions may legitimately reference the old name.
- **The `HarnessRequest` union must stay backward-compatible.** Existing
  harnesses that don't use new request types continue to work.
