# XMTP Signet, Harness Compatibility, and the Fast Path to HTTP

Date: 2026-03-30
Status: Working memo

## Thesis

The current XMTP pain is real, but the right answer is not "make XMTP look exactly like Slack webhooks."

The right answer is:

1. Make **Signet** the stable harness-facing platform boundary.
2. Ship a harness-facing **HTTP action API** quickly.
3. Treat outbound delivery as an **event bridge** problem first, and only as a webhook problem where that is actually necessary.

That gets us much closer to existing harness expectations without forcing the whole design into a webhook-shaped box.

## The core problem

XMTP today is still client-shaped. The official docs assume a real SDK client, real key material, a DB encryption key, persistent storage, and a live stream loop.[^xmtp-node][^xmtp-agent][^xmtp-deploy]

That is why it feels heavier than Slack, Telegram, Linear, or parts of Discord:

- those platforms expose an app/bot integration surface
- XMTP mostly exposes an agent/client runtime surface

So the frustration is not just "XMTP lacks webhooks." The deeper issue is that some trusted runtime must actually be the XMTP participant and own sync, state, and decryption.

## What Signet changes

Signet is valuable because it moves that burden out of the harness.

Instead of:

- harness owns keys
- harness owns the XMTP client
- permissions are advisory

Signet gives:

- Signet owns keys, sync, encryption, and policy
- harness authenticates with scoped credentials
- harness gets projected events and allowed actions
- seals make the trust posture inspectable[^signet-readme][^signet-concepts][^signet-security]

That is already the right architecture.

## The strongest near-term conclusion

We can likely get a harness-facing HTTP **action** API quickly.

Why:

- the repo already has transport-agnostic handlers
- action inputs are already Zod-validated contracts
- actions are already registry-backed
- there is already a dispatcher pattern that does lookup, validation, execution, and error normalization[^signet-architecture][^signet-action-spec][^signet-admin-dispatcher]

The missing piece is mostly surface wiring, not a new core model.

## The most important design distinction

There are really two separate asks:

### 1. Action ingress

"How does the harness tell Signet to do something?"

This is the easy one.

### 2. Event egress

"How does the harness become aware of incoming XMTP activity and fire its own internal logic?"

This is the harder one, and it should not be reduced to "just add webhooks."

## Recommendation

### Ship this first: HTTP action API

Add a credential-scoped surface like:

- `POST /v1/agent/actions/<action-id>`

With:

- bearer credential auth
- Zod validation against the existing action input schema
- normalized success/error envelope
- curated action exposure

This is the fastest bridge for harnesses that want simple request/response semantics.

### Do not make outbound start as "core webhooks"

For outbound, the more correct primitive is a **Signet event bridge**.

Why:

- Signet already has a canonical WebSocket event model
- events are already sequenced
- replay and recovery already exist
- this matches the actual semantics of XMTP much better than pretending everything is stateless HTTP[^signet-ws][^signet-primary-transport]

Webhooks can still exist, but they should be one adaptation mode of the event bridge, not the first principle of the system.

## Proposed architecture

### A. Primary Signet Runner

This is the stateful, trusted runtime.

Responsibilities:

- key management
- credential issuance
- encrypted state / MLS state
- XMTP sync and message projection
- permission enforcement
- seals
- canonical event stream
- harness-facing action API

This is already what Signet mostly is.

### B. Harness Bridge Runner

This is the lightweight compatibility layer that sits near the harness.

Responsibilities:

- hold only short-lived credential tokens
- connect outbound to the Primary Signet over WebSocket
- track `lastSeenSeq`
- translate Signet events into harness-native internal events
- optionally expose compatibility adapters:
  - in-process event emitter
  - local HTTP callback adapter
  - SSE stream
  - queue publisher

This is the missing piece that satisfies the friend's actual goal: "make the harness aware so it can fire its own internal logic."

## Why this split is better than going straight to first-class webhooks

Because it separates the security-sensitive stateful core from the harness-local compatibility problem.

The Primary Signet keeps:

- keys
- encryption
- auth
- issuance
- policy
- replay truth

The Harness Bridge keeps:

- local event adaptation
- harness-specific callback semantics
- framework glue

That gives flexibility without pushing raw keys or XMTP state back into the harness.

## The outbound spec

The canonical outbound interface should be the existing Signet event stream, not a webhook format.

### Canonical event source

The Primary Signet exposes credential-scoped WebSocket events:

- `message.visible`
- `message.revealed`
- `seal.stamped`
- `credential.expired`
- `credential.reauthorization_required`
- `scopes.updated`
- `agent.revoked`
- `action.confirmation_required`
- `signet.recovery.complete`

Those are already close to the right abstraction for harnesses.[^signet-architecture]

### Bridge responsibilities

The Harness Bridge should:

1. authenticate with a credential token
2. reconnect automatically
3. persist `lastSeenSeq`
4. replay missed events on reconnect
5. dedupe by `(credentialId, seq)`
6. emit harness-local events

### Delivery modes

The same bridge can support multiple outbound delivery modes:

