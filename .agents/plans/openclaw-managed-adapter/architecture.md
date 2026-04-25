# OpenClaw Managed Adapter Architecture

Status: planning
Last updated: 2026-04-25

## Purpose

This document captures the architecture for making XMTP usable as an OpenClaw
channel through `xmtp-signet`, without requiring upstream OpenClaw core changes.

The integration should feel substantially similar to existing OpenClaw chat
channels like Slack or Telegram, while keeping durable identity,
authorization, credential, and audit state in signet so the pattern can apply
to other harnesses later.

## Non-Goals

- Do not require OpenClaw core to add XMTP support.
- Do not patch installed OpenClaw files in place.
- Do not put raw XMTP signer material, raw signet private state, or broad
  credential secrets into OpenClaw config.
- Do not make OpenClaw the source of truth for contacts, Convos inbox churn,
  credentials, seals, or subagent delegation policy.
- Do not let agents self-increase permissions.

## Managed Projection

OpenClaw config should be a managed projection, but editable in familiar
OpenClaw channel terms.

`xs` should own generated fields and be able to diagnose drift. It should warn
or fail rather than overwrite user-authored conflicting blocks unless `--force`
is provided.

OpenClaw should see a normal channel:

```json5
{
  "channels": {
    "xmtp": {
      "enabled": true,
      "descriptor": "/path/to/openclaw-account.json",
      "dmPolicy": "allowlist",
      "allowFrom": ["@owner"],
      "groupPolicy": "allowlist",
      "groupActivation": "owner-side-channel",
      "groupAllowFrom": ["@participants"],
      "groups": {}
    }
  }
}
```

Plugin projection should include only non-sensitive adapter references:

```json5
{
  "plugins": {
    "load": {
      "paths": [
        "~/.local/share/xmtp-signet/adapters/openclaw/plugin"
      ]
    },
    "entries": {
      "xmtp": {
        "enabled": true
      }
    }
  }
}
```

Sensitive mappings live in signet-managed descriptor/state:

```json5
{
  "harness": "openclaw",
  "agents": {
    "main": {
      "operator": "op:...",
      "primaryOwner": "...",
      "defaultSessionPolicy": "policy:...",
      "subagentDelegationProfile": "policy:..."
    }
  }
}
```

## Packaging Model

Keep one user-facing binary:

```bash
xs
```

Do not require a second top-level executable for normal users.

`xs` may internally unpack or install versioned OpenClaw adapter artifacts:

```text
~/.local/share/xmtp-signet/adapters/openclaw/
  plugin/
  adapter.toml
  adapter-manifest.toml
  openclaw-account.json
  managed-state.json
  checkpoints/
```

If a helper process is eventually needed, ship it as an internal artifact of
the `xs` distribution rather than a separate user-managed binary.

## Happy Path Setup

Default command:

```bash
xs agent setup openclaw --yes
```

Expected behavior:

1. Verify signet is initialized and the daemon is reachable.
2. Create or verify signet-side OpenClaw operators and policies.
3. Install or update the OpenClaw XMTP plugin artifact.
4. Locate the OpenClaw config, or accept `--openclaw-config`.
5. Back up OpenClaw config before writing.
6. Insert/update a managed `plugins` block for the XMTP plugin.
7. Insert/update a managed `channels.xmtp` block with safe Slack-like
   defaults.
8. Create a bootstrap owner side channel if the operator has no owner route.
9. Print the Convos invite and short bootstrap code.
10. Return with status `pending owner link`, not block waiting for the user.

Useful modes:

```bash
xs agent setup openclaw --yes
xs agent setup openclaw --dry-run
xs agent setup openclaw --print-config
xs agent setup openclaw --force
xs agent setup openclaw --openclaw-config ~/.openclaw/openclaw.json
xs agent setup openclaw --yes --agent bob
xs agent setup openclaw --yes --agent bob --agent alice
xs agent setup openclaw --yes --all-agents
xs agent setup openclaw --yes --agent bob --operator op:...
```

Default `--yes` wires only the main/default OpenClaw agent. Additional
OpenClaw agents require explicit `--agent`, `--all-agents`, or explicit
operator mapping.

## Operator And Agent Mapping

