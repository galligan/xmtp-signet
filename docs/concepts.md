# Core Concepts

This document describes the conceptual model behind xmtp-signet. For package
boundaries and handler details, see [architecture.md](architecture.md). For the
key hierarchy and threat model, see [security.md](security.md).

## Signet

The **signet** is the trusted runtime boundary that owns the real XMTP client.

It is responsible for:

- holding signer material and encrypted local state
- maintaining XMTP installation continuity
- syncing and projecting conversation state
- authenticating harnesses through credentials
- enforcing permission scopes before any harness action executes
- filtering messages through a content type allowlist
- publishing seals that disclose what an operator can do

The signet is infrastructure, not a group participant. From XMTP's point of
view, each operator inbox is the participant; the signet manages that inbox and
its MLS state behind the scenes.

## Convos MLS State

For the current local and self-hosted v1 runtime, Convos compatibility is
primarily about **stable identity reuse and persistent XMTP state**, not about
passkeys.

The signet splits that persistence into three layers:

- **identity records:** `${dataDir}/identities.db` tracks which managed
  identities exist, their inbox IDs once registered, optional group bindings,
  and labels
- **XMTP MLS/message state:** each managed identity uses a persistent XMTP
  database at `${dataDir}/db/${env}/${identityId}.db3`
- **key material:** the signer or key manager re-derives the same DB
  encryption key and XMTP identity key for a given `identityId`

This matches the storage model used by the checked-in Convos references:
runtime processes can come and go, but the durable identity and XMTP database
state survive restart.

The in-memory client registry is intentionally **not** durable. On startup, the
signet rebuilds live clients from the identity store, reopens the per-identity
XMTP databases, resynchronizes group membership, and reattaches streams.

In practical terms:

- **per-chat mode** usually means one durable identity and XMTP database per
  isolated conversation
- **shared mode** means one durable identity can participate in multiple chats
- restart continuity comes from reopening persisted identity and XMTP state,
  not from keeping a process alive forever

Explicitly deferred from this v1 model:

- split host or remote operation
- Remote-MLS or minimum-trust hosted storage
- Convos iOS passkey parity

## Roles: owner, admin, operator

The v1 hierarchy is:

```text
Owner -> Admin -> Operator -> Credential -> Seal
```

### Owner

The human trust anchor. The owner bootstraps the signet, controls the root key
boundary, and approves privileged operations. After initial setup, the owner
rarely touches the signet directly. Critically, the owner holds the only path
to elevated message access through a biometric gate.

### Admin

The management plane. Admins create operators, issue credentials, inspect
state, and handle orchestration workflows. An admin can be a person or a
primary orchestration agent. Admins have broad management permissions but
*cannot* read operator messages without explicit owner-approved elevation.

### Operator

A purpose-built agent profile. Operators do the conversational work — sending
messages, reacting, summarizing — but only within the boundaries of their
active credentials. An operator cannot escalate its own permissions.

Operators can run in one of two scope modes:

- **per-chat**: each chat gets its own isolated inbox. No cross-pollination of
  history or context between conversations. From the outside, every group sees
  a different inbox.
- **shared**: one inbox participates in multiple chats. Simpler to operate, but
  participants in different groups can see it is the same agent.

### Role levels

Operators are created with a role that determines management capabilities:

| Role | Capabilities |
|------|-------------|
| **operator** | Can only act within its own credentials. No management abilities. |
| **admin** | Can manage the operators and resources it created or was explicitly granted access to. Scoped management. |
| **superadmin** | Can manage anything across the signet. But still cannot read messages without owner-approved elevation. |

**Critical invariant**: no role — not even superadmin — grants ambient message
read access. The biometric gate is the only path to message content outside
your own credentials.

## Policy

A **policy** is a reusable permission bundle expressed as allow and deny scope
sets.

Policies answer the question: "what kinds of actions should this operator be
able to perform in principle?" A credential can reference a policy and still
apply inline overrides for a specific issuance. Deny always wins.

```bash
xs policy create --label read-only-agent --allow read-messages,stream-messages
xs policy create --label support-bot --allow send,reply,react --deny invite,manage-members
```

### Permission scopes

Permissions are expressed as individual scopes grouped into six categories.

**messaging** — Sending content

| Scope | Description |
|-------|-------------|
| `send` | Send text/markdown messages |
| `reply` | Send reply messages (threaded) |
| `react` | Add or remove reactions |
| `read-receipt` | Send read receipts |
| `attachment` | Send file attachments |

**group-management** — Member operations

| Scope | Description |
|-------|-------------|
| `add-member` | Add members to a group |
| `remove-member` | Remove members from a group |
| `promote-admin` | Promote a member to admin |
| `demote-admin` | Remove admin status |
| `update-permission` | Modify group permission policies |

**metadata** — Updating group properties

| Scope | Description |
|-------|-------------|
| `update-name` | Change group name |
| `update-description` | Change group description |
| `update-image` | Change group image URL |

**access** — Joining, leaving, inviting

| Scope | Description |
|-------|-------------|
| `invite` | Generate invite links |
| `join` | Join a conversation via invite |
| `leave` | Leave a group |
| `create-group` | Create new group conversations |
| `create-dm` | Create new DM conversations |