| Mode | What it is | Best for |
| --- | --- | --- |
| `emitter` | In-process callbacks / event emitter | Harnesses that can register listeners directly |
| `sse` | Local or remote server-sent stream | Browser-ish or service integrations |
| `webhook` | POST selected events to configured callback URLs | Existing webhook-shaped harnesses |
| `queue` | Push into Redis/NATS/SQS/etc. | Durable async orchestration |

This avoids forcing a 1:1 "every Signet event must become a public webhook" mapping.

## The fast implementation path

### Phase 1: HTTP actions

Implement now:

- `POST /v1/agent/actions/<action-id>`
- curated subset of harness-safe actions
- credential auth
- shared result envelope

Good initial subset:

- `message.send`
- `message.reply`
- `message.react`
- `conversation.list`
- `conversation.info`
- reveal-related actions

### Phase 2: Harness Bridge SDK / sidecar

Implement a small runner or package that:

- wraps the existing WebSocket transport
- emits local events
- supports replay/reconnect
- optionally fans out to webhook/SSE/queue adapters

This is probably the highest-leverage outbound move.

### Phase 3: Contract alignment before the surface ossifies

This is where Signet should borrow from the Trails direction, without taking a runtime dependency:

- add first-class `intent` and `idempotent` semantics to `ActionSpec`
- add `http` surface metadata and extend the registry to support `http`
- derive HTTP defaults deterministically from the contract instead of hand-wiring routes
- validate the registry at startup for duplicate IDs, route collisions, and contradictory surface config
- add example-backed contract tests for exported actions
- generate a diffable surface map or lock file before the HTTP surface becomes public

This is not required to ship the first HTTP action endpoint, but it is the right next move if we want the eventual public surface to stay coherent.[^trails-notes]

## What "doing it right" means right now

Since this surface is not yet ossified, we should take advantage of that:

- do not bolt on ad hoc HTTP handlers forever
- make the action API obviously contract-derived
- make the event bridge the canonical outbound story
- back-port the good contract guardrails from Trails without importing the framework itself
- keep webhook delivery as an adapter, not the center of the model

That is the cleanest way to end up with something that is:

- secure
- harness-compatible
- transport-flexible
- honest about XMTP's real semantics

## Bottom line

My recommendation is:

1. **Commit** to HTTP actions now. They are close.
2. **Design outbound as a bridge** over the canonical Signet event stream.
3. **Support webhooks as one bridge mode**, not as the whole architecture.
4. **Back-port the best Trails contract ideas** into Signet directly: intent, deterministic derivation, validation, and drift detection.
5. **Split the system explicitly** into a stateful Primary Signet and a lightweight Harness Bridge.

That gives existing harnesses something that feels substantially like the other messaging integrations they already know, while still preserving the actual strengths of Signet.

## References

[^xmtp-node]: XMTP Node SDK docs: <https://docs.xmtp.org/chat-apps/get-started/get-started-nodesdk>
[^xmtp-agent]: XMTP agent docs: <https://docs.xmtp.org/agents/get-started/build-an-agent>
[^xmtp-deploy]: XMTP deploy docs: <https://docs.xmtp.org/agents/production/deploy-an-agent>
[^signet-readme]: Signet overview: [README.md](https://github.com/galligan/xmtp-signet/blob/main/README.md)
[^signet-concepts]: Signet concepts: [docs/concepts.md](https://github.com/galligan/xmtp-signet/blob/main/docs/concepts.md)
[^signet-security]: Signet security model: [docs/security.md](https://github.com/galligan/xmtp-signet/blob/main/docs/security.md)
[^signet-architecture]: Signet architecture and event model: [docs/architecture.md](https://github.com/galligan/xmtp-signet/blob/main/docs/architecture.md)
[^signet-action-spec]: `ActionSpec` definition: [packages/contracts/src/action-spec.ts](https://github.com/galligan/xmtp-signet/blob/main/packages/contracts/src/action-spec.ts)
[^signet-admin-dispatcher]: Dispatcher implementation: [packages/cli/src/admin/dispatcher.ts](https://github.com/galligan/xmtp-signet/blob/main/packages/cli/src/admin/dispatcher.ts)
[^signet-ws]: WebSocket transport: [packages/ws/src/server.ts](https://github.com/galligan/xmtp-signet/blob/main/packages/ws/src/server.ts)
[^signet-primary-transport]: PRD transport guidance: [.agents/docs/init/xmtp-signet.md](https://github.com/galligan/xmtp-signet/blob/main/.agents/docs/init/xmtp-signet.md)
[^trails-notes]: Related Outfitter-derived notes checked into this repo: [transport-agnostic-handlers.md](https://github.com/galligan/xmtp-signet/blob/main/.agents/notes/outfitter-patterns/transport-agnostic-handlers.md), [shared-handler-surfaces.md](https://github.com/galligan/xmtp-signet/blob/main/.agents/notes/outfitter-patterns/shared-handler-surfaces.md), and [schema-first-architecture.md](https://github.com/galligan/xmtp-signet/blob/main/.agents/notes/outfitter-patterns/schema-first-architecture.md)