OpenClaw has a default/main agent and can have additional named agents.

Signet model:

- Durable OpenClaw agent maps to a durable signet operator.
- OpenClaw session/conversation maps to an ephemeral signet credential.
- OpenClaw subagent maps to an explicit delegated credential or explicit
  separate signet operator.

Default setup:

```text
OpenClaw main/default agent -> signet operator for @agent:main
```

Selectors:

```text
@agent:main
@agent:bob
@agent:alice
```

`@agent:<name>` is a derived selector resolved through the OpenClaw adapter
descriptor. Exact signet operators use native IDs such as `op:<id>`.

Avoid `@op:<name>` in v1.

## Sessions And Credentials

Each OpenClaw XMTP session should have its own credential.

Rules:

- Parent operator identity is durable.
- Session credential is ephemeral and scoped.
- Killing a session should revoke or expire its credential.
- Revoking a credential should make that session reacquire authorization before
  continuing XMTP reads/sends.
- A parent credential defines the maximum possible delegation.
- A subagent credential defines the actual granted delegation.
- Permissions are granted, not inherited.

Subagent modes:

```text
Scoped credential delegation
  Bob remains the operator.
  Subagent receives a temporary, narrower credential.
  Best for one-off tasks in one chat/session.

Separate operator delegation
  Subagent has or maps to its own signet operator.
  Best for recurring specialists or separate audit trails.
```

Subagent default should not include send/reply unless explicitly granted.

## Contacts, Roles, And Identity

Contacts are human/principal identities managed by `xs`, not OpenClaw config.

Convos may generate a new inbox per chat, so a single person may have many
conversation-scoped bindings.

Identity binding must carry both identifier type and scope:

```text
contact Matt
  global binding:
    stable XMTP inbox, if available and explicitly trusted globally

  conversation binding:
    Convos-generated inbox in conv_abc
    Convos-generated inbox in conv_def
```

Default identity attestation should use the narrowest safe binding. Global
binding is an explicit promotion.

Useful concepts:

```text
contact
  human-facing identity, e.g. Matt

link
  this inbox/user id belongs to this contact
  scoped globally or to a conversation

route
  a trusted way to ask this contact for approval/attestation
  e.g. owner side chat, Slack DM, local CLI

role
  owner/admin role in an operator/domain context
```

Friendly CLI surface should be `contacts`, not `identity authority`.

Possible commands:

```bash
xs contacts add matt
xs contacts add matt --group patch-maintainers --phone +15551234567
xs contacts list
xs contacts info matt
xs contacts attest matt --chat chat:...
xs contacts link matt --chat chat:... --inbox inbox:...
xs contacts group create patch-maintainers
xs contacts group add patch-maintainers @contact:matt
xs contacts group add patch-maintainers op:...
```

Exact command shapes should align with current `xs` grammar, which uses verbs
such as `create`, `list`, `info`, `update`, `rm`, and nested commands such as
`chat member add`.

## Owner Bootstrap

Default setup should create an operator-scoped owner route.

Flow:

1. `xs agent setup openclaw --yes` creates or verifies the operator.
2. It creates a bootstrap XMTP/Convos chat.
3. It generates a short code.
4. It prints the Convos invite and code.
5. It returns `pending owner link`.
6. User joins the chat and sends the code.
7. Signet observes the code, links the sender, and marks `@owner` ready.

The bootstrap chat remains as the durable owner side channel for that operator.

It can later be used for:

- setup status
- identity attestation
- group creation
- group activation
- future approval requests, if explicitly enabled

It should not automatically be an unlimited admin shell.

Default generated config should use owner only:

```json5
{
  "dmPolicy": "allowlist",
  "allowFrom": ["@owner"]
}
```

Do not include `@admin` in generated defaults.

## Selector Grammar

Use `@` for derived, adapter/signet-resolved selectors.

Use signet-native prefixes without `@` for exact identifiers.

Derived selectors:

```text
@agent:<name>
@channel:current
@channel:*
@contact:<name>
@group:<name>
@owner
@owner:*
@admin
@admin:*
@participants
@agents
@contacts
@operators
```

Exact signet-native identifiers:

```text
op:<id>
chat:<id>
inbox:<id>
cred:<id>
policy:<id>
```

