---
name: xmtp
description: >
  Use the xmtp-signet to connect an agent to XMTP conversations through the v1
  credential model. Covers the signet runtime, the
  owner/admin/operator/credential/seal hierarchy, the `xs` CLI surface for
  daily operation (status, chat, msg, inbox, search, lookup, consent, seal
  inspection, credential inspection, policy inspection), and how harnesses
  connect over WebSocket or MCP without direct XMTP access. Use this skill
  whenever someone asks what the signet is, how to run an agent on top of it,
  how to send or read messages through it, how to join or host Convos
  conversations, how to inspect seals or credentials, how reveals work,
  how trust is surfaced, or how a harness should stream and respond to XMTP
  traffic through the signet. For
  orchestrator-side setup — bootstrapping the daemon, creating operators,
  issuing credentials, managing keys and wallets — use the `xmtp-admin`
  skill.
---

# Using xmtp-signet

> [!NOTE]
> The current local stack is on the v1 runtime model: owner, admin,
> operator, credential, seal. The public CLI and transport surfaces are
> credential-native. Don't reintroduce `session` / `view` / `grant`
> terminology.

The signet is the trusted runtime that owns the real XMTP client, local
encrypted state, and the transport surfaces that agents talk to. It exists so
agents can participate in XMTP conversations **without** being handed raw
signer material, raw database access, or direct SDK control — which would
make any "read-only" or "limited" permissions advisory at best.

**Companion skill:** for orchestrator-side setup (initializing the daemon,
creating operators, issuing and revoking credentials, managing keys and
wallets, defining policies), use the `xmtp-admin` skill. This skill covers
the day-to-day *use* of an already-configured signet.

## First check: is `xs` available?

Before using this skill, check whether `xs` is already available:

```bash
if command -v xs >/dev/null 2>&1; then
  xs --help >/dev/null
else
  echo "xs is not installed yet"
fi
```

If `xs` is not installed yet:

- **fastest for agents** — fetch the prebuilt binary (macOS arm64, Linux x64,
  Linux arm64). No `bun` or `git` required on the machine:
  `curl -fsSL https://xmtp.fyi/install.sh | bash`
- source install (clone + `bun run bootstrap`):
  `curl -fsSL https://xmtp.fyi/install.sh | bash -s -- --source`
- repo-backed fallback:
  `curl -fsSL https://raw.githubusercontent.com/galligan/xmtp-signet/main/scripts/install.sh | bash`
- if you already have a local clone, use the repo entrypoint directly:
  `bun packages/cli/src/bin.ts --help`

`xs --version` reports the version, short commit, and build timestamp for
binary installs; source installs show `dev (dev)`.

Then hand off to `xmtp-admin` for `xs init`, daemon startup, operator setup,
credential issuance, and adapter provisioning.

## OpenClaw adapter

If the harness is OpenClaw, make that visible early instead of treating it like
an implementation detail.

- OpenClaw setup is a signet adapter flow, not a direct XMTP SDK flow.
- The happy-path provisioning command is `xs agent setup openclaw`.
- The provisioning side still belongs to the `xmtp-admin` skill.
- `xs agent status openclaw` is a follow-up verification command, not a
  required setup step.
- `xs agent doctor openclaw` is the repair/diagnostic path when setup or wiring
  looks wrong.
- Once the adapter is provisioned, the agent still operates through the normal
  signet model described in this skill.

For the short operator handoff, see
`references/openclaw-adapter.md`. For the full bootstrap guide, see
`docs/agent-setup/openclaw.md`.

## Convos interop

Convos is the human-facing XMTP app and onboarding scheme, not a harness
adapter. Do not look for or invent `xs agent setup convos`. The agent still
connects through the normal signet transport or harness adapter (WebSocket,
MCP, OpenClaw, etc.); Convos interop happens by joining or creating an XMTP
chat with the Convos-shaped `xs chat` flows, then issuing a credential scoped
to that `conv_...`.

The usual layering is:

1. The orchestrator bootstraps the signet, daemon, operator, and harness
   adapter. Use `xmtp-admin` for these privileged setup steps.
2. The signet joins or hosts a Convos-compatible chat through `xs chat`.
3. The orchestrator issues the agent a credential for the resulting `conv_...`.
4. The agent sends, reads, replies, and reacts through signet using that
   credential; the human participant sees the same group in Convos.

### Join a Convos-created chat

Use this when a human already has a Convos conversation and wants to invite the
agent into it.

