# OpenClaw Managed Adapter Plan

Status: planning
Last updated: 2026-04-25
Parent issue: #375

## Goal

Make XMTP usable as a batteries-included OpenClaw channel through
`xmtp-signet`, without requiring upstream OpenClaw core changes.

The target happy path is:

```bash
xs agent setup openclaw --yes
```

That command should install or wire the adapter, write safe OpenClaw channel
defaults, create a first owner bootstrap route, and leave the setup in a
diagnosable `pending owner link` or ready state.

## Design Thesis

Use OpenClaw-native shape at the edge and signet-native enforcement at the
core.

OpenClaw should see a normal chat channel with familiar channel configuration:

- `channels.xmtp.enabled`
- `channels.xmtp.descriptor`
- `dmPolicy`
- `allowFrom`
- `groupPolicy`
- `groupActivation`
- `groupAllowFrom`
- `groups`

Signet owns the durable and sensitive state:

- operators
- credentials
- policies
- contacts and contact groups
- owner/admin roles
- identity attestations
- owner side channels
- Convos ephemeral inbox bindings
- session credentials
- subagent delegation credentials
- seals
- audit, status, and doctor state

The OpenClaw adapter/plugin acts as a harness projection over signet's
canonical model. It must not become a second XMTP runtime.

## Plan Docs

- `architecture.md` - managed adapter boundary, selectors, contacts, events,
  and status/doctor model.
- `stack.md` - natural PR stack and verification checkpoints.
- `issue-plan.md` - tracking issue and subissue bodies.

## GitHub Issues

- Tracking: #375
- Setup stack: #376, #377, #378, #379
- Channel model stack: #380, #381, #382, #384
- Runtime/action stack: #383, #385, #386
- Diagnostics/docs: #387, #388

## Related Scratch Context

- `.scratch/openclaw/05-signet-native-openclaw-proposal.md`
- `.scratch/openclaw/06-openclaw-implementation-spec.md`
- `.scratch/openclaw/10-managed-adapter-design.md`

## Stack Invariants

- Keep `xs init` signet-native. OpenClaw setup layers on top through
  `xs agent setup openclaw`.
- Do not require OpenClaw core changes.
- Do not patch installed OpenClaw files in place.
- Do not put raw XMTP signer material, raw signet private state, or broad
  credential secrets into OpenClaw config.
- Do not expose raw operator IDs, credential IDs, policy IDs, contact bindings,
  or bootstrap state in OpenClaw config unless explicitly requested.
- Do not let agents self-increase permissions.
- Prefer additive, diagnosable slices. Every PR should either add a contract,
  a dry-run surface, a status/doctor check, or one clear runtime capability.
