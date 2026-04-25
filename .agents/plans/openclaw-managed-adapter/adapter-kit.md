# Adapter Kit Foundation

Status: planning
Last updated: 2026-04-25
Issues: #390, #391

## Why This Exists

OpenClaw should be the first consumer of a reusable adapter foundation, not the
place where reusable harness adapter logic accumulates.

The current repo already has OpenClaw-specific setup, status, doctor, artifact,
bridge config, runtime presence, and checkpoint pieces under
`adapters/openclaw/src`. Those slices are valuable, but the next managed setup
work will add more logic that other harnesses will also need:

- adapter descriptors
- managed adapter state
- artifact install/update planning
- config projection and drift detection
- setup dry-run/apply results
- pending owner bootstrap state
- selector resolution
- normalized events
- session credential lifecycle
- status and doctor diagnostics

Hermes-style agents exert enough second-consumer pressure that this should live
in `packages/adapter-kit`.

## Research Snapshot

OpenClaw today:

- `adapters/openclaw/src/setup/index.ts` provisions operators, policies, and
  adapter artifacts.
- `adapters/openclaw/src/bridge/config.ts` resolves adapter paths, checkpoint
  paths, and runtime presence.
- `adapters/openclaw/src/status/index.ts` and
  `adapters/openclaw/src/doctor/index.ts` turn runtime inspection into
  user-facing status/doctor results.
- `packages/cli/src/agent/*` already treats adapters as process-backed
  setup/status/doctor targets.

Hermes reference pressure:

- `.reference/convos-agents/runtime-hermes/src/server.py` exposes setup,
  setup-status, complete, cancel, status, reset, and active-conversation
  controls.
- The setup flow has pending invite state, join detection, timeout cleanup, and
  later binding to an active runtime instance.
- `.reference/convos-agents/runtime-hermes/src/convos_adapter.py` normalizes
  inbound messages into an agent runner and routes outbound responses, replies,
  reactions, media, and profile side effects through its bridge.

The harness shapes differ, but the lifecycle categories are the same enough to
justify shared contracts before OpenClaw grows further.

## Package Boundary

`packages/adapter-kit` should export shared contracts and helpers only:

- `adapterDescriptor`
- `managedState`
- `artifactPlan`
- `configProjection`
- `setupPlan`
- `selectorResolution`
- `ownerBootstrap`
- `channelEvent`
- `sessionCredential`
- `adapterStatus`
- `adapterDoctor`
- `redaction`
- `fixtures`

It should avoid:

- OpenClaw channel config names
- Hermes route names
- concrete process launch or CLI dispatch
- raw XMTP SDK access
- raw key, credential, or signer custody

## Expected Consumers

OpenClaw:

- provides an OpenClaw config projection adapter for `plugins` and
  `channels.xmtp`
- provides OpenClaw descriptor fields and session naming
- translates normalized signet events into OpenClaw channel events
- renders status/doctor in OpenClaw channel language

Hermes:

- provides a runtime adapter for setup/status/control endpoints or equivalent
  local process controls
- maps pending Convos invite/setup state into shared owner bootstrap status
- maps Hermes sessions to signet session credentials
- translates normalized signet events into Hermes agent-runner input
- routes Hermes reply/reaction/profile side effects through signet credentials

## Issue Mapping

#390 creates the package and shared contracts.

#391 validates those contracts against the Hermes reference before OpenClaw
implementation details leak into the package.

OpenClaw issues #376 through #388 should consume adapter-kit primitives where
possible. If a follow-on issue discovers a primitive that is useful to both
OpenClaw and Hermes, it should either extend #390 or open a narrow adapter-kit
follow-up rather than duplicating logic in `adapters/openclaw`.
