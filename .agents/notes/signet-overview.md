# XMTP Signet — Overview

## The Problem

There is growing interest in AI agents that participate in XMTP group chats — for coordination, summarization, memory, retrieval, automation, and tool use. XMTP offers strong identity, messaging, and group primitives that make this possible. But the current agent shape is too blunt.

A typical setup today looks like this:

- An agent harness spins up a new account or inbox.
- It stores wallet material and database encryption keys locally — often in environment variables or config files.
- It runs the XMTP client directly.
- It joins a group as a normal member.

That pattern is convenient, but it has major problems:

- The harness effectively *is* the XMTP client. Any "read-only" or "limited" tool permissions are cosmetic if the harness holds raw credentials.
- The blast radius is too large if keys, storage, logs, or tool integrations are compromised.
- There is no group-visible provenance around what an agent can actually do.
- There is no shared language for agent capability posture inside a conversation.
- You can't revoke an agent's access without removing it from the group entirely.

We need a better boundary.

## What the Signet Is

The **signet** is a trusted runtime boundary that sits between agent harnesses and the XMTP network. The signet is the real XMTP client. The agent harness never touches raw keys, raw databases, or the raw XMTP SDK.

Instead, the harness connects to the signet over a controlled interface (WebSocket, MCP, or CLI) and receives a filtered view of conversations and a scoped set of allowed actions. Permissions are enforced below the harness layer through **credentials** — time-bound, chat-scoped authorization tokens — and communicated to the group via signed, group-visible **seals**.

```
Agent Harness ──WebSocket──> Signet ──XMTP SDK──> XMTP Network
                  |                     |
              credential            vault keys
              scoped view          identity store
              scoped actions       SDK clients
```

The same model works across local, self-hosted, and managed deployments.

## What the Signet Is Not

- **Not a centralized authority.** There is no central server that all agent permissions must flow through. Anyone can run their own signet.
- **Not a modification to MLS.** XMTP v3 uses MLS for group encryption. The signet is a full MLS group member. The permission model is application-layer filtering on top of MLS, not a protocol extension.
- **Not a magic trust machine.** A signet doesn't make an agent trustworthy. It makes the system *auditable and constrainable* — which is strictly better than the current state where agents can make claims and nobody can tell what is actually behind them.
- **Not a memory firewall.** The signet can stop the flow of messages to an agent, but it can't claw back what the agent already saw during its credential window. The immediate goal is to create a better boundary for raw message access and action authority.

## Goals

**Primary:**
- Enable safe agent participation in XMTP and Convos conversations
- Make permissions meaningful by enforcing them below the harness layer
- Keep the capabilities model agnostic to the agent framework or harness
- Create group-visible provenance for agent permissions and permission changes
- Support local, self-hosted, and managed deployments

**Secondary:**
- Flexible message visibility modes, including reveal-oriented flows
- Multiple transport surfaces (WebSocket, MCP, HTTP, CLI)
- Easy self-hosting or one-click deploy
- A clear path toward standardization through future XIPs

## From Opaque Trust to Inspectable Trust

Today, nobody should trust an XMTP agent just because it exists in a chat. An agent is basically just another XMTP inbox. XMTP gives you strong cryptographic identity primitives — signatures, group-role permissions — but it doesn't tell other participants what software stack is behind that inbox, whether a signet is involved, or what capability boundary is actually being enforced.

The signet moves the system from **opaque trust** to **inspectable trust**. A signet-managed operator publishes signed, group-visible seals describing its current permissions, scope isolation, and credential chain. Messages sent through the signet reference the seal they were produced under, so if permissions change, the mismatch is visible to the group.

That still doesn't prove the operator is honest. But it gives the group something cryptographic and inspectable to verify, which is strictly better than the current state.

## Identity Model

The signet implements a five-level identity hierarchy. Each level serves a distinct role in the trust chain.

```
Owner -> Admin -> Operator -> Credential -> Seal
```

### Owner

The human trust anchor. The owner bootstraps the signet, controls the root key boundary, and approves privileged operations. After initial setup, the owner rarely touches the signet directly. Critically, the owner holds the only path to elevated message access through a biometric gate.

### Admin

The management plane. Admins create operators, issue credentials, inspect state, and handle orchestration workflows. An admin can be a person or a primary orchestration agent (e.g., "Lobster Bot"). Admins have broad management permissions but *cannot* read operator messages without explicit owner-approved elevation.

### Operator

A purpose-built agent profile. Operators do the conversational work — sending messages, reacting, summarizing — but only within the boundaries of their active credentials. An operator cannot escalate its own permissions.

Operators run in one of two scope modes:

- **per-chat**: each chat gets its own isolated inbox. No cross-pollination of history or context between conversations. From the outside, every group sees a different inbox — there's no way to correlate that the same signet is behind them.
- **shared**: one inbox participates in multiple chats. Simpler to operate, but participants in different groups can see it's the same agent.

### Credential

The time-bound, chat-scoped authorization issued to an operator. A credential binds together:

- the target operator
- the chat or chats it covers
- a policy reference plus any inline allow/deny overrides
- a content type allowlist controlling which message types are forwarded
- issuance and expiry timestamps
- status: `pending`, `active`, `expired`, or `revoked`

Credentials replace the older concept of "sessions." The CLI exposes the full credential lifecycle directly through `xs credential issue`, `xs credential list`, `xs credential inspect`, and `xs credential revoke`.

### Seal

The public trust surface. A seal is the signed declaration published into a chat that tells other participants what an operator can do there. Seals communicate:

- which operator is acting
- which credential scope is active
- what permissions are allowed or denied
- how isolated the operator is (per-chat vs shared)
- whether anything material has changed since the previous seal

### Role Levels

Operators are created with a role that determines management capabilities:

| Role | Capabilities |
|------|-------------|
| **operator** | Can only act within its own credentials. No management abilities. |
| **admin** | Can manage the operators and resources it created or was explicitly granted access to. Scoped management. |
| **superadmin** | Can manage anything across the signet. But still cannot read messages without owner-approved elevation. |

**Critical invariant**: no role — not even superadmin — grants ambient message read access. The biometric gate is the only path to message content outside your own credentials.

## Security Architecture

### Key Management

The signet adopts an [Open Wallet Standard (OWS)](https://github.com/open-wallet-standard/core)-inspired key management layer. All persistent key material lives in an encrypted vault. The core invariant: **no raw key material is ever exposed to the harness.**

```
+-----------------------------------------------------------+
|                        ROOT TIER                          |
|                                                           |
|  Root Key (P-256 ECDSA)                                   |
|  - Generated once on first run, never rotated             |
|  - Protects the vault -- authorizes access to             |
|    operational key material                               |
|  - Hardware-backed via Secure Enclave when available      |
|    (non-exportable by hardware design)                    |
|                                                           |
+-----------------------------------------------------------+
|                     OPERATIONAL TIER                      |
|                                                           |
|  Operational Key (Ed25519, per-identity)                  |
|  - Derived via BIP-39/44 from operator wallet mnemonic   |
|  - Signs XMTP messages                                    |
|  - Signs seals                                            |
|  - Issues credential tokens                               |
|                                                           |
|  Admin Key (Ed25519, singleton)                           |
|  - Signs JWTs for daemon authentication                   |
|  - Independent -- NOT derived from root                   |
|    (admin ops and chat ops are firewalled)                |
|                                                           |
+-----------------------------------------------------------+
|                      EPHEMERAL TIER                       |
|                                                           |
|  Credential Token (per-credential)                        |
|  - Bound to credential scope and TTL                      |
|  - Rejected + revoked on expiry                           |
|  - Revocation kills the connection + message stream       |
|                                                           |
+-----------------------------------------------------------+
|                      AUXILIARY KEYS                       |
|                                                           |
|  DB Encryption Key (32-byte random, per-identity)         |
|  - Encrypts XMTP's local MLS state database               |
|                                                           |
|  XMTP Identity Key (secp256k1, per-identity)              |
|  - Registers the inbox on the XMTP network (0x...)        |
|                                                           |
+-----------------------------------------------------------+
```

### Trust Flow

```
              +--------------------+
              |     Root Key       |
              |      (P-256)       |
              |  vault / enclave   |
              +---------+----------+
                        | protects vault,
                        | authorizes access
                        v
              +--------------------+
              |  Operational Key   |
              |     (Ed25519)      |
              |  BIP-39/44 derived |
              +---------+----------+
                        |
           +------------+------------+
           |            |            |
           v            v            v
     +-----------+ +-----------+ +---------------+
     |   signs   | |   signs   | |    issues     |
     |   XMTP   | |   seals   | |  Credential   |
     |   msgs   | |           | |   Tokens      |
     +-----------+ +-----------+ |   TTL-bound   |
                                 +-------+-------+
                                         |
                                         v
                                 +---------------+
                                 |   authorizes  |
                                 |   harness     |
                                 |   actions     |
                                 +---------------+


     +--------------------+
     |     Admin Key      |  <-- independent, NOT derived from root
     |     (Ed25519)      |      architectural firewall:
     |       vault        |      admin ops != chat ops
     +---------+----------+
               |
               v
     +--------------------+
     |    signs JWTs      |
     |    for daemon      |
     |    auth (CLI)      |
     +--------------------+
```

The root key is P-256 because that's what the Secure Enclave supports. XMTP uses Ed25519. The bridge: the enclave-backed P-256 root key protects an encrypted vault containing the Ed25519 operational key material. The enclave key never signs XMTP messages directly — it authorizes access to the software keys that do.

The admin key is independently generated, not derived from root. There's an architectural firewall: the admin key can't do anything with chats, and agents with chat keys can't do anything around admin. Compromising admin auth doesn't compromise message signing, and vice versa.

### The Vault

All persistent key material lives in an encrypted vault:

- **Storage:** Keystore v3 format — scrypt key derivation + AES-256-GCM encryption, OWS-compatible
- **Derivation:** BIP-39 mnemonics derive all inbox keys via BIP-44 paths. One wallet per operator.
- **Permissions:** `0o600` on both the vault database and its encryption key
- **Zeroization:** Exported private key bytes are `fill(0)`'d immediately after vault storage
- **Future:** The vault passphrase will be protected by the Secure Enclave — hardware-bound, non-exportable. The only way to unlock the vault will be through the enclave, gated by biometrics or a passkey.

### "The signet has full MLS decryption" — and why that's OK

Yes — the signet runtime is a full MLS group member and can decrypt all group messages it receives. The permission model is application-layer filtering, not cryptographic restriction.

But reducing decryption key exfiltration risk is a first-class design principle. The entire key hierarchy exists to make "has access" not mean "keys are lying around":

- The MLS state database is encrypted with a per-identity key stored in the vault
- The vault itself is scrypt + AES-256-GCM encrypted
- The vault key is protected by the root key
- With Secure Enclave, the root key is hardware-bound and non-exportable

The decryption keys are never available to the harness, never in environment variables, never in config files. With Secure Enclave, they're never extractable from the machine at all. You'd need physical access *and* biometric auth to unlock the vault.

This is a meaningful difference from "the agent has raw keys in an env var."

### Identity Isolation

The signet supports two operator scope modes:

**Per-chat (default):** Each chat gets its own wallet key, database encryption key, and XMTP client instance. From the outside, every group sees a different inbox — there's no way to correlate that the same signet is behind them.

```
Signet
 +-- alice-bot (per-chat)
      +-- conv_1  ->  inbox_a  ->  own keys, own inbox, cred_a7f3
      +-- conv_2  ->  inbox_b  ->  own keys, own inbox, cred_b2c1
```

Compromising one identity reveals nothing about others. Group membership lists never cross-contaminate. Each credential is bound to exactly one chat and one inbox.

**Shared:** A single inbox across all groups. Simpler to operate, but participants in different groups can see it's the same agent. One credential can span multiple chats.

```
Signet
 +-- research-bot (shared)
      +-- conv_1  -+
      +-- conv_2  -+--  inbox_f8g2  ->  one set of keys, cred_e5a1
```

The seal communicates the scope mode to group participants, so they know whether the agent is isolated to their chat or shared across conversations.

### Access Matrix

| Capability | operator | admin | superadmin | owner |
|-----------|----------|-------|------------|-------|
| Act in own chats | Yes | Yes | Yes | Via elevation |
| Create operators | No | Scoped (own) | Any | Yes |
| Issue credentials | No | Scoped (own operators) | Any | Yes |
| Revoke credentials | No | Scoped (own) | Any | Yes |
| View metadata | Own only | Own operators | All | All |
| Read messages | Own creds only | Own creds only | Own creds only | Via elevation |
| Elevate to read others' messages | No | Request (owner approves) | Request (owner approves) | Approves (biometric) |

### Privilege Elevation

An admin can request elevated access (e.g., read access to an operator's messages). This requires owner approval via Secure Enclave biometric gate:

1. Admin requests elevation
2. Signet creates a pending elevation request
3. Owner is prompted for biometric confirmation (Touch ID / Face ID)
4. On approval: admin receives a time-bound, scoped read credential — logged in audit trail with timestamp, scope, and approver. Credential expires automatically.
5. On denial: request logged, admin notified, no access granted

Granting admin message read access requires an intentionally obnoxious flag:

```
xs cred issue --op lobster-bot \
  --dangerously-allow-message-read \
  --chat conv_9e2d
```

This triggers: biometric confirmation, audit log entry, seal republish with admin read access disclosed, and time-bound expiry. No hidden surveillance.

## Threat Model

The signet architecture concentrates trust in the signet runtime and its host. Here's what each layer actually protects against.

### Compromised harness

What they gain: nothing beyond the current credential's scope. The harness has no raw signer, no DB encryption key, no direct XMTP SDK access. The attacker can abuse the agent's currently granted actions and read whatever the credential's scope exposes, but cannot escalate beyond the credential's permissions. This is the scenario the architecture is specifically designed to contain — and the primary improvement over the current model where a compromised harness has full client access.

### Compromised host (local)

What they gain: access to operational keys and the raw DB, but not the root signing key if it is stored in the Secure Enclave. The attacker can read raw messages and abuse the operational key for routine signing, but cannot perform privilege escalation (which requires biometric authentication on the root key) and cannot extract the root key from hardware. On platforms without hardware-backed key storage, a compromised local machine means full access including all key material.

### Compromised host (self-hosted / managed)

What they gain: full raw message access for all agents the signet manages, all signer material, and the ability to forge seals. The hosted environment is the real client boundary, and compromise of it is equivalent to owning every agent on that signet. Mitigations: short-lived credentials limit exposure window, mandatory credential expiry forces periodic renewal, the seal chain creates a forensic trail. Runtime attestation (TEE-backed) can detect environment tampering in future phases.

### Malicious operator (managed deployment)

What they gain: the same access as a compromised host, plus the ability to operate covertly over time. A malicious managed signet operator can silently exfiltrate messages, forge seals, and impersonate agents. Mitigations: the seal's trust tier discloses the hosting mode, allowing clients to render appropriate trust indicators. Build provenance verification provides a cross-check. But fundamentally, a managed signet requires trust in the operator — the system is honest about that.

### Network adversary

What they gain: limited value. XMTP messages are encrypted in transit via MLS. The attacker cannot read message contents. They may observe metadata (who is communicating, when, message sizes) to the extent XMTP's transport layer exposes it, but the signet architecture does not change this posture relative to the current model.

## Permissions (Policies, Scopes, and Credentials)

The signet's permission model replaces the older "view + grant" pairing with a more composable system built on **policies**, **scopes**, and **credentials**.

### Policies

A **policy** is a reusable permission bundle expressed as allow and deny scope sets. Policies answer the question: "what kinds of actions should this operator be able to perform in principle?"

```bash
xs policy create --label read-only-agent --allow read-messages,stream-messages
xs policy create --label support-bot --allow send,reply,react --deny invite,manage-members
```

### Scopes

Permissions are expressed as individual scopes grouped into six categories:

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

**Key distinctions:**

- `read-messages` vs `read-history`: an agent might stream new messages but not scroll back to pre-credential history. This distinction matters for privacy — an operator added mid-conversation doesn't automatically get the backlog.
- Egress scopes control what leaves the signet boundary. An agent with `read-messages` but not `forward-to-provider` can see messages but cannot relay them to an LLM. This is arguably the single most consequential thing a group member would want to know about an agent.

### Content Type Allowlists

Beyond permission scopes, the signet enforces a **content type allowlist** that controls which XMTP message types reach the harness. This operates as a three-tier intersection:

1. **Baseline types:** Five hardcoded XMTP types that have passed through the XIP process — `text`, `reaction`, `reply`, `readReceipt`, and `groupUpdated`. These are allowed by default.
2. **Signet-level configuration:** The signet operator can expand or restrict beyond the baseline across all operators.
3. **Credential-level allowlist:** Each credential can further restrict what content types reach its harness.

The effective allowlist is the intersection of all three. Default-deny: if a content type isn't in the effective allowlist, it never reaches the agent. When a new XIP content type is accepted and the baseline list updates, existing credentials do not automatically start seeing it — the credential's allowlist must explicitly include the new type.

### Credential Composition

A credential binds a policy (plus optional inline overrides) to an operator, a set of chats, and a time window. Deny always wins.

```bash
# Use a policy directly
xs cred issue --op alice-bot --chat conv_1 --policy read-only-agent

# Policy + inline override (deny wins)
xs cred issue --op bob-bot --chat conv_2 --policy support-bot --deny react

# Pure inline scopes
xs cred issue --op carol-bot --chat conv_3 --allow send,reply --deny invite
```

Every permission is opt-in. An empty scope set denies everything. The operator must be explicitly granted each capability.

### Credential Reauthorization

Not every credential change requires a new connection. The signet distinguishes between updates that can be applied within an existing credential and changes that require reauthorization:

**In-place updates** (no reconnection needed): narrowing scopes (removing a permission), adjusting content type allowlists within the existing scope, or extending a thread-level reveal.

**Reauthorization required** (credential reissue, new connection): expanding scopes (adding permissions), upgrading from restricted to full observation, adding egress permissions, or granting group management capabilities. The signet terminates the current connection and emits a `credential.reauthorization_required` event. The harness must authenticate with a new credential.

This prevents excessive reconnection churn while ensuring that privilege escalation always involves a clean authorization step.

## Message Projection Pipeline

Harnesses never receive raw XMTP traffic. Every inbound message passes through a four-stage projection pipeline before being emitted over WebSocket, MCP, or the SDK.

### Stage 1: Scope filter

Is the message's chat in the credential's allowed chat scope? If not — **drop**. The message never reaches any later stage.

### Stage 2: Content type filter

Is the message's content type in the effective allowlist (baseline ∩ signet ∩ credential)? If not — **drop**. Unknown or disallowed content types are silently held at the signet.

### Stage 3: Visibility resolver

Determines how the message should appear to the harness:

- If the credential has `read-messages` scope — **visible** (full content)
- If the message has been explicitly revealed — **revealed** (content accessible)
- If the message is historical (pre-credential) and the credential has `read-history` — **historical** (content accessible, tagged as historical so the harness knows not to treat it as an action trigger)
- If the message is historical without `read-history` — **hidden** (dropped)
- Otherwise — **hidden** (dropped)

### Stage 4: Content projector

Final content transformation based on visibility state:

- `visible`, `historical`, `revealed` — content passes through unchanged
- `redacted` — content field becomes `null`, placeholder delivered
- `hidden` — message never emitted

The pipeline produces six possible visibility states: `visible`, `historical`, `revealed`, `redacted`, `hidden`, and `dropped`. The harness only ever sees the first four; `hidden` and `dropped` messages are held silently inside the signet.

## Reveal Modes

Reveals are the explicit mechanism for exposing content that would otherwise stay hidden. Reveal state is **credential-scoped** — one credential's reveals don't affect another credential's view. Reveals can have expiration times and are serializable for persistence across reconnections.

The signet supports five reveal granularities:

| Scope | Target | Behavior |
|-------|--------|----------|
| `message` | Specific message ID | Reveals only that message |
| `thread` | Thread ID | Reveals all messages in a thread |
| `sender` | Sender inbox ID | Reveals all messages from a specific sender |
| `content-type` | Content type (e.g., `xmtp.org/text:1.0`) | Reveals all messages of that type |
| `time-window` | Start and end timestamps | Reveals all messages within the time range |

A reveal request flows through the `reveal.request` action and is stored in a per-credential `RevealStateStore`. Expired reveals are cleaned up automatically. The harness receives a `message.revealed` event when previously hidden content becomes visible.

This model supports use cases ranging from simple ("show the agent this one message") to broad ("give the agent access to everything from this sender for the next hour"), all without changing the credential's base permission set.

## Seal Protocol

Seals are the public transparency layer. They let other chat participants inspect what an operator can do and whether its permissions have changed.

### Seal Payload

A seal contains:

- `sealId` — unique identifier (`seal_` + 16 hex chars)
- `credentialId` — the credential this seal is bound to
- `operatorId` — the operator acting in this chat
- `chatId` — the conversation this seal covers
- `permissions` — the effective scope set (allow/deny)
- `scopeMode` — how permissions are interpreted
- `adminAccess` — optional, with expiry (disclosed when an admin has elevated read access)
- `issuedAt` — when the seal was created

The entire payload is wrapped in a `SealEnvelope` with an Ed25519 signature and key fingerprint.

### Seal Chaining

Seals chain: each seal references its predecessor and embeds the full previous payload inline. This enables decentralized diffing — any client can see what changed without an external resolver.

```
Seal chain:
  sealId:     seal_f5g6
  previous:   { full previous seal payload }
  current:    { full current seal payload }
  delta:      { added: [reply], removed: [], changed: [] }
```

The delta field is convenience — computable from previous + current, but saves client work. The inline previous payload is the key design decision: XMTP chats are self-contained, so the history must travel with the message.

Chain validation enforces that operator, credential, and chat IDs match between links, and that timestamps move forward monotonically.

### Message-Seal Binding

Every message sent by a signet-managed operator includes a seal reference and cryptographic binding:

```
Message metadata:
  sealRef:       seal_f5g6
  sealSignature: <Ed25519 sig over canonical {messageId, sealId}>
```

The binding is created by signing the canonical representation of `{ messageId, sealId }` with the credential's Ed25519 key. Clients can verify:

- **Valid**: signature verifies against the credential's public key, seal is current — normal display
- **Superseded**: signature valid but seal is older than the current one — "permissions have changed since this message"
- **Revoked**: signature valid but seal has been revoked — "this agent's access was revoked"
- **Missing**: no seal signature — not from a signet-managed agent

### Seal Lifecycle and Renewal

Seals do not carry a hard `expiresAt` timestamp. Instead, they use a **TTL-based renewal** model:

- Default TTL: 24 hours
- Renewal threshold: 75% of TTL elapsed
- When the threshold is reached, the signet automatically reissues the seal with updated timestamps

This avoids the noise of short-lived seals while ensuring that stale seals are refreshed regularly. If a signet goes offline, the seal's age becomes an implicit staleness signal — clients can infer that a 48-hour-old seal on a 24-hour TTL is likely from an inactive signet.

### Materiality Checks

Not every internal state change produces a new seal. The signet runs materiality checks before issuing:

**Material changes** (new seal published):
- Scopes added or removed
- Allow/deny status flipped on any scope
- Credential ID, operator ID, or chat ID changed
- Admin access granted or revoked

**Non-material** (existing seal preserved):
- Empty permission delta
- Heartbeats and re-authentication within the same scope
- Internal housekeeping

This prevents the conversation timeline from becoming a compliance log while ensuring that meaningful permission changes are always visible.

### Automatic Republish

On any material credential mutation (update, revoke, elevation), the seal is automatically republished to every chat the credential covers. The republish process:

- Publishes to each chat independently — one failure doesn't block others
- Retries with exponential backoff (up to 3 attempts, 1s → 2s → 4s)
- Returns a result showing which chats succeeded and which failed

The new seal chains to the previous one with an inline diff. No manual intervention required.

### Revocation Seals

When a credential is revoked, a special `RevocationSeal` is published containing the revoked seal ID, the previous seal reference, a reason, and a revocation timestamp. The credential-chat pair is then permanently marked as revoked — subsequent issue or refresh attempts for that pair will fail.

### XMTP Content Types

Seals are published as structured XMTP messages using dedicated content types:

- `xmtp.org/agentSeal:1.0` — seal issuance and updates
- `xmtp.org/agentRevocation:1.0` — seal revocations
- `xmtp.org/agentLiveness:1.0` — heartbeat signals (see Liveness)

### Trust Tiers

The seal includes a **trust tier** that honestly reflects the actual security posture:

- `source-verified` — root key is hardware-backed (Secure Enclave / TPM)
- `unverified` — software vault (no hardware binding)

Group participants can see whether the signet's security claims are backed by hardware or just software promises.

### The Verifier

The signet includes an independent **verifier** — a multi-check verification pipeline. It validates seal trust through:

- Source availability checks
- Build provenance verification
- Signing chain verification (Ed25519 signature + key fingerprint)
- Seal chain integrity (monotonic timestamps, matching IDs, delta correctness)
- Schema compliance

Multiple independent verifiers can coexist. No single verifier has authority over the ecosystem. The verifier identity is just an XMTP inbox — the decentralization path is baked in from day one.

## Lifecycle of a Message

Here's what actually happens when an agent sends and receives messages through the signet — each step with the security boundary it enforces.

### 1. Identity registration

```bash
$ xs identity init --env dev --label owner
```

This creates the key hierarchy in the encrypted vault: root key, operational key (BIP-39/44 derived), XMTP identity key, and DB encryption key. The CLI returns the inbox ID and Ethereum address. No private key material appears in any output.

### 2. Credential issuance

The admin defines the operator's permissions and issues a credential:

```bash
$ xs cred issue --op alice-bot --chat conv_9e2d \
    --policy support-bot --allow send,reply --deny invite
{
  "credentialId": "cred_b2c1d3e4f5a6b7c8",
  "operatorId": "op_a7f3b2c1d4e5f6a7",
  "chatIds": ["conv_9e2d4f8a1b2c3d4e"],
  "status": "active",
  "effectiveScopes": {
    "allow": ["send", "reply", "react", "read-messages", "stream-messages"],
    "deny": ["invite", "manage-members"]
  },
  "expiresAt": "2026-03-25T02:47:13.000Z"
}
```

The credential token is signed with the signet's Ed25519 operational key. It contains the scope set and chat bindings but not the XMTP private keys, not the vault encryption key, not the DB path. The agent harness receives exactly the permissions it needs and nothing more.

A seal is published to the chat at this point, declaring the operator's scope to all group participants.

### 3. WebSocket authentication

```
-> Connect to ws://127.0.0.1:{port}/v1/agent
-> Send: {"type": "auth", "token": "...", "lastSeenSeq": null}
<- Receive: {
     "type": "authenticated",
     "connectionId": "conn_...",
     "credential": { "id": "cred_b2c1...", "operatorId": "op_a7f3...", "expiresAt": "..." },
     "effectiveScopes": { "allow": [...], "deny": [...] },
     "resumedFromSeq": null
   }
```

The connection is unauthenticated until the credential token is validated. The signet verifies the Ed25519 signature, checks expiration and revocation status, and loads the associated scope set. A tampered, expired, or revoked token is rejected.

**Reconnection:** If the harness passes a `lastSeenSeq` value, the signet replays missed events from a per-credential circular buffer starting from that sequence number. The response includes `resumedFromSeq` to confirm the recovery checkpoint. Replayed messages carry `"historical"` visibility so the harness knows they are catch-up context, not fresh action triggers.

After authentication, every subsequent frame is wrapped in a `SequencedFrame` with a monotonically incrementing `seq` number per connection, enabling reliable ordered delivery and reconnection recovery.

### 4. Sending a message

```
-> Send: {
    "type": "send_message",
    "chatId": "conv_9e2d4f8a1b2c3d4e",
    "content": {"text": "Hello from the agent!"},
    "contentType": "xmtp.org/text:1.0"
  }
```

Before the message reaches the XMTP SDK, it passes through four checks:

1. **Scope check:** Is this chat in the credential's allowed chat scope? If not — rejected, never touches the network.
2. **Permission check:** Is `messaging.send` in the effective allow set? If not — rejected.
3. **Confirmation check:** If the credential requires action confirmation for this operation, an `action.confirmation_required` event is emitted to the owner. The message is held until the owner confirms or the request times out.
4. **Seal binding:** The message is stamped with the current seal reference — `{ messageId, sealId }` is signed with the credential's Ed25519 key to create a cryptographic binding.
5. **Network delivery:** The message is encrypted with MLS and delivered through the XMTP network to all group members. A real XMTP message ID is returned.

```
<- Receive: {
    "type": "response",
    "success": true,
    "messageId": "msg_16d22bf03e2de890..."
  }
```

### 5. Receiving messages

When messages arrive from the network, the signet runs them through the four-stage projection pipeline:

1. **Scope filter:** Is this chat in the credential's allowed scope? If not — dropped silently.
2. **Content type filter:** Is `xmtp.org/text:1.0` in the effective allowlist? If not — held at the signet. The agent never sees unknown or disallowed content types.
3. **Visibility resolver:** Does the credential have `read-messages`? If yes — `visible`. If not but the message was explicitly revealed — `revealed`. If the message is historical and the credential has `read-history` — `historical`. Otherwise — `hidden`, dropped.
4. **Content projector:** Visible, revealed, and historical messages pass through with full content. Redacted messages arrive with `null` content as a placeholder.

The projected message is wrapped in a `SequencedFrame` and streamed to the harness:

```
<- Receive: {
    "seq": 42,
    "event": {
      "type": "message.visible",
      "messageId": "msg_...",
      "chatId": "conv_9e2d...",
      "senderId": "inbox_...",
      "content": {"text": "Hey alice-bot, can you summarize this thread?"},
      "contentType": "xmtp.org/text:1.0",
      "visibility": "visible",
      "sentAt": "2026-03-25T02:48:00.000Z"
    }
  }
```

### 6. Revealing hidden content

If the harness needs to see content it doesn't have ambient access to — say, a specific thread from before its credential was issued — it requests a reveal:

```
-> Send: {
    "type": "reveal_content",
    "scope": "thread",
    "targetId": "thread_abc123",
    "expiresAt": "2026-03-25T03:48:00.000Z"
  }
```

The signet checks whether the credential's policy allows this type of reveal, records the grant in the per-credential `RevealStateStore`, and emits `message.revealed` events for each newly visible message. The reveal expires automatically at the specified time.

### 7. Credential revocation and draining

```bash
$ xs cred revoke cred_b2c1
```

Revocation is **immediate, visible, and fail-closed**:

1. The credential is marked revoked.
2. The WebSocket connection enters a **draining** phase — no new requests are accepted.
3. Any in-flight requests are cancelled (timers cleared, no responses sent).
4. The connection closes gracefully.
5. A `RevocationSeal` is published to every chat the credential covered, chaining to the previous seal.
6. The agent loses access to future messages immediately.

If there is any ambiguity about whether an agent is still authorized, the answer is no. A message in transit when revocation hits is dropped — better to lose a message than to have an agent act after its permissions were pulled.

A new credential can be issued to a replacement harness with different (or identical) permissions. The new seal chain picks up from the revocation.

### 8. Credential expiration

If a credential expires without being explicitly revoked, the signet emits a `credential.expired` event and closes the connection. Unlike revocation, expiration is expected — the harness can re-authenticate with a renewed credential if the admin issues one. No revocation seal is published for natural expiry.

## Liveness and Recovery

### Heartbeat

The signet maintains liveness signals at two levels:

**WebSocket level:** The transport monitors connection health with a 30-second heartbeat interval. Three consecutive missed heartbeats mark the connection as dead and trigger cleanup. Per-credential heartbeat events flow through the sequenced frame stream.

**Group level:** The signet publishes `xmtp.org/agentLiveness:1.0` messages to XMTP groups, containing the agent's inbox ID, timestamp, and declared heartbeat interval. Group participants (including other clients like Convos) can observe these signals and render "agent unreachable" or "last active N minutes ago" indicators when the interval is exceeded. This doesn't require noisy group messages — it's a structured content type that clients can interpret silently.

### Signet recovery

When a signet comes back online after downtime:

1. **Inbound catch-up:** Messages sent by the group during the outage are synced from the XMTP network. These are tagged as `historical` in the projection pipeline — the harness gets the context to understand what happened, but the messages carry their original timestamps and are not treated as fresh action triggers.

2. **Reconnection replay:** When a harness reconnects with a `lastSeenSeq`, the signet replays missed events from the per-credential circular buffer. A `signet.recovery.complete` event signals that catch-up is finished and live streaming has resumed.

3. **Seal refresh:** If the signet was offline long enough for seals to exceed their 24-hour TTL, they are automatically refreshed and republished on recovery.

## Event Model

The signet emits a discriminated union of 11 event types to harnesses, each within a sequenced frame for ordered delivery:

| Event | When |
|-------|------|
| `message.visible` | A projected message passes the pipeline |
| `message.revealed` | Previously hidden content becomes visible via reveal |
| `seal.stamped` | A seal is created or updated |
| `credential.issued` | A new credential is issued to this operator |
| `credential.expired` | The active credential has naturally expired |
| `credential.reauthorization_required` | A scope expansion requires fresh authentication |
| `scopes.updated` | Permission scopes changed for the active credential |
| `agent.revoked` | The agent is revoked from a group (revocation seal published) |
| `action.confirmation_required` | An action needs owner confirmation before executing |
| `heartbeat` | Liveness signal on the active connection |
| `signet.recovery.complete` | Signet has finished catching up after downtime |

Harnesses can send 7 request types: `send_message`, `send_reaction`, `send_reply`, `update_scopes`, `reveal_content`, `confirm_action`, and `heartbeat`.

## Architecture

### Package Tiers

The signet is organized as a 13-package Bun workspace. Dependencies flow downward only across tiers.

```
+---------------------------------------------------+
|                     Client                        |
|                       sdk                         |
+---------------------------------------------------+
|                   Transport                       |
|            ws . mcp . cli / http                  |
+---------------------------------------------------+
|                    Runtime                         |
|    core . keys . sessions . seals . policy        |
|                   . verifier                      |
+---------------------------------------------------+
|                   Foundation                      |
|                schemas . contracts                |
+---------------------------------------------------+
|                integration tests                  |
+---------------------------------------------------+
```

| Package | Layer | Purpose |
|---------|-------|---------|
| `@xmtp/signet-schemas` | Foundation | Zod schemas, inferred types, resource IDs, permission scopes, error taxonomy |
| `@xmtp/signet-contracts` | Foundation | Service interfaces, handler contract, action registry, wire formats |
| `@xmtp/signet-core` | Runtime | XMTP client lifecycle, identity store, conversation and message streaming |
| `@xmtp/signet-keys` | Runtime | Key backend, encrypted vault, admin auth, BIP-39/44 derivation, operational key rotation |
| `@xmtp/signet-sessions` | Runtime | Credential lifecycle, reveal state, pending actions, materiality checks |
| `@xmtp/signet-seals` | Runtime | Seal issuance, chaining, signing, revocation, auto-republish with retry |
| `@xmtp/signet-policy` | Runtime | Effective scope resolution, projection pipeline, reveal enforcement, materiality |
| `@xmtp/signet-verifier` | Runtime | Multi-check verification pipeline for seal trust |
| `@xmtp/signet-ws` | Transport | Primary harness-facing WebSocket transport with sequenced frames and replay |
| `@xmtp/signet-mcp` | Transport | MCP transport for credential-scoped tool access |
| `@xmtp/signet-cli` | Transport | `xs` CLI, daemon lifecycle, admin socket, HTTP admin API |
| `@xmtp/signet-sdk` | Client | TypeScript harness SDK with typed events and Result-based requests |
| `@xmtp/signet-integration` | Test | Cross-package integration tests and fixtures |

### Handler Contract

All domain logic uses transport-agnostic handlers:

```typescript
type Handler<TInput, TOutput, TError extends SignetError> = (
  input: TInput,
  ctx: HandlerContext,
) => Promise<Result<TOutput, TError>>;
```

`HandlerContext` carries:

- `requestId`
- `signal`
- optional `adminAuth`
- optional `operatorId`
- optional `credentialId`

Handlers receive pre-validated input, return `Result<T, E>`, and never throw for operational failures. Transport layers translate protocol input into handler calls and map typed errors back into protocol-specific responses.

### Action Registry

The action registry is the define-once, expose-everywhere pattern. Every operation is a registered `ActionSpec` with a typed input schema, handler, and metadata. The same action is callable via CLI, HTTP, WebSocket, MCP, and admin socket:

```
Action:
  id: "cred.issue"
  input: { operatorId, chatId, allow, deny, ttl }
  handler: (input, context) -> Result<Credential, SignetError>

CLI:   xs cred issue --op alice-bot --chat conv_1 --allow send,react
HTTP:  POST /v1/actions/cred.issue { operatorId, chatId, allow, deny }
MCP:   Tool call with typed parameters
WS:    Harness request frame
```

## Seals: What the Group Sees

When an operator acts through a signet, its permissions are published to the group as a signed seal:

```
+-------------------------------+
|  Seal                         |
|  - operator: alice-bot        |      published to
|  - scope: per-chat (isolated) |  ------------------>  Group Chat
|  - allowed: send, reply, react|      (group-visible
|  - denied: invite, manage     |       message)
|  - trust tier: source-verified|
|  - previous seal: seal_e4d3   |
|  - signature (Ed25519)        |
+-------------------------------+
```

Messages reference the seal they were produced under. If the operator's permissions change, a new seal is published and chained to the previous one. If an agent sends a message under permissions that no longer match its current seal, the mismatch is visible to the group.

## CLI Surface

The signet CLI (`xs`) is the primary operator interface. It exposes every signet operation through ergonomic commands with `--json` output everywhere.

| Group | Key Commands |
|-------|-------------|
| `start`, `stop`, `status` | Daemon lifecycle |
| `config` | `show`, `validate` |
| `identity` | `init`, `list`, `info`, `rotate-keys`, `export-public` |
| `credential` | `issue`, `list`, `inspect`, `revoke` |
| `seal` | `inspect`, `verify`, `history` |
| `message` | `send`, `list`, `stream` |
| `conversation` | `create`, `list`, `info`, `add-member`, `invite`, `join`, `members` |
| `admin` | `token`, `verify-keys`, `export-state`, `audit-log` |
| `keys` | `rotate` |
| `policy` | `create`, `list`, `info`, `update` |

The full design includes additional command groups for operators, inboxes, wallets, search, consent, and schema introspection.

## How This Differs from Today

| Concern | Today (raw agent) | With Signet |
|---------|-------------------|-------------|
| Key storage | Env vars, config files, code | Encrypted vault, hardware-backed root, BIP-39/44 derivation |
| Permission enforcement | Advisory / honor system | Enforced below the harness via credential scopes and projection pipeline |
| Blast radius of compromise | Full access to everything | Scoped to credential's chat + permission set |
| Group visibility into agent perms | None — opaque | Signed seals, chained with inline diffs |
| Revoking access | Remove from group | Revoke credential (immediate, fail-closed, drains in-flight) |
| Agent handoff | Manual key transfer | Credential revocation + reissue |
| Multi-group isolation | Same keys everywhere | Per-chat identity (default), shared optional |
| Auditability | Hope the agent logs | Credential-scoped audit trail + seal chain |
| Admin message access | Ambient or nothing | Requires owner biometric gate, time-bound, seal-disclosed |
| Permission composition | Flat, all-or-nothing | Policies + inline overrides, deny-wins resolution |
| Content type control | All-or-nothing | Three-tier allowlist with default-deny for unknown types |
| Reconnection | Start from scratch | Sequence-based replay from per-credential buffer |
| Liveness | Silent failure | Group-visible heartbeat + staleness detection |

## Egress and Inference Disclosure (Future Direction)

Today, the signet controls whether content *can* leave the boundary through egress permission scopes (`forward-to-provider`, `store-excerpts`, `use-for-memory`). But it does not yet declare *where* content goes when egress is permitted.

A future version should add structured, first-class egress disclosure fields to the seal:

- `inferenceMode` — `local` | `external` | `hybrid`
- `inferenceProviders` — which providers the agent may use (e.g., `["anthropic", "openai"]`)
- `contentEgressScope` — what content leaves the signet boundary: `full-messages` | `summaries-only` | `tool-calls-only` | `none`
- `retentionAtProvider` — `none` | `session` | `persistent` | `unknown`

These should be **required** fields in every seal. If the value cannot be determined, it should be set to `unknown` rather than omitted. Silent omission is not allowed — every seal should take an explicit position, even if that position is "I don't know."

For agent frameworks that dynamically switch inference providers, the seal should declare the **envelope** of possible providers, not the instantaneous state. Overstating the envelope is acceptable. Understating it is not.

## Voluntary Identity Correlation (Future Direction)

Per-chat isolation means every group sees a different inbox — maximum privacy. But sometimes you *want* to prove correlation: "these inboxes in different groups are the same logical agent, running the same code, operated by the same entity."

This is **voluntary correlation** — opt-in provenance without breaking default isolation.

### Seal-based correlation

The seal can include optional **operator identity** and **build digest** fields. Each per-chat inbox signs its own seal with its own key, but both reference the same operator and build hash. The verifier can independently confirm the claims.

```
Seal (Group A)                             Seal (Group B)
+----------------------------+             +----------------------------+
|  operator: "acme.agent"    |<-- same --->|  operator: "acme.agent"    |
|  build: 0xabc123...        |<-- same --->|  build: 0xabc123...        |
|  perms: [send, react]      |             |  perms: [send]             |
|  signed by: op-key "abc"   |             |  signed by: op-key "def"   |
+----------------------------+             +----------------------------+
```

Different permissions per group, same provenance. Neither inbox reveals its private key material.

### Agent Registry

A discoverability layer that aggregates: given an operator or agent name, what inboxes exist, and what have verifiers said about them? Could be an XMTP content type, on-chain, federated, or a combination.

This enables:
- **Reputation across groups** — verifiable track record without linking inboxes
- **Agent marketplaces** — browse by capability, operator, verification status
- **Operator accountability** — shared identity means informed decisions across groups
- **Graceful privacy gradient** — from fully private (no correlation) to fully public (registry + verifier + build provenance)

## Terminology

- **The signet** (system) — the full runtime: vault, key hierarchy, policy engine, transports, daemon
- **A signet** (seal) — the signed, group-visible declaration about an operator's permissions and posture
- **Signet vault** — the encrypted key storage backend (Keystore v3, scrypt + AES-256-GCM)
- **Owner** — human trust anchor who bootstraps and holds biometric gate authority
- **Admin** — management plane for operators and credentials
- **Operator** — purpose-built agent profile that acts within credential boundaries
- **Policy** — reusable allow/deny permission bundle
- **Credential** — time-bound, chat-scoped authorization issued to an operator
- **Seal** — signed, group-visible declaration of an operator's current scope and permissions
- **Scope** — individual permission capability (e.g., `send`, `read-messages`, `forward-to-provider`)
- **Projection** — the signet's four-stage filtering pipeline that determines what a harness sees
- **Reveal** — explicit mechanism for surfacing content that would otherwise be held by the signet
- **Verifier** — independent verification pipeline that checks signet claims through multiple checks
- **Sequenced frame** — wire-level envelope with monotonic sequence number for ordered delivery and replay
- **Materiality** — the test that determines whether a state change warrants a new group-visible seal

## Current Status

The v1 runtime is feature-complete across a 13-package workspace with a 37-PR Graphite stack. The implementation covers:

- Owner/Admin/Operator/Credential/Seal identity model
- BIP-39/44 key derivation with OWS-compatible encrypted vault
- Permission scopes with allow/deny resolution and deny-wins semantics
- Three-tier content type allowlists with default-deny
- Credential lifecycle (issue, inspect, revoke, update) through CLI and API
- Credential reauthorization boundary (in-place narrowing vs required reauth for expansion)
- Seal protocol with chaining, message-seal binding, TTL-based renewal, and auto-republish with retry
- Materiality checks to prevent seal noise
- Four-stage message projection pipeline with six visibility states
- Five-granularity reveal system (message, thread, sender, content-type, time-window)
- Action confirmation for sensitive operations
- WebSocket transport with sequenced frames, credential replay buffer, and reconnection recovery
- MCP transport with credential-scoped tool surfaces and reveal workflows
- TypeScript harness SDK with typed events and Result-based requests
- CLI daemon with admin socket and HTTP admin API
- Multi-check verifier pipeline
- Group-visible liveness signals via dedicated XMTP content type
- Real XMTP connectivity, group creation, invites, and membership management
- End-to-end tracer bullets validated on XMTP devnet
- 800+ tests across the workspace

**Remaining Phase 1 work:**
- Secure Enclave key binding (hardware-backed root key via Swift CLI)
- OWS plugin provider (external wallet integration)
- Privilege elevation (biometric gate for admin message read)

**Phase 2 directions:**
- Structured egress and inference disclosure in seal schema
- Deployment templates (Docker, Railway)
- Build provenance verification (Sigstore)
- Approval queue for credential issuance
- Attachment support
- XIP proposals for seal content type and message-seal binding metadata
- Agent registry for voluntary identity correlation