```bash
# Privileged setup: use xmtp-admin for the exact policy and operator choices.
xs init --env production --label owner
xs daemon start
xs operator create --label support-agent --scope per-chat

# Human provides a Convos invite URL, usually popup.convos.org/v2?i=...
xs chat join "<convos-invite-url>" \
  --as support-agent \
  --profile-name "Support Agent"

xs chat list
xs cred issue \
  --op op_... \
  --chat conv_... \
  --allow send,reply,react,read-messages,stream-messages
```

After the credential is issued, the harness connects with that credential over
the normal signet transport. For OpenClaw, provision the adapter separately:

```bash
xs agent setup openclaw
xs agent status openclaw
```

### Host a chat for a Convos user

Use this when the agent or orchestrator should create the group and hand a
Convos-compatible invite to the human.

```bash
xs init --env production --label owner
xs daemon start
xs operator create --label host-agent --scope per-chat

xs chat create \
  --name "Agent Room" \
  --invite \
  --profile-name "Host Agent" \
  --format both

# Human opens the link or scans the QR code shown by the command.

xs chat list
xs cred issue \
  --op op_... \
  --chat conv_... \
  --allow send,reply,react,read-messages,stream-messages
```

Use `xs chat invite conv_... --format both` to regenerate the Convos-compatible
invite output for an existing chat.

### Useful checks

```bash
xs status --json
xs chat info conv_...
xs chat member list conv_...
xs msg send "hello from the agent" --to conv_...
xs msg list --from conv_... --dangerously-allow-message-read
```

If the agent can send but cannot see inbound messages, inspect the credential
with `xs cred info cred_...`, confirm the chat is in scope, and verify the
effective scopes/content-type allowlist. The `xs msg list` check is an
admin-side diagnostic, so it needs the explicit message-read elevation flag; a
harness using a credential should read through the normal credential-scoped
transport instead. If the human never appears in the group, check
`xs chat member list conv_...` first; that is a Convos/XMTP join issue, not a
harness adapter issue.

## Mental model

```text
Owner -> Admin -> Operator -> Credential -> Seal
```

- **Owner** — the human trust anchor. Bootstraps the signet and approves
  privileged operations. Holds the only path to elevated message access
  through a biometric gate.
- **Admin** — the management plane. Creates operators, issues credentials,
  manages day-to-day state. Cannot read operator messages without explicit
  owner-approved elevation.
- **Operator** — a purpose-built agent profile. Operators do the actual
  conversational work. They can be `per-chat` (isolated state per
  conversation, default) or `shared` (one context across multiple chats).
- **Credential** — a time-bound authorization issued to an operator for one
  or more chats. Binds operator + chat scope + effective permission set
  (policy + inline overrides, deny wins) + content-type allowlist + issuance
  and expiry + status (`pending`, `active`, `expired`, `revoked`).
- **Seal** — a signed, group-visible declaration of an operator's active
  scope in a chat. Seals chain to predecessors with inline diffs and are
  published as `xmtp.org/agentSeal:1.0` messages so other participants can
  inspect what an agent is allowed to do.

### Permission scopes

30 scopes across 6 categories: `messaging`, `group-management`, `metadata`,
`access`, `observation`, `egress`. Policies bundle reusable allow/deny sets;
credentials can override inline. Deny always wins.

### Resource IDs

Canonical local IDs use a prefix plus 16 lowercase hex characters:

- `op_<16hex>`, `conv_<16hex>`, `policy_<16hex>`, `cred_<16hex>`,
  `seal_<16hex>`, `msg_<16hex>`, `xmtp_<16hex>`

Short IDs are accepted where they resolve uniquely.

## The `xs` CLI

`xs` is the single binary. Top-level commands are small; most surface lives
in groups.

```text
Top-level:  init  status  reset  logs  lookup  search  consent
Groups:     daemon  operator  cred  inbox  chat  msg  policy  seal  wallet  key  agent
```

`xs init`, `key`, `wallet`, `operator create`, `cred issue`, `cred revoke`,
`policy create`, `inbox create|link|unlink`, and `seal verify|history` are
orchestrator ops — see the `xmtp-admin` skill.

### Daemon and status

```bash
xs daemon start           # boot the daemon
xs daemon status
xs status --json          # onboarding scheme, identity mode, network, inboxes
xs logs
xs reset                  # wipe local state (destructive; orchestrator-only)
```

### Chat

Everything chat-shaped (conversations, invites, members, profiles) lives
under `xs chat`.

