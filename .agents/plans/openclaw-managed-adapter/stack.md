# OpenClaw Managed Adapter Stack

Status: planning
Last updated: 2026-04-25
Parent issue: #375

## Goal

Build the managed OpenClaw adapter in a natural stacked sequence. The first
stack should get to a diagnosable setup flow. The second stack should get to a
working read-only channel. Later stacks add outbound actions, contacts, and
delegation.

## Stack Invariants

- One branch per issue where possible.
- Keep `xs init` signet-native; OpenClaw-specific setup lives under
  `xs agent setup openclaw`.
- Prefer dry-run and status/doctor surfaces before writes.
- Never place raw keys, raw signet private state, or broad credential secrets
  into OpenClaw config.
- Generated OpenClaw config is a projection. Signet remains source of truth.
- Every runtime slice must have at least one status or doctor hook so partial
  setup is explainable.

## Execution Order

| Order | Issue | Slice | PR title |
|---:|---:|---|---|
| 0 | #375 | Plan packet | `docs(openclaw): add managed adapter execution plan` |
| 1 | #376 | Plugin artifact install | `feat(adapter): install OpenClaw plugin artifacts from xs` |
| 2 | #377 | Managed config projection | `feat(cli): write managed OpenClaw channel config` |
| 3 | #378 | Descriptor schemas/state | `feat(schemas): define OpenClaw adapter descriptor state` |
| 4 | #379 | Owner bootstrap | `feat(adapter): add OpenClaw owner bootstrap flow` |
| 5 | #380 | Selector resolution | `feat(policy): resolve OpenClaw adapter selectors` |
| 6 | #381 | Contacts primitives | `feat(contacts): model scoped contact links and groups` |
| 7 | #382 | Session credentials | `feat(adapter): issue OpenClaw session-scoped credentials` |
| 8 | #384 | Normalized events | `feat(adapter): normalize signet events for OpenClaw` |
| 9 | #386 | Outbound actions | `feat(openclaw): send through signet credentials` |
| 10 | #383 | Delegation | `feat(openclaw): delegate subagent credentials explicitly` |
| 11 | #385 | Group creation | `feat(openclaw): create groups through owner side channel` |
| 12 | #387 | Full status/doctor | `feat(cli): expand OpenClaw adapter status and doctor` |
| 13 | #388 | Docs and smoke | `docs(openclaw): document managed setup and smoke flow` |

## Phase 1: Setup Stack

Purpose: make `xs agent setup openclaw --yes` safe, repeatable, and
diagnosable, even before real message delivery is complete.

Includes:

- OpenClaw config backup/merge/write
- plugin artifact install under XDG data paths
- descriptor and managed-state schemas
- main/default agent to operator mapping
- default policies
- owner bootstrap side channel with pending status

Exit criteria:

- `xs agent setup openclaw --dry-run` explains intended changes.
- `xs agent setup openclaw --print-config` prints the projected OpenClaw
  config blocks.
- `xs agent setup openclaw --yes` writes adapter artifacts and safe config
  defaults.
- Setup returns `pending owner link` when no owner route is linked.
- `xs agent status openclaw` reports pending/ready state.
- `xs agent doctor openclaw` catches missing plugin/config/daemon/descriptor
  basics.

## Phase 2: Channel Works Stack

Purpose: make OpenClaw receive normalized XMTP messages through signet without
raw XMTP custody.

Includes:

- selector resolution for `@owner`, `@participants`, `@agent:<name>`,
  `@contact:<name>`, `@group:<name>`, and exact signet IDs
- scoped contacts and conversation-specific links
- session-scoped credentials
- normalized channel events
- read-only inbound bridge

Exit criteria:

- A linked owner can invoke the default OpenClaw XMTP channel.
- A read-only inbound tracer bullet can route `message.created` into the
  OpenClaw session shape.
- Reaction/member/profile/seal/credential events are non-activating by default.
- Session credential revocation forces reacquire before continued reads/sends.

## Phase 3: Outbound And Delegation Stack

Purpose: allow OpenClaw agents to send/reply/react and delegate to subagents
through explicit signet credentials.

Includes:

- outbound send/reply/react through signet credentialed ingress
- scoped credential delegation
- separate-operator delegation for recurring specialists
- owner-side-channel group creation and activation

Exit criteria:

- OpenClaw outbound actions do not require raw XMTP keys or direct SDK access.
- Subagent default does not include send/reply unless explicitly granted.
- Group creation through owner side channel records operator-domain policy and
  returns invite material.

## Verification Checkpoints

After phase 1:

- targeted adapter/CLI tests
- `bun run typecheck`
- `bun run lint`
- `bun run docs:check`
- manual dry-run against a temp OpenClaw config fixture

After phase 2:

- inbound read-only tracer bullet
- session credential revocation/reacquire test
- selector ambiguity tests
- top-branch `bun run check`

After phase 3:

- outbound send/reply/react tests
- delegation narrowing tests
- owner-side-channel group creation smoke
- top-branch `bun run check`

## Guardrails

- Do not use `@channel:*` in generated defaults.
- Do not include `@admin` in generated defaults.
- Do not make owner side channel an unlimited admin shell.
- Do not treat every raw XMTP envelope as an activation event.
- Do not silently overwrite unmanaged OpenClaw config conflicts without
  `--force`.
- Do not expose raw operator IDs, credential IDs, policy IDs, contact bindings,
  or bootstrap state in OpenClaw config unless explicitly requested.