**observation** — Reading and streaming

| Scope | Description |
|-------|-------------|
| `read-messages` | Read messages in scoped conversations |
| `read-history` | Read message history from before credential issuance |
| `list-members` | List group members and admin roles |
| `list-conversations` | List available conversations |
| `view-permissions` | View group permission policies |
| `stream-messages` | Subscribe to real-time message streams |
| `stream-conversations` | Subscribe to new conversation events |

**egress** — Content leaving the signet boundary

| Scope | Description |
|-------|-------------|
| `forward-to-provider` | Forward content to inference providers (LLMs) |
| `store-excerpts` | Persist message excerpts outside the signet |
| `use-for-memory` | Use content for persistent agent memory |
| `quote-revealed` | Quote revealed content in messages |
| `summarize` | Summarize hidden or revealed content |

Key distinctions:

- `read-messages` vs `read-history`: an agent might stream new messages but not
  scroll back to pre-credential history. An operator added mid-conversation
  does not automatically get the backlog.
- Egress scopes control what leaves the signet boundary. An agent with
  `read-messages` but not `forward-to-provider` can see messages but cannot
  relay them to an LLM.

## Content type allowlists

Beyond permission scopes, the signet enforces a content type allowlist that
controls which XMTP message types reach the harness. This currently operates
as a two-tier intersection:

1. **Baseline types:** Five hardcoded XMTP types that have passed through the
   XIP process — `text`, `reaction`, `reply`, `readReceipt`, and
   `groupUpdated`. These are allowed by default.
2. **Signet-level configuration:** The signet operator can expand or restrict
   beyond the baseline across all operators.

The effective allowlist is the intersection of both tiers. Default-deny: if a
content type is not in the effective allowlist, it never reaches the agent.
When a new XIP content type is accepted and the baseline list updates,
existing configurations do not automatically start seeing it.

> **Future:** A third tier — per-credential content type allowlists — is
> planned but not yet implemented in the `CredentialConfig` schema.

## Credential

A **credential** is the time-bound, chat-scoped authorization issued to an
operator.

A credential binds together:

- the target operator
- the chat or chats it covers
- a policy reference plus any inline allow/deny overrides
- issuance and expiry timestamps
- status: `pending`, `active`, `expired`, or `revoked`

```bash
# Use a policy directly
xs cred issue --op alice-bot --chat conv_1 --policy read-only-agent

# Policy + inline override (deny wins)
xs cred issue --op bob-bot --chat conv_2 --policy support-bot --deny react

# Pure inline scopes
xs cred issue --op carol-bot --chat conv_3 --allow send,reply --deny invite
```

The CLI exposes the full credential lifecycle through `xs cred issue`,
`xs cred list`, `xs cred info`, and `xs cred revoke`.

### Credential reauthorization

Not every credential change requires a new connection.

**In-place updates** (no reconnection needed): narrowing scopes, adjusting
content type allowlists within the existing scope, or extending a reveal.

**Reauthorization required** (credential reissue, new connection): expanding
scopes, upgrading observation access, adding egress permissions, or granting
group management capabilities. The signet emits a
`credential.reauthorization_required` event and terminates the connection.

This prevents excessive reconnection churn while ensuring that privilege
escalation always involves a clean authorization step.

## Seal

A **seal** is the public trust surface. It is the signed declaration published
into a chat that tells other participants what an operator can do there.

### What a seal contains

- `sealId` — unique identifier
- `credentialId` — the credential this seal is bound to
- `operatorId` — the operator acting in this chat
- `chatId` — the conversation this seal covers
- `permissions` — the effective scope set (allow/deny)
- `scopeMode` — how permissions are interpreted
- `adminAccess` — optional, with expiry (disclosed when an admin has elevated
  read access; current local v1 uses `operatorId: "owner"` for that root-admin
  path)
- `issuedAt` — when the seal was created

The entire payload is wrapped in a `SealEnvelope` with an Ed25519 signature
and key fingerprint.

### Seal chaining

Seals chain: each seal references its predecessor and embeds the full previous
payload inline. This enables decentralized diffing — any client can see what
changed without an external resolver.

```text
sealId:     seal_f5g6
previous:   { full previous seal payload }
current:    { full current seal payload }
delta:      { added: [reply], removed: [], changed: [] }
```

The delta field is convenience — computable from previous + current, but saves
client work. The inline previous payload is the key design decision: XMTP
chats are self-contained, so the history must travel with the message.

### Message-seal binding

Every message sent by a signet-managed operator includes a seal reference and
cryptographic binding. The canonical representation of `{ messageId, sealId }`
is signed with the credential's Ed25519 key.

Clients can verify:

- **Valid**: signature verifies, seal is current — normal display
- **Superseded**: signature valid but seal is older — permissions changed since
  this message
- **Revoked**: signature valid but seal has been revoked
- **Missing**: no seal signature — not from a signet-managed agent

### Seal lifecycle

