---
name: xmtp-signet-use
description: >
  Understand and use the xmtp-signet to connect agents to XMTP conversations
  through the current v1 credential model. Covers the signet runtime, the
  owner/admin/operator/credential/seal hierarchy, permission scopes, reveals,
  and how harnesses connect through WebSocket or MCP without direct XMTP
  access. Use this skill whenever someone asks what the signet is, how to
  scope an agent's permissions, how to connect an agent through the signet,
  what seals communicate, how trust and verification work, how to deploy a
  signet, or how an agent should participate in XMTP conversations through the
  signet.
---

# Using xmtp-signet

> [!NOTE]
> The current local stack implements the v1 operator/policy/credential/seal
> model. The public CLI and transport surfaces are credential-native.

> [!IMPORTANT]
> This is a legacy compatibility skill. The canonical end-user skills now live
> under `.plugins/xmtp-signet/skills/xmtp` and
> `.plugins/xmtp-signet/skills/xmtp-admin`; keep this file aligned with those
> newer surfaces.

The signet is the primary way to connect agents to XMTP without handing the
agent raw signer material, database access, or direct SDK control.

## Why this exists

If an agent holds the raw XMTP client and keys, any "read-only" or "limited"
permissions are advisory. The agent can ignore them because it already has the
authority to do everything the client can do.

The signet makes those boundaries structural:

- the signet owns the XMTP runtime
- the harness authenticates with a scoped credential
- projected events and allowed actions are enforced below the harness
- seals make the operator's behavior inspectable to chat participants

## The model

### Signet

The trusted runtime that owns the real XMTP client, local encrypted state, and
transport surfaces.

### Owner

The human trust anchor. The owner bootstraps the signet and approves privileged
operations. Critically, the owner holds the only path to elevated message
access through a biometric gate.

### Admin

The management plane. Admins create operators, issue credentials, and manage
day-to-day signet state. Admins cannot read operator messages without explicit
owner-approved elevation.

### Operator

A purpose-built agent profile. Operators do the actual conversational work.

Operators can be:

- **per-chat** for isolated inbox state per conversation (default)
- **shared** for one context spanning multiple conversations

Operators have role levels:

- **operator** — can only act within its own credentials
- **admin** — can manage operators and resources it created
- **superadmin** — can manage anything, but still cannot read messages without
  owner-approved elevation

### Policy

A reusable allow/deny bundle of permission scopes (30 scopes across 6
categories: messaging, group-management, metadata, access, observation,
egress).

### Credential

A time-bound authorization issued to an operator for one or more chats.

A credential binds:

- the operator
- the allowed chat scope
- the effective permission set (policy + inline overrides, deny wins)
- a content type allowlist
- issuance and expiry
- current status (`pending`, `active`, `expired`, `revoked`)

### Seal

A signed, group-visible declaration of the operator's active scope and
permissions in a chat. Seals chain to previous seals with inline diffs and
are published as `xmtp.org/agentSeal:1.0` content type messages.

## Connecting a harness

The signet supports WebSocket, MCP, and CLI-admin surfaces.

### WebSocket lifecycle

```text
1. Connect to ws://host:port/v1/agent
2. Send auth frame with credential token + optional lastSeenSeq
3. Receive authenticated frame with connection ID, credential, effective scopes
4. Receive projected events as sequenced frames (monotonic seq numbers)
5. Send requests (send_message, send_reaction, send_reply, reveal_content, etc.)
6. On disconnect: reconnect with lastSeenSeq for replay from circular buffer
```

The harness never talks directly to the XMTP SDK.

### Reconnection

Pass `lastSeenSeq` in the auth frame. The signet replays missed events from a
per-credential circular buffer. Replayed messages are tagged as `historical`
so the harness knows they are catch-up context, not fresh action triggers. A
`signet.recovery.complete` event signals catch-up is finished.

### Authentication response

```text
{
  "type": "authenticated",
  "connectionId": "conn_...",
  "credential": { "id": "cred_...", "operatorId": "op_...", "expiresAt": "..." },
  "effectiveScopes": { "allow": [...], "deny": [...] },
  "resumedFromSeq": null | number
}
```

## Event model

The signet emits 11 event types to harnesses:

| Event | When |
|-------|------|
| `message.visible` | A projected message passes the pipeline |
| `message.revealed` | Previously hidden content becomes visible |
| `seal.stamped` | A seal is created or updated |
| `credential.issued` | A new credential is issued |
| `credential.expired` | The active credential has expired |
| `credential.reauthorization_required` | Scope expansion requires fresh auth |
| `scopes.updated` | Permission scopes changed |
| `agent.revoked` | The agent is revoked from a group |
| `action.confirmation_required` | An action needs owner confirmation |
| `heartbeat` | Liveness signal |
| `signet.recovery.complete` | Catch-up after downtime finished |

Harnesses can send 7 request types: `send_message`, `send_reaction`,
`send_reply`, `update_scopes`, `reveal_content`, `confirm_action`,
`heartbeat`.

## Receiving messages

Inbound XMTP data passes through a four-stage projection pipeline:

```text
Stage 1: Scope filter     — is the chat in the credential's scope?
Stage 2: Content type     — is the content type in the effective allowlist?
Stage 3: Visibility       — visible / revealed / historical / hidden?
Stage 4: Content project  — pass through or redact to null
```