```bash
# Create / list / inspect
xs chat create --name "Team Room" --invite --profile-name "Owner" --format both
xs chat list
xs chat info conv_9e2d1a4b8c3f7e60
xs chat update conv_... --name "Renamed"
xs chat sync conv_...

# Join flow
xs chat join "<invite-url>" --as "alice-joined" --profile-name "Alice"
xs chat invite conv_... --format link   # regenerate invite output
xs chat update-profile conv_... --profile-name "Alice"

# Exit
xs chat leave conv_...
xs chat rm conv_...                     # local state cleanup, not network remove

# Members
xs chat member list conv_...
xs chat member add conv_... <inbox-id-or-address>
xs chat member rm conv_... <inbox-id>
xs chat member promote conv_... <inbox-id>
xs chat member demote conv_... <inbox-id>
```

The current onboarding UX is Convos-shaped; profile updates and invites use
Convos content types even though the runtime has an internal scheme seam.

When a flag or subcommand here isn't enough, `xs <group> --help` and
`xs <group> <command> --help` are authoritative.

### Messages

```bash
xs msg send  "hello"  --to conv_...     [--as inbox_...] [--op op_...]
xs msg reply "ack"    --chat conv_... --to msg_...   [--as inbox_...]
xs msg react "👍"     --chat conv_... --to msg_...   [--as inbox_...]
xs msg read           --chat conv_...                [--as inbox_...]
xs msg list           --from conv_...
xs msg info  msg_...  --chat conv_...
```

Message text / emoji is a positional argument. `--as` selects the inbox
to act as (inbox ID or label); `--op` on `send` is the operator override.
The daemon resolves the operator's active credential and enforces scope
+ content-type + confirmation checks before the message ever hits the
network.

### Inbox

Managed inboxes are the daemon-backed surface for operator mailboxes.
Inspection is safe here; `create|link|unlink` are admin ops.

```bash
xs inbox list
xs inbox info inbox_...
```

### Operator

```bash
xs operator list
xs operator info op_...
```

Creation, rename, and removal are admin ops.

### Credential

`cred` is the canonical credential lifecycle surface. Agents interact with
their own credentials for inspection; issuing and revoking belong to the
orchestrator.

```bash
xs cred list
xs cred list --op op_...
xs cred info cred_...
```

A credential's `info` output includes the operator, chat scope, effective
scopes (after policy merge + deny-wins), content-type allowlist, issuance
and expiry, and current status.

### Seal

Seals are public. Anyone participating in a chat can inspect what an agent
is currently allowed to do.

```bash
xs seal list --chat conv_...
xs seal info seal_...
```

`seal verify` and `seal history` are orchestrator-side flows (signature and
chain validation) — covered in `xmtp-admin`.

### Policy

```bash
xs policy list
xs policy info policy_...
```

Create / update / delete are admin-only.

### Lookup and search

```bash
xs lookup op_alice           # resolve any short ID or label
xs search "support escalation"
xs search "refund" --type messages --chat conv_... --as alice-bot
```

`search` targets: `messages`, `resources`, `operator`, `policy`,
`credential`, `conversation`.

### Consent

```bash
xs consent check inbox_...
xs consent allow inbox_...
xs consent deny  inbox_...
```

### Message-read elevation

Some flows need a short-lived, chat-scoped **local admin read elevation**.
Ordinary admin auth is not ambient message access.

```bash
xs search "incident" --type messages --dangerously-allow-message-read
xs msg list --from conv_... --dangerously-allow-message-read
```

The flag is intentionally noisy. It requests (or reuses) a narrow
elevation rather than treating ordinary admin auth as ambient message
access. Use it only when you genuinely need to read raw message content
as an operator with the scope.

## Connecting a harness

The signet exposes WebSocket (primary), MCP (scoped tool surface), and
CLI-admin surfaces. Harnesses never talk to the XMTP SDK directly.

### WebSocket lifecycle

```text
1. Connect to ws://host:port/v1/agent
2. Send auth frame with credential token + optional lastSeenSeq
3. Receive `authenticated` frame with connection ID, credential, effective scopes
4. Receive projected events as sequenced frames (monotonic seq)
5. Send requests (send_message, send_reaction, send_reply, reveal_content, ...)
6. On disconnect: reconnect with lastSeenSeq for replay from circular buffer
```

Authenticated response shape:

```text
{ type: "authenticated",
  connectionId: "conn_...",
  credential: { id: "cred_...", operatorId: "op_...", expiresAt: "..." },
  effectiveScopes: { allow: [...], deny: [...] },
  resumedFromSeq: null | number }
```

### Reconnection

Pass `lastSeenSeq` in the auth frame. The signet replays missed events from
a per-credential circular buffer. Replayed messages are tagged as
`historical` so the harness knows they're catch-up context, not fresh
triggers. A `signet.recovery.complete` event signals the end of catch-up.