Seals do not carry a hard `expiresAt` timestamp. They use a TTL-based renewal
model: 24-hour default validity, automatic renewal at 75% elapsed. This avoids
seal noise while ensuring stale seals are refreshed.

**Materiality checks** prevent unnecessary seal updates. A new seal is only
published when something material changes: scopes added or removed, allow/deny
status flipped, credential or operator changed, or admin access granted or
revoked. Empty deltas and routine operations do not produce new seals.

In the current local v1 runtime, owner-approved admin reads republish the
current seal with `adminAccess` attached for the duration of the elevation and
refresh it again once the elevation expires. That disclosure is intentionally
root-admin scoped today, not tied to a separate delegated admin operator.

**Revocation seals** are a special form published when a credential is revoked.
They contain the revoked seal ID, the previous seal reference, a reason, and a
timestamp. The credential-chat pair is permanently marked as revoked.

**Automatic republish**: on any material credential mutation, the seal is
republished to every chat the credential covers. One failure does not block
others. Retries use exponential backoff.

### XMTP content types

Seals are published as structured XMTP messages using dedicated content types:

- `xmtp.org/agentSeal:1.0` — seal issuance and updates
- `xmtp.org/agentRevocation:1.0` — seal revocations
- `xmtp.org/agentLiveness:1.0` — heartbeat signals

## Projection pipeline

Harnesses never receive raw XMTP traffic. Every inbound message passes through
a four-stage projection pipeline before being emitted.

### Stage 1: Scope filter

Is the message's chat in the credential's allowed chat scope? If not — dropped.

### Stage 2: Content type filter

Is the message's content type in the effective allowlist (baseline intersection
signet intersection credential)? If not — held at the signet.

### Stage 3: Visibility resolver

- Credential has `read-messages` — **visible** (full content)
- Message was explicitly revealed — **revealed**
- Message is historical and credential has `read-history` — **historical**
  (tagged so the harness knows not to treat it as an action trigger)
- Otherwise — **hidden** (dropped)

### Stage 4: Content projector

- `visible`, `historical`, `revealed` — content passes through unchanged
- `redacted` — content becomes `null`, placeholder delivered
- `hidden` — message never emitted

Six visibility states total: `visible`, `historical`, `revealed`, `redacted`,
`hidden`, and `dropped`. The harness only ever sees the first four.

## Reveal modes

Reveals are the explicit mechanism for exposing content that would otherwise
stay hidden. Reveal state is credential-scoped — one credential's reveals do
not affect another credential's view. Reveals can have expiration times.

Five reveal granularities:

| Scope | Target | Behavior |
|-------|--------|----------|
| `message` | Specific message ID | Reveals only that message |
| `thread` | Thread ID | Reveals all messages in a thread |
| `sender` | Sender inbox ID | Reveals all messages from a specific sender |
| `content-type` | Content type | Reveals all messages of that type |
| `time-window` | Start and end timestamps | Reveals all messages within the range |

A reveal request flows through the `reveal.request` action and is stored in a
per-credential `RevealStateStore`. Expired reveals are cleaned up
automatically. The harness receives a `message.revealed` event when previously
hidden content becomes visible.

## Liveness

The signet maintains liveness signals at two levels:

**Transport level:** WebSocket heartbeat monitoring with a 30-second interval.
Three consecutive missed heartbeats mark the connection as dead.

**Group level:** The signet publishes `xmtp.org/agentLiveness:1.0` messages to
XMTP groups, containing the agent's inbox ID, timestamp, and declared
heartbeat interval. Clients can observe these signals and render staleness
indicators when the interval is exceeded.

## Admin auth vs credential auth

The signet uses two distinct authentication domains:

- **Admin auth** for management operations such as starting the daemon,
  exporting state, or auditing key integrity. Uses JWT signed with the admin
  key.
- **Credential auth** for harness traffic and operator actions over WebSocket
  and MCP. Uses credential tokens signed with the operational key.

The admin key and operational key are independently generated. Compromising one
does not compromise the other. See [security.md](security.md) for the full key
hierarchy.

## Resource IDs

Most local resources use prefixed IDs with 16 lowercase hex characters:

| Prefix | Resource |
|--------|----------|
| `op_` | Operator |
| `cred_` | Credential |
| `conv_` | Conversation |
| `policy_` | Policy |
| `seal_` | Seal |
| `msg_` | Message |
| `xmtp_` | Network-sourced ID |

The short hex portion can be resolved when unique, but the canonical form is
the prefixed full ID. Within a domain command, the prefix is optional — the
command knows the resource type. Cross-cutting commands require the prefix.

Network IDs from XMTP are stored with an `xmtp_` prefix and mapped
bidirectionally to local IDs, providing correlation protection and consistent
indexing.

## Trust model

The signet does not make an operator magically trustworthy. What it does is
make the operator's scope auditable and enforceable.

That gives other participants stronger answers to questions like:

- Which agent is acting here?
- What is it allowed to do?
- Is it isolated to this chat?
- Has its permission set changed since earlier messages?
- Is content leaving the signet boundary to an LLM provider?

That shift from opaque trust to inspectable trust is the core reason the
signet exists. See [security.md](security.md) for the threat model and key
management details.