Recommended v1 defaults:

```json5
{
  "allowFrom": ["@owner"],
  "groupAllowFrom": ["@participants"]
}
```

`@channel:*` must not mean all chats known to the signet daemon. If supported,
it should mean all chats in the current operator domain, and likely only in
specific capability contexts such as search/read-history.

## Access Control

Contacts can participate in channel access control, but they do not grant agent
permission escalation.

Allowed:

```text
Is this sender allowed to invoke Bob?
```

Not allowed:

```text
Can this sender increase Bob's policy/credential scopes?
```

OpenClaw-facing knobs should be substantially similar to other channels:

```text
dmPolicy
allowFrom
groupPolicy
groupAllowFrom
groups.<chat>.allowFrom
groups.<chat>.requireMention
```

Principal selectors can appear inside allowlists:

```json5
{
  "allowFrom": ["@owner", "@contact:matt", "inbox:..."],
  "groupAllowFrom": ["@participants", "@group:patch-maintainers"]
}
```

Use `@participants` by default to avoid agent-to-agent loops.

## Group Creation And Activation

The clean happy path should be agent/signet-initiated group creation through
the owner side channel.

Flow:

```text
Owner side channel:
  "Create a group called Project X"

Signet:
  creates the XMTP/Convos group
  records it in the operator domain
  applies default group policy
  returns invite link/QR

Owner:
  shares invite with humans

Group:
  current non-agent participants can invoke the agent
```

Default:

```json5
{
  "groupPolicy": "allowlist",
  "groupActivation": "owner-side-channel",
  "groupAllowFrom": ["@participants"],
  "groups": {}
}
```

For groups created through the trusted owner side channel, default invocation
should be always-on for eligible user messages, because Convos does not
currently provide a reliable mention mechanism.

External group invites should be supported later, but not be the primary happy
path. The safe default is pending/ignored/ask-owner rather than immediate
activation.

## Events And Session Ingestion

Do not treat every raw XMTP envelope as an OpenClaw activation event.

Signet should normalize raw XMTP into channel events:

```text
message.created
reaction.created
member.joined
member.left
profile.updated
seal.published
credential.revoked
system.notice
```

Each event class has separate decisions:

```text
visible
  may the harness see the event?

activate
  should this event invoke the agent/reply loop?

ingestSession
  should this event enter OpenClaw session context automatically?

searchable
  may an agent retrieve it later if credential scopes allow?
```

V1 defaults:

```text
message.created
  visible: yes
  activate: according to channel activation
  ingestSession: yes

reaction.created
member.joined
member.left
profile.updated
  visible: no by default
  activate: no
  ingestSession: no
  available through signet history only if permissioned

seal.*
credential.*
system/internal
  audit/status only
  activate: no
  ingestSession: no
```

Owner side channel "always on" means always respond to eligible user-facing
messages from `@owner`. It must not mean every raw XMTP content type can
trigger OpenClaw.

## Search And History

Within a defined OpenClaw agent/operator domain, broad search can be allowed.
This should not imply the agent can confuse live session context across chats.

Recommended model:

```text
Bob durable operator domain:
  searchable chats: chat A, chat B, chat C

Bob session in chat B:
  live context: chat B
  session credential: scoped to chat B
  optional search permission: Bob's operator domain, if policy allows
```

## Runtime Adapter Responsibilities

The OpenClaw XMTP plugin/adapter should:

- read the OpenClaw channel projection
- read the signet adapter descriptor
- connect to signet runtime APIs
- normalize inbound signet events into OpenClaw channel events
- ask signet to resolve selectors/principals
- ask signet whether a sender may invoke the agent
- request/refresh session credentials
- send/reply/react through signet credentials
- revoke/expire credentials when sessions end
- request delegated subagent credentials when needed
- report status/doctor diagnostics in OpenClaw terms

The adapter should not:

- read raw XMTP private keys
- store raw credentials in OpenClaw config
- implement its own durable identity database
- grant permission expansion to itself
- treat raw XMTP internal events as activation events

## Status And Doctor

`xs agent status openclaw` should report:

- adapter installed/configured
- OpenClaw plugin path present
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

OpenClaw `channels status --probe` should show XMTP in familiar channel terms.
