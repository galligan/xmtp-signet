# OpenClaw Managed Adapter Issue Plan

Status: planning
Last updated: 2026-04-25

Created GitHub issues: #375 through #388. Subissues #376 through #388 are linked
under tracking issue #375.

## Tracking Issue

Issue: #375

Title:

```text
feat: make XMTP signet a batteries-included OpenClaw channel adapter
```

Body:

```markdown
## Summary

Implement XMTP for OpenClaw as a managed harness projection over signet's
operator/contact/credential model.

`xs agent setup openclaw --yes` should wire the adapter, write safe OpenClaw
channel defaults, create a pending owner side channel, and make XMTP feel like
existing OpenClaw chat channels while keeping credential, identity, contact,
and audit state in signet.

## Target Experience

```bash
xs agent setup openclaw --yes
```

The command should:

1. verify signet is initialized and the daemon is reachable
2. install or update the OpenClaw XMTP plugin artifact
3. write managed OpenClaw `plugins` and `channels.xmtp` config blocks
4. create or verify OpenClaw operators and default policies in signet
5. create an owner bootstrap side channel when no owner route exists
6. print Convos invite material plus a short bootstrap code
7. return `pending owner link` rather than blocking

## Architecture

OpenClaw should see a normal channel projection. Signet remains source of truth
for operators, credentials, policies, contacts, owner/admin roles, Convos inbox
bindings, session credentials, subagent delegation credentials, seals, and
audit/status/doctor state.

The adapter must not hold raw XMTP keys, raw signet private state, broad
credential secrets, or direct SDK control.

## Plan

See `.agents/plans/openclaw-managed-adapter/` for the design, stack, and issue
breakdown.

## Done When

- `xs agent setup openclaw --yes` produces a repeatable pending-or-ready
  managed OpenClaw XMTP setup.
- `xs agent status openclaw` and `xs agent doctor openclaw` explain setup
  health and drift.
- OpenClaw can receive normalized inbound XMTP messages through signet without
  raw XMTP custody.
- OpenClaw can send/reply/react through signet credentials.
- Subagent delegation is explicit and cannot self-expand permissions.
- Docs and smoke tests cover the no-core-change setup path.
```

## Subissues

### 1. Package and install OpenClaw plugin artifacts from `xs`

Issue: #376

Title:

```text
openclaw: package and install plugin artifacts from xs
```

Body:

```markdown
## Summary

Make the `xs` distribution install or unpack the OpenClaw XMTP plugin artifact
under the signet XDG data directory.

## Requirements

- Keep `xs` as the only user-facing binary.
- Install versioned OpenClaw adapter artifacts under
  `~/.local/share/xmtp-signet/adapters/openclaw/`.
- Include at least:
  - `plugin/`
  - `adapter.toml`
  - `adapter-manifest.toml`
  - `openclaw-account.json` placeholder or generated path
  - `managed-state.json` placeholder or generated path
  - `checkpoints/`
- Avoid relying on repo-relative `adapters/openclaw` paths at runtime from the
  compiled binary.

## Acceptance Criteria

- Binary-installed `xs agent setup openclaw --dry-run` can resolve the packaged
  adapter artifact.
- Missing/corrupt artifact state is diagnosed by `xs agent doctor openclaw`.
- No second top-level executable is required for normal users.
```

### 2. Write managed OpenClaw config projection

Issue: #377

Title:

```text
openclaw: write managed channel config projection
```

Body:

```markdown
## Summary

Teach `xs agent setup openclaw` to locate, back up, and update OpenClaw config
with managed XMTP plugin and channel blocks.

## Requirements

- Support `--dry-run`, `--print-config`, `--force`, and `--openclaw-config`.
- Back up OpenClaw config before writing.
- Insert/update a managed `plugins` block for the XMTP plugin.
- Insert/update a managed `channels.xmtp` block with safe defaults.
- Warn or fail on conflicting unmanaged blocks unless `--force` is provided.
- Keep sensitive signet mappings out of OpenClaw config.

## Acceptance Criteria

- `xs agent setup openclaw --dry-run` reports exact intended changes.
- `xs agent setup openclaw --print-config` prints projected config.
- Generated defaults use `allowFrom: ["@owner"]` and
  `groupAllowFrom: ["@participants"]`.
- Generated defaults do not include `@admin` or `@channel:*`.
```

### 3. Add signet-managed OpenClaw descriptor and state

Issue: #378

Title:

```text
openclaw: add adapter descriptor and managed state
```

Body:

```markdown
## Summary

Define the signet-owned descriptor/state files that map OpenClaw agents to
signet operators and policies without exposing sensitive IDs in OpenClaw config.

## Requirements

- Add schemas for `openclaw-account.json` and `managed-state.json`.
- Represent default/main and named OpenClaw agents.
- Store agent-to-operator mapping, primary owner reference, default session
  policy, and subagent delegation profile.
- Keep OpenClaw config as a projection, not source of truth.

## Acceptance Criteria

- Descriptor/state validation rejects malformed or unsafe records.
- `xs agent status openclaw` can read and summarize descriptor state.
- OpenClaw config references descriptor path only.
```

### 4. Implement owner bootstrap side channel

Issue: #379

Title:

```text
openclaw: implement owner bootstrap side channel
```

Body:

```markdown
## Summary

Create the default owner route for a new OpenClaw adapter setup.

## Requirements

- `xs agent setup openclaw --yes` creates or verifies the OpenClaw operator.
- If no owner route exists, create a bootstrap XMTP/Convos chat.
- Generate a short bootstrap code.
- Print the Convos invite and code.
- Return `pending owner link`.
- Observe the code, link the sender, and mark `@owner` ready.

## Acceptance Criteria

- Pending setup is visible in `xs agent status openclaw`.
- Expired/missing bootstrap code is detected by `xs agent doctor openclaw`.
- The owner side channel is not treated as an unlimited admin shell.
```

### 5. Add OpenClaw selector grammar and resolution

Issue: #380

Title:

```text
openclaw: resolve adapter principal selectors
```

Body:

```markdown
## Summary

Implement selector resolution for OpenClaw channel access control and adapter
state.

## Requirements

- Support derived selectors:
  - `@owner`
  - `@owner:*`
  - `@admin`
  - `@admin:*`
  - `@agent:<name>`
  - `@contact:<name>`
  - `@group:<name>`
  - `@participants`
  - `@agents`
- Support exact signet identifiers such as `op:<id>`, `chat:<id>`,
  `inbox:<id>`, `cred:<id>`, and `policy:<id>`.
- Reserve `@channel:*` until its scope is safely bounded.
- Error on ambiguous singleton selectors.

## Acceptance Criteria

- Generated defaults use only safe selectors.
- `@owner` errors if no primary owner or multiple primary owners exist.
- `@channel:*` is not emitted in generated defaults.
- Unsafe broad selectors produce doctor warnings in risky contexts.
```

### 6. Add contacts, links, groups, and scoped attestations

Issue: #381

Title:

```text
contacts: add scoped contact links for OpenClaw identity
```

Body:

```markdown
## Summary

Add the contact model needed for Convos-style ephemeral inbox churn and
OpenClaw channel access control.

## Requirements

- Model contacts as human/principal identities managed by `xs`.
- Model links as scoped bindings between contacts and inbox/user IDs.
- Support global and conversation-scoped bindings.
- Model contact groups.
- Support attestation routes such as owner side chat, Slack DM, or local CLI.
- Prefer friendly `xs contacts ...` command naming.

## Acceptance Criteria

- A single contact can have multiple conversation-scoped Convos inbox bindings.
- Global binding is an explicit promotion.
- Contact/group selectors can be resolved for OpenClaw allowlists.
- Command grammar aligns with existing `xs` verbs.
```

### 7. Implement session-scoped OpenClaw credentials

Issue: #382

Title:

```text
openclaw: issue session-scoped credentials
```

Body:

```markdown
## Summary

Map each OpenClaw XMTP session/conversation to its own signet credential.

## Requirements

- Parent OpenClaw operator identity remains durable.
- Session credential is ephemeral and scoped to the session/conversation.
- Killing a session revokes or expires its credential.
- Revoking a credential forces the session to reacquire authorization.
- Parent credential defines maximum possible delegation.
- Actual subagent grant is explicit and narrower.

## Acceptance Criteria

- Session credential lifecycle is covered by tests.
- Revocation prevents continued reads/sends until reacquired.
- Credentials do not grant permissions by inheritance alone.
```

### 8. Implement explicit subagent delegation

Issue: #383

Title:

```text
openclaw: implement explicit subagent delegation
```

Body:

```markdown
## Summary

Allow OpenClaw to delegate work to subagents through explicit signet
credentials or explicit separate operators.

## Requirements

- Support scoped credential delegation for one-off chat/session tasks.
- Support separate operator delegation for recurring specialists or separate
  audit trails.
- Default subagent delegation must not include send/reply unless explicitly
  granted.
- Agents must not self-increase permissions.

## Acceptance Criteria

- Delegated credential scopes are narrower than or equal to parent grant.
- Attempted permission expansion fails.
- Audit/status distinguishes scoped credential delegation from separate
  operator delegation.
```

