# Outbound Harness Event Bridge

Date: 2026-03-30
Status: Proposed

## Goal

Define the outbound model that lets agent harnesses become aware of XMTP-driven
activity and fire their own internal logic without forcing Signet to become a
webhook-first system.

The key design choice is:

- the canonical outbound source remains the Signet event stream
- a lightweight bridge adapts that stream to harness-native delivery modes
- webhooks are one adapter mode, not the root abstraction

This complements the contract-driven HTTP action surface:

- HTTP actions solve ingress
- the event bridge solves egress

For the current runtime and event model, see [runtime.md](./runtime.md).

## Canonical Source

The canonical outbound source is the existing credential-scoped Signet event
stream carried over sequenced frames with monotonic sequence numbers.

That source already matches the true runtime model:

- Signet is the real XMTP client
- Signet owns sync, decryption, policy, and projection
- harnesses should consume projected Signet events, not raw XMTP traffic

The bridge should consume the same sequenced event stream already used by
first-party Signet clients.

## Runners

### Primary Signet Runner

The primary runner is the stateful, trusted runtime.

Responsibilities:

- key custody
- encrypted state and XMTP sync
- credential issuance and revocation
- permission enforcement and content projection
- canonical event sequencing
- HTTP action ingress

The primary runner is the source of truth for replay and ordering.

### Harness Bridge Runner

The harness bridge is a lightweight sidecar or embedded adapter that sits near
the harness.

Responsibilities:

- authenticate to the primary Signet
- subscribe to the credential-scoped event stream
- persist replay checkpoints
- dedupe and re-emit events locally
- adapt canonical Signet events into harness-native delivery modes

The bridge should not own:

- raw XMTP keys
- encrypted Signet state
- MLS/session logic
- policy decisions

## Auth Posture

### Phase 1 posture

Use existing credential tokens to authenticate the bridge to the primary
Signet.

This keeps the first implementation simple:

- no new root auth system
- no duplicate token lifecycle on day one
- outbound bridge behavior stays aligned with existing scoped credentials

### Phase 2 posture

Add an optional exchange flow that mints a shorter-lived bridge session token
from a credential token.

That token should be bound to:

- `credentialId`
- allowed delivery modes
- issued-at / expiry
- optional bridge instance ID

This is useful once bridge fleets, queues, or webhook fan-out need stronger
rotation and tighter blast-radius control.

## Replay And Dedupe

The bridge must treat replay as a first-class concern.

### Checkpoint model

Persist a checkpoint per credential stream:

```ts
interface BridgeCheckpoint {
  readonly credentialId: string;
  readonly lastSeenSeq: number;
  readonly updatedAt: string;
}
```

### Resume flow

1. Bridge connects with credential auth.
2. Bridge presents `lastSeenSeq` when available.
3. Primary Signet replays frames with `seq > lastSeenSeq`.
4. Bridge emits only unseen frames and advances the checkpoint after durable
   local acceptance.

### Dedupe rule

Use `(credentialId, seq)` as the canonical dedupe key.

### Recovery behavior

If the primary Signet cannot satisfy replay from the requested sequence window,
it should fail loudly with a recovery-required response rather than silently
skipping ahead.

## Delivery Modes

The bridge should support multiple delivery modes over the same canonical event
source.

### `emitter`

In-process callback or event-emitter delivery.

### `sse`

Server-Sent Events stream exposed by the bridge.

### `webhook`

Signed HTTP POST delivery to configured callback targets.

### `queue`

Publish canonical bridge envelopes to a queue or event bus.

## Canonical Envelope

Bridge adapters should preserve the canonical sequencing envelope.

```ts
interface BridgeEnvelope<TEvent = unknown> {
  readonly credentialId: string;
  readonly seq: number;
  readonly occurredAt: string;
  readonly event: TEvent;
}
```