Five internal visibility states: `visible`, `historical`, `revealed`,
`redacted`, `hidden`. The harness only sees the first four; `hidden` stays
internal to the daemon.

### Content type allowlists

The effective allowlist is currently a two-tier intersection:

1. **Baseline** — five XIP-accepted types (text, reaction, reply, readReceipt,
   groupUpdated)
2. **Signet-level** — operator can expand or restrict

A per-credential tier is planned but not yet in the `CredentialConfig` schema.

Default-deny: unknown content types never reach the agent.

## Sending actions

Outbound actions go through the signet as requests. Before reaching the
network:

1. **Scope check** — is the chat in the credential scope?
2. **Permission check** — is the action allowed in the effective scope set?
3. **Confirmation check** — if the credential requires it, an
   `action.confirmation_required` event is emitted to the owner and the action
   is held until confirmed
4. **Seal binding** — the message is stamped with a cryptographic binding to
   the current seal
5. **Network delivery** — encrypted with MLS and sent

If the scope is not allowed, the request fails with a typed permission error.

## Scoping an operator

When deciding how to scope an operator, think in three layers:

1. **Scope mode**
   - `per-chat` if you want strong isolation between conversations
   - `shared` if the operator needs cross-chat context
2. **Policy**
   - reusable allow/deny bundle for the operator's intended role
3. **Credential**
   - specific chat coverage, TTL, content type allowlist, and any inline
     scope overrides

Examples:

- A lightweight helper bot:
  - per-chat operator
  - allow `send`, `reply`, `react`
  - deny group-management scopes
- A research assistant:
  - shared operator
  - allow observation scopes and `forward-to-provider`
  - explicitly control `read-history`
- A summarizer that shouldn't relay to LLMs:
  - per-chat operator
  - allow `read-messages`, `stream-messages`, `send`
  - deny all egress scopes (`forward-to-provider`, `store-excerpts`,
    `use-for-memory`)

### Credential reauthorization

Not every credential change requires reconnection:

- **In-place** (no reconnect): narrowing scopes, adjusting content type
  allowlist, extending a reveal
- **Reauthorization required** (new credential, reconnect): expanding scopes,
  adding egress permissions, granting group management

The signet emits `credential.reauthorization_required` and terminates the
connection when reauth is needed.

## Reveals

Reveals are the explicit mechanism for surfacing content that would otherwise
remain hidden. Reveal state is credential scoped, not ambient.

Five reveal granularities:

| Scope | Target | Behavior |
|-------|--------|----------|
| `message` | Specific message ID | Reveals only that message |
| `thread` | Thread ID | Reveals all messages in a thread |
| `sender` | Sender inbox ID | Reveals all from that sender |
| `content-type` | Content type | Reveals all of that type |
| `time-window` | Start and end timestamps | Reveals messages in the range |

Reveals can have expiration times. When previously hidden content becomes
visible, the harness receives a `message.revealed` event.

## Seal protocol

Seals are how other participants inspect what an operator can do.

Key properties:

- **Chained** — each seal embeds its predecessor inline with a computed delta
- **Bound to messages** — outbound messages carry a cryptographic
  `{ messageId, sealId }` binding signed with Ed25519
- **TTL-based renewal** — 24-hour default, auto-renew at 75% elapsed
- **Materiality-gated** — only published when permissions actually change
- **Auto-republished** — on credential mutation, republished to all affected
  chats with exponential backoff retry
- **Revocation seals** — published when a credential is revoked, permanently
  marking the pair

XMTP content types: `xmtp.org/agentSeal:1.0`, `xmtp.org/agentRevocation:1.0`,
`xmtp.org/agentLiveness:1.0`.

## Liveness

The signet maintains liveness at two levels:

- **Transport** — 30-second WebSocket heartbeat, 3 missed = dead
- **Group** — publishes `xmtp.org/agentLiveness:1.0` messages so clients can
  render staleness indicators

## Trust and verification

The signet does not make an operator automatically trustworthy. It makes the
operator's permissions auditable and enforceable.

The verifier pipeline checks:

- source availability
- build provenance
- release signing
- seal signature validity
- seal chain integrity
- schema compliance

Trust tiers in the seal: `source-verified` (hardware-backed root key) or
`unverified` (software vault).

## CLI surfaces

The current CLI exposes the v1 model directly:

- top-level: `xs init`, `xs status`, `xs reset`, `xs logs`, `xs lookup`,
  `xs search`, `xs consent`
- groups: `xs daemon`, `xs operator`, `xs cred`, `xs inbox`, `xs chat`,
  `xs msg`, `xs policy`, `xs seal`, `xs wallet`, `xs key`, `xs agent`

For day-to-day use here, prefer `xs chat ...`, `xs msg ...`, `xs cred info`,
`xs seal list|info`, `xs lookup`, and `xs search`. Privileged setup and
management flows live with the newer `xmtp-admin` skill.

## When to recommend direct XMTP access instead

Direct SDK or CLI access can still make sense for:

- local experiments
- simple bots that do not need strict scope enforcement
- one-off tooling owned by the same person who owns the account

For multi-agent, sensitive, or inspectable chat participation, recommend the
signet instead.