### 9. Normalize signet events for OpenClaw channel ingestion

Issue: #384

Title:

```text
openclaw: normalize signet events for channel ingestion
```

Body:

```markdown
## Summary

Normalize raw XMTP/signet activity into OpenClaw-facing channel events with
separate visibility, activation, ingestion, and search decisions.

## Requirements

- Define normalized events such as:
  - `message.created`
  - `reaction.created`
  - `member.joined`
  - `member.left`
  - `profile.updated`
  - `seal.published`
  - `credential.revoked`
  - `system.notice`
- Do not treat every raw XMTP envelope as an OpenClaw activation event.
- Default `message.created` to visible and session-ingested when channel policy
  allows activation.
- Default reactions/membership/profile/seal/credential/system events to
  non-activating.

## Acceptance Criteria

- Event classification is covered by tests.
- Owner side channel "always on" only means eligible user-facing messages from
  `@owner`.
- Setup/control events stay in signet status/audit unless signet intentionally
  sends a normal human-facing text message.
```

### 10. Implement owner-side-channel group creation and activation

Issue: #385

Title:

```text
openclaw: create and activate groups through owner side channel
```

Body:

```markdown
## Summary

Support the clean happy path where the owner asks signet to create an
XMTP/Convos group through the trusted owner side channel.

## Requirements

- Owner side channel can request group creation.
- Signet creates the XMTP/Convos group.
- Signet records the group in the operator domain.
- Signet applies default group policy.
- Signet returns invite link/QR material.
- Groups created through the trusted owner route default to eligible
  user-message activation with `@participants`.

## Acceptance Criteria

- Generated group policy uses `groupActivation: owner-side-channel`.
- Generated group allowlist uses `@participants`.
- External group invites are pending/ignored/ask-owner by default.
```

### 11. Implement outbound send/reply/react through signet credentials

Issue: #386

Title:

```text
openclaw: send through signet credentialed ingress
```

Body:

```markdown
## Summary

Route OpenClaw outbound XMTP actions through signet credentials rather than
raw XMTP SDK access.

## Requirements

- Support send, reply, and react.
- Use session or delegated credentials.
- Preserve policy checks and audit trail.
- Do not put raw XMTP keys or raw credential secrets in OpenClaw config.

## Acceptance Criteria

- OpenClaw can send/reply/react through signet in a smoke flow.
- Missing/expired credentials fail loudly and can be reacquired.
- Outbound attempts without required scopes are denied.
```

### 12. Expand OpenClaw status and doctor

Issue: #387

Title:

```text
openclaw: expand adapter status and doctor
```

Body:

```markdown
## Summary

Make the OpenClaw adapter setup diagnosable from `xs`.

## Requirements

`xs agent status openclaw` should report:

- adapter installed/configured
- plugin path present
- OpenClaw config block present
- signet daemon reachable
- descriptor readable
- operators mapped
- owner side channel pending/active
- bootstrap invite/code while pending
- channel readiness
- credential/session health if active
- checkpoint health
- last inbound/outbound event summary

`xs agent doctor openclaw` should detect:

- missing plugin install
- disabled plugin entry
- missing `channels.xmtp`
- conflicting unmanaged config
- missing owner route
- expired bootstrap code
- unmapped OpenClaw agent
- missing signet operator
- unreachable daemon/socket/WebSocket
- credential/policy mismatch
- checkpoint directory issues
- unsafe selectors such as broad `*` in risky contexts

## Acceptance Criteria

- Common partial setup states have actionable diagnostics.
- Doctor distinguishes warnings from hard failures.
- Output includes enough context for OpenClaw `channels status --probe` to show
  XMTP in familiar channel terms.
```

### 13. Add docs and smoke tests for no-core-change setup

Issue: #388

Title:

```text
docs: add OpenClaw managed adapter setup guide and smoke tests
```

Body:

```markdown
## Summary

Document and smoke-test the no-core-change OpenClaw setup flow.

## Requirements

- Document binary install plus `xs agent setup openclaw --yes`.
- Document pending owner link, Convos invite/code, and ready state.
- Document safe defaults and how to inspect status/doctor.
- Add smoke coverage for setup/dry-run/status/doctor.
- Tie the guide back to the managed adapter plan.

## Acceptance Criteria

- A new user can follow the guide without patching OpenClaw core.
- Smoke tests cover the happy path and common partial states.
- Docs clarify that signet owns credentials, contacts, policies, and audit
  state.
```