## Event and request model

### 11 events the harness receives

| Event                                   | When                                            |
| --------------------------------------- | ----------------------------------------------- |
| `message.visible`                       | A projected message passes the pipeline         |
| `message.revealed`                      | Previously hidden content becomes visible       |
| `seal.stamped`                          | A seal is created or updated                    |
| `credential.issued`                     | A new credential is issued                     |
| `credential.expired`                    | The active credential has expired              |
| `credential.reauthorization_required`   | Scope expansion requires fresh auth            |
| `scopes.updated`                        | Permission scopes changed                      |
| `agent.revoked`                         | The agent is revoked from a group              |
| `action.confirmation_required`          | An action needs owner confirmation             |
| `heartbeat`                             | Liveness signal                                |
| `signet.recovery.complete`              | Catch-up after downtime finished               |

### 7 requests the harness can send

`send_message`, `send_reaction`, `send_reply`, `update_scopes`,
`reveal_content`, `confirm_action`, `heartbeat`.

## Receiving messages

Inbound XMTP data passes through a four-stage projection pipeline before
reaching the harness:

```text
Stage 1: Scope filter     — is the chat in the credential's scope?
Stage 2: Content type     — is the content type in the effective allowlist?
Stage 3: Visibility       — visible / revealed / historical / hidden?
Stage 4: Content project  — pass through or redact to null
```

Five internal visibility states: `visible`, `historical`, `revealed`,
`redacted`, `hidden`. The harness only sees the first four — `hidden`
stays internal to the daemon.

### Content-type allowlists

The effective allowlist is a two-tier intersection:

1. **Baseline** — five XIP-accepted types (text, reaction, reply,
   readReceipt, groupUpdated)
2. **Signet-level** — operator can expand or restrict

A per-credential tier is planned but not yet in the `CredentialConfig`
schema. Default-deny: unknown content types never reach the agent.

## Sending actions

Outbound actions are requests. Before the network sees them:

1. **Scope check** — is the chat in the credential scope?
2. **Permission check** — is the action allowed in the effective scope set?
3. **Confirmation check** — if required, an `action.confirmation_required`
   event is emitted and the action is held until confirmed
4. **Seal binding** — the message is stamped with a cryptographic binding
   to the current seal
5. **Network delivery** — encrypted with MLS and sent

If scope is not allowed, the request fails with a typed `permission` error.

## Reveals

Reveals are the explicit mechanism for surfacing content that would
otherwise stay hidden. Reveal state is credential-scoped, not ambient.

| Scope          | Target                  | Behavior                            |
| -------------- | ----------------------- | ----------------------------------- |
| `message`      | Specific message ID     | Reveals only that message           |
| `thread`       | Thread ID               | Reveals all messages in a thread    |
| `sender`       | Sender inbox ID         | Reveals all from that sender        |
| `content-type` | Content type            | Reveals all of that type            |
| `time-window`  | Start/end timestamps    | Reveals messages in the range       |

Reveals can expire. When previously hidden content becomes visible, the
harness receives a `message.revealed` event.

## Seal protocol (for harnesses and observers)

- **Chained** — each seal embeds its predecessor inline with a computed
  delta
- **Bound to messages** — outbound messages carry a cryptographic
  `{ messageId, sealId }` binding signed with Ed25519
- **TTL-based renewal** — 24h default, auto-renew at 75% elapsed
- **Materiality-gated** — only published when permissions actually change
- **Auto-republished** — on credential mutation, republished to all
  affected chats with exponential backoff retry
- **Revocation seals** — published when a credential is revoked,
  permanently marking the pair

XMTP content types: `xmtp.org/agentSeal:1.0`,
`xmtp.org/agentRevocation:1.0`, `xmtp.org/agentLiveness:1.0`.

Trust tiers in the seal: `source-verified` (hardware-backed root key) or
`unverified` (software vault).

## Liveness

- **Transport** — 30-second WebSocket heartbeat, 3 missed = dead
- **Group** — `xmtp.org/agentLiveness:1.0` messages so clients can render
  staleness indicators

## When to recommend direct XMTP access instead

Direct SDK or CLI access still makes sense for:

- local experiments
- simple bots that don't need strict scope enforcement
- one-off tooling owned by the same person who owns the account

For multi-agent, sensitive, or inspectable chat participation, recommend
the signet.

## When in doubt

`xs --help`, `xs <group> --help`, and `xs <group> <command> --help` are
the authoritative surface. If a flag or subcommand here looks stale, the
help output wins.
