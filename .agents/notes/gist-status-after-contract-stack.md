# Gist Status After The Contract + HTTP Stack

Date: 2026-03-30
Status: Working note

## Context

This note compares the original gist:

- <https://gist.github.com/galligan/7306839d30d4db1a842e692da833b763>

against the merged Signet stack:

- #228 through #235

The goal is to answer a simple question:

- what did we actually satisfy?
- what is still missing?

## Short Answer

We satisfied the core platform thesis of the gist.

We did **not** yet satisfy the full outbound compatibility story that motivated
it.

The cleanest summary is:

- Signet is now much better positioned as the stable harness-facing boundary.
- The contract-first cleanup is done.
- A real contract-driven HTTP action surface now exists.
- The outbound bridge model is clearly specified.
- The outbound bridge is still a design, not an implemented runtime.

## What We Satisfied

### 1. Contract-first foundation

The gist argued that we should formalize the action surface around shared
contracts instead of bolting on HTTP as a one-off adapter.

That is now true.

Delivered:

- richer authored `ActionSpec`
- top-level `description`, `intent`, `idempotent`
- optional `output` and executable `examples`
- explicit `http` surface metadata
- deterministic derivation for CLI, admin RPC, MCP, and HTTP
- registry validation for collisions and contradictions
- deterministic action surface map + stable hash

Relevant code:

- `packages/contracts/src/action-spec.ts`
- `packages/contracts/src/action-derive.ts`
- `packages/contracts/src/action-validate.ts`
- `packages/contracts/src/action-registry.ts`
- `packages/contracts/src/action-surface-map.ts`

This is the deepest architectural part of the gist, and it is now satisfied.

### 2. HTTP ingress is real

The gist’s near-term recommendation was to ship HTTP ingress because the repo
already had:

- transport-agnostic handlers
- schema-validated action contracts
- registry-backed actions
- dispatcher patterns

That proved correct.

Delivered:

- contract-derived HTTP action routes
- shared validation through action schemas
- normalized result/error handling
- explicit `http.auth`
- route derivation from shared action contracts

Relevant code:

- `packages/cli/src/http/action-routes.ts`
- `packages/cli/src/http/server.ts`

This means HTTP ingress is no longer a memo or an idea. It exists in the code.

### 3. Existing actions now participate in the HTTP surface

We now have real action specs with HTTP exposure across several areas:

- `credential.issue`
- `credential.list`
- `credential.lookup`
- `credential.revoke`
- `credential.updateScopes`
- `reveal.request`
- `reveal.list`
- several `conversation.*` actions

Relevant code:

- `packages/sessions/src/actions.ts`
- `packages/sessions/src/update-actions.ts`
- `packages/sessions/src/reveal-actions.ts`
- `packages/core/src/conversation-actions.ts`

So the “HTTP action API” idea is not hypothetical anymore.

### 4. The outbound model is now explicitly specified

The gist argued that outbound should be treated as an event-bridge problem, not
just “add webhooks.”

That design position is now captured clearly in:

- `docs/outbound-harness-event-bridge.md`

That doc establishes:

- canonical source = Signet event stream
- Primary Signet Runner vs Harness Bridge Runner split
- replay/checkpoint model
- dedupe strategy
- adapter modes such as webhook / SSE / queue / emitter

So the outbound story is now much more concrete than it was when the gist was
written.

### 5. Docs and local guidance now reflect the new model

We also cleaned up the repo guidance so the implementation story is consistent.

Updated:

- `README.md`
- `docs/architecture.md`
- `docs/development.md`
- `.agents/plans/v1/v1-architecture.md`
- `.claude/skills/xmtp-signet-dev/SKILL.md`
- related local references

This matters because the gist kicked off a structural cleanup, not just code.

## What Is Only Partially Satisfied

### 1. We shipped HTTP actions, but not yet the exact harness-facing shape from the gist

The gist described a friendly ingress shape like:

- `POST /v1/agent/actions/<action-id>`

What we actually shipped is a cleaner contract-derived action surface under:

- `/v1/actions/...`

That is good architecture, and probably better long-term, but it is not yet the
same thing as a polished “agent-facing compatibility API” layer.

So this is partially satisfied:

- core ingress surface: yes
- final harness-compatibility packaging: not fully

### 2. The action subset is useful, but not complete for common harness flows

The gist called out a likely high-value subset such as:

- `message.send`
- `message.reply`
- `message.react`
- `conversation.list`
- `conversation.info`
- reveal-related actions

Today:

- `conversation.list`: yes
- `conversation.info`: yes
- reveal actions: yes
- `message.send` / `message.reply` / `message.react`: not yet as HTTP action specs

That means a core piece of “simple harness request/response control” is still
missing.

## What Is Still Left To Do

### 1. Implement the outbound bridge

This is the biggest remaining gap relative to the gist.

We have the design. We do not yet have the runtime.

Still needed:

- a real Harness Bridge Runner or SDK/sidecar
- connection to the canonical Signet event stream
- persisted `lastSeenSeq`
- replay handling
- dedupe by `(credentialId, seq)`
- local re-emission into harness-native events

Until that exists, the friend’s original practical concern is only partially
resolved.

### 2. Implement adapter modes for outbound compatibility

Still needed:

- webhook adapter
- SSE adapter
- queue adapter
- possibly an in-process emitter bridge for embedded harnesses

The design says these should be adapters over the canonical event stream. That
is still the right path, but the code does not exist yet.

### 3. Decide whether to add a thinner compatibility layer over the HTTP surface

We now have the contract-driven HTTP action surface.

We still need to decide whether external harnesses should consume that directly,
or whether Signet should also expose a thinner compatibility-oriented facade
with more explicitly “agent” semantics.

That is now an ergonomics/product decision, not a core architecture blocker.

### 4. Add message action HTTP exposure if we want the shortest path to practical harness value

If the goal is to make existing harnesses feel productive quickly, the next
highest-leverage ingress addition is probably:

- `message.send`
- `message.reply`
- `message.react`

Without those, the HTTP surface is real but still somewhat admin / conversation
/ reveal heavy.

## Bottom Line

The merged stack validated the gist’s main thesis:

- Signet should be the stable harness-facing boundary.
- We should clean up the contracts first.
- HTTP ingress is close and worth shipping.
- Outbound should be an event-bridge story, not a webhook-first rewrite.

What remains is the part most tightly tied to the friend’s operational need:

- the actual outbound bridge implementation
- adapter delivery modes
- possibly a friendlier compatibility layer on top of the new HTTP surface

So the current status is:

- platform/core cleanup: done
- HTTP ingress foundation: done
- outbound bridge design: done
- outbound bridge runtime: still open
- webhook/SSE/queue adaptation: still open
- message-action HTTP coverage: still open
