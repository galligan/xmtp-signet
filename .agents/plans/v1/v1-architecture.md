# Signet v1 Architecture

Status: **Draft — under discussion**
Last updated: 2026-03-23

## Overview

The signet is the real XMTP client. Agent harnesses connect through a controlled interface with scoped credentials and grants. This document defines the v1 identity model, access/encryption model, seal protocol, permission scopes, and the action registry that all transport surfaces (CLI, HTTP, WebSocket, MCP) are derived from.

## Identity Model

### Hierarchy

```
Owner (human, root keys, runs xs init)
  └─ Admin "lobster-bot" (orchestrator, broad permissions)
       ├─ Operator "alice-bot" (agent profile)
       │    scope: per-chat (conversation-scoped inboxes)
       │    allowed: send, react
       │    denied: invite, manage-members
       │    chats: ["Design Team", "Support"]
       │    credentials:
       │      cred_a7f3 → chat conv_9e2d, inbox inbox_c3e5
       │      cred_b2c1 → chat conv_4f8a, inbox inbox_d6f2
       │
       └─ Operator "research-bot" (agent profile)
            scope: shared (one inbox, cross-chat context)
            allowed: send, react, read-history
            chats: ["Research", "Engineering"]
            credential:
              cred_e5a1 → chats [conv_7b3c, conv_1d4e], inbox inbox_f8g2
```

### Roles

- **Owner** — human. Holds root keys. Runs `xs init`. Approves privilege escalations (biometric gate). Rarely touches the signet after setup.
- **Admin** — primary agent (e.g., Lobster Bot). Orchestrates day-to-day: creates operators, assigns chats, approves requests. Broad permissions delegated by owner.
- **Operator** — purpose-built agent profile (e.g., Alice Bot). Participates in chats within its granted scope. Cannot escalate its own permissions.
- **Credential** — time-bound, scoped pass issued to an operator for specific chats. Like a backstage pass: says who you are, where you can go, what you can do, when it expires. Statuses: `pending`, `active`, `expired`, `revoked`.
- **Seal** — public proof published to a chat. Group members can see exactly what the agent can and can't do, its scope isolation level, and who issued the credential.

### Role Levels

Operators are created with a role that determines management capabilities:

- **operator** — can only act within its own credentials. No management abilities.
- **admin** — can manage the operators and resources it created or was explicitly granted access to. Scoped management — can't reach into other admins' operators.
- **superadmin** — can manage anything across the signet. But still cannot read messages without owner-approved elevation.

### Scope Modes

- **per-chat** — each chat gets its own inbox (conversation-scoped). No cross-pollination of history or context between chats. The seal communicates this isolation to group members.
- **shared** — one inbox participates in multiple chats. History and context may cross chats. The seal communicates this shared scope to group members.

### Credential Composition

- **per-chat operator** → one credential per chat, each bound to a unique inbox. Issuing for a new chat creates a separate credential + separate inbox.
- **shared operator** → one credential can cover multiple chats through the same inbox. Multiple credentials can be issued to the same operator for different permission levels per chat.

### Relationships

```
Owner ──creates──▶ Admin
Admin ──creates──▶ Operator
Admin ──issues───▶ Credential (for an Operator, scoped to Chats)
Operator ──uses──▶ Credential (to connect and act)
Credential ──binds──▶ Inbox(es) + Chat(s) + Permissions
Seal ──published to──▶ Chat (declares Operator's permissions publicly)
Seal ──derived from──▶ Credential + Operator config
```

## Key Management Foundation

The signet adopts [Open Wallet Standard (OWS)](https://github.com/open-wallet-standard/core) as its key management and signing layer. OWS provides encrypted local key custody, BIP-39/44 key derivation, pre-signing policy enforcement, and memory-safe signing via Rust/NAPI.

See **[OWS Integration Plan](./ows-integration.md)** for the full mapping between OWS concepts (wallets, API keys, policies) and signet concepts (operators, credentials, permission scopes), the storage layout, key derivation strategy, and migration plan.

Key integration points:
- One OWS wallet per operator (BIP-39 mnemonic derives all inbox keys)
- OWS API keys map to signet credentials (token-as-capability via HKDF)
- OWS policy engine enforces permission scopes via a custom signet policy evaluator
- Secure Enclave stores the vault passphrase (biometric-protected, never exposed to user)

## Access & Encryption Model

### Key Separation

Each operator's message data is encrypted with keys derived from that operator's credential chain. This is cryptographic separation at the storage layer, not just access control.

```
Storage layout:
  /data/operators/
    op_a7f3/                             # alice-bot's partition
      messages.db (encrypted with alice-bot's keys)
      mls-state/
    op_b2c1/                             # research-bot's partition
      messages.db (encrypted with research-bot's keys)
      mls-state/
```

- **Operator keys** derive from the MLS group state for each conversation. Only the operator's inbox (which holds the MLS private key) can decrypt.
- **Admin cannot read operator messages** — admin credentials grant orchestration access (create operators, issue credentials, view metadata) but not decryption keys.
- **Owner holds root keys** but does not have ambient read access to operator messages.

### Privilege Elevation

An admin can request elevated access (e.g., read access to an operator's messages or search across operators). This requires owner approval via Secure Enclave biometric gate:

```
Flow:
  1. Admin requests elevation
  2. Signet creates a pending elevation request
  3. Owner is prompted for biometric confirmation (Touch ID / Face ID)
  4. On approval: admin receives a time-bound, scoped read credential
     - Logged in audit trail with timestamp, scope, approver
     - Credential expires (configurable TTL, short by default)
  5. On denial: request logged, admin notified, no access granted
```

Properties of elevated credentials:
- **Explicit** — requires a deliberate request, not implicit
- **Audited** — every elevation is logged (request, approval/denial, scope, expiry)
- **Time-bound** — the read credential expires automatically
- **Owner-approved** — biometric confirmation via Secure Enclave, cannot be bypassed
- **Scoped** — elevation grants access to specific operators/chats, not blanket access

Granting admin message read access requires an intentionally obnoxious flag:

```
xs cred issue --op lobster-bot \
  --dangerously-allow-message-read \
  --chat conv_9e2d
```

This triggers: biometric confirmation, audit log entry, seal republish with admin read access disclosed, time-bound expiry.

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
| Approve elevations | No | No | No | Yes (biometric) |

**Critical invariant**: no role — not even superadmin — grants ambient message read access. The Secure Enclave biometric gate is the only path to message content outside your own credentials.

## Seal Protocol

### Seal Chaining & Inline Diffs

Seals chain: each seal references its predecessor and embeds the full previous payload inline. This enables decentralized diffing — any client can see what changed without an external resolver.

```
Seal payload:
  sealId:     seal_f5g6
  previous:   { full previous seal payload }
  current:    { full current seal payload }
  delta:      { added: [reply], removed: [], changed: [] }
```

The delta field is convenience — computable from previous + current, but saves client work. The inline previous payload is the key design decision: XMTP chats are self-contained, so the history must travel with the message.

### Message-Seal Binding

Every message sent by a signet-managed operator includes a seal reference and signature:

```
Message metadata:
  sealRef:       seal_f5g6
  sealSignature: <sig over messageId + sealId using credential key>
```

Clients can verify:
- **Valid**: message signed under the current active seal — normal display
- **Superseded**: message signed under an older seal — "permissions have changed since this message"
- **Revoked**: message signed under a revoked seal — "this agent's access was revoked"
- **Missing**: no seal signature — not from a signet-managed agent

### Seal Transparency

Seals are the trust contract with group members. Every permission grant, scope restriction, and admin access level is disclosed:

```
Seal for alice-bot in "Design Team":
  Scope:        per-chat (isolated)
  Permissions:  send, react, reply
  Denied:       invite, manage-members
  Admin access: lobster-bot CAN read messages (expires 2026-03-24)
```

When admin access flags change, a new seal is published. No hidden surveillance.

### Automatic Republish

On any credential mutation (update, revoke, elevation), the seal is automatically republished to every chat the credential covers. The new seal chains to the previous one with an inline diff.

## Permission Scopes

Scopes used with `--allow` and `--deny` on credential issuance and updates. Deny-by-default: anything not explicitly allowed is denied.

### messaging — Sending content

| Scope | Description |
|-------|-------------|
| `send` | Send text/markdown messages |
| `reply` | Send reply messages (threaded) |
| `react` | Add or remove reactions |
| `read-receipt` | Send read receipts |
| `attachment` | Send file attachments (inline or remote) |

### group-management — Member operations

| Scope | Description |
|-------|-------------|
| `add-member` | Add members to a group |
| `remove-member` | Remove members from a group |
| `promote-admin` | Promote a member to admin |
| `demote-admin` | Remove admin status |
| `update-permission` | Modify group permission policies |

### metadata — Updating group properties

| Scope | Description |
|-------|-------------|
| `update-name` | Change group name |
| `update-description` | Change group description |
| `update-image` | Change group image URL |

### access — Joining, leaving, inviting

| Scope | Description |
|-------|-------------|
| `invite` | Generate invite links |
| `join` | Join a conversation via invite |
| `leave` | Leave a group |
| `create-group` | Create new group conversations |
| `create-dm` | Create new DM conversations |

### observation — Reading and streaming

| Scope | Description |
|-------|-------------|
| `read-messages` | Read messages in scoped conversations |
| `read-history` | Read message history from before credential issuance |
| `list-members` | List group members and admin roles |
| `list-conversations` | List available conversations |
| `view-permissions` | View group permission policies |
| `stream-messages` | Subscribe to real-time message streams |
| `stream-conversations` | Subscribe to new conversation events |

### egress — Content leaving the signet boundary

| Scope | Description |
|-------|-------------|
| `forward-to-provider` | Forward content to inference providers (LLMs) |
| `store-excerpts` | Persist message excerpts outside the signet |
| `use-for-memory` | Use content for persistent agent memory |
| `quote-revealed` | Quote revealed content in messages |
| `summarize` | Summarize hidden or revealed content |

**Key distinctions:**
- `read-messages` vs `read-history`: an agent might stream new messages but not scroll back to pre-credential history
- Egress scopes control what leaves the signet boundary — critical for privacy

## Resource IDs

All resources get a prefixed UUID. Shortened prefixes accepted everywhere — minimum chars needed for uniqueness.

| Resource | Prefix | Example |
|----------|--------|---------|
| Operator | `op_` | `op_a7f3b2c1` |
| Inbox | `inbox_` | `inbox_c3e5a1b7` |
| Conversation | `conv_` | `conv_9e2d4f8a` |
| Policy | `policy_` | `policy_c4d5e6f7` |
| Credential | `cred_` | `cred_b2c1d3e4` |
| Seal | `seal_` | `seal_f5g6h7i8` |
| Key | `key_` | `key_j9k0l1m2` |
| Message | `msg_` | `msg_n3o4p5q6` |

### Network ID Mapping

All XMTP network-sourced IDs are stored with an `xmtp_` prefix and mapped bidirectionally to local IDs:

- **Security** — local IDs in logs/output can't be correlated with network observation
- **Performance** — short, indexed, locally sequential IDs for database operations
- **Consistency** — every resource uses the same ID scheme
- **Interop** — `xmtp_` IDs accepted anywhere a local ID is, resolved transparently

```
xmtp_ → local mapping (SQLite):
  xmtp_abc123  →  msg_a7f3b2c1   (message)
  xmtp_def456  →  conv_9e2d4f8a  (conversation/chat)
  xmtp_ghi789  →  inbox_c3e5a1b7  (inbox)
```

### ID Resolution

Within a domain command, the prefix is optional — the command knows the resource type:
```
xs cred info a7f3                        # bare short ID (inferred as cred_)
xs cred info cred_a7f3                   # explicit prefix (also works)
xs operator info alice-bot               # by label
```

Cross-cutting commands require the prefix:
```
xs lookup cred_a7f3                      # prefix required (ambiguous context)
```

Ambiguous short IDs error with suggestions:
```
xs cred info a7                          # "Ambiguous: did you mean a7f3... or a7b2...?"
```

## Action Registry

The action registry is the foundation. Every operation is a registered action with a typed input schema, handler, and result type. Transport surfaces (CLI, HTTP, WS, MCP) are thin adapters over the same actions.

```
Action:
  id: "cred.issue"
  input: { operatorId, chatId, allow, deny, ttl }
  handler: (input, context) → Result<Credential, SignetError>
```

The same action is callable via:
- **CLI**: `xs cred issue --op alice-bot --chat conv_1 --allow send,react`
- **HTTP**: `POST /v1/actions/cred.issue { operatorId, chatId, allow, deny }`
- **Admin socket**: JSON-RPC `{ method: "cred.issue", params: { ... } }`
- **MCP**: Tool call with typed parameters
- **WebSocket**: Harness request frame

All transport adapters share the same input validation (Zod schemas), permission checks, and audit logging.

## CLI Surface

The CLI (`xs`) is the primary operator interface. Short commands, ergonomic flags, `--json` everywhere.

### Design Principles

1. **Short aliases** — `chat` not `conversation`, `msg` not `message`, `cred` not `credential`
2. **Flags over nesting** — `xs chat update <id> --name` not `xs chat update-name`
3. **`rm` for deletion, `--purge` for cleanup** — dry run by default, `--force` to execute
4. **`--to` / `--from` for targeting** — `xs msg send "text" --to <chat>`
5. **`--as` for inbox scoping** — which inbox am I acting as?
6. **`--op` for operator scoping** — which operator context? (alias: `--operator`)
7. **`--allow` / `--deny` for permissions** — explicit allowlist/denylist
8. **`--watch` for streaming** — flag on any list/status command
9. **`--json` everywhere** — machine-readable output
10. **`--only <field>` for filtering** — `xs chat info <id> --only members`

### Commands

#### Top-level

| Command | Description |
|---------|-------------|
| `xs init` | First-time signet setup (root key, admin key, default operator) |
| `xs setup` | Interactive guided walkthrough (alias for init) |
| `xs status` | Full signet overview: operators, inboxes, chats, credentials |
| `xs reset` | Destroy all signet data (dry run default, `--force`) |
| `xs update` | Update signet to latest version (`--check` for dry run) |
| `xs export` | Export signet data (passphrase required, `--op` for single operator, `--dangerously-export-unencrypted`) |
| `xs import <file>` | Import signet data (prompts for passphrase) |

#### Daemon

| Command | Description |
|---------|-------------|
| `xs daemon start` | Start the signet daemon |
| `xs daemon stop` | Stop the signet daemon |
| `xs daemon status` | Daemon process status (pid, uptime, ports) |
| `xs daemon token` | Generate admin JWT for socket auth |

#### Config

| Command | Description |
|---------|-------------|
| `xs config show` | Show active merged configuration |
| `xs config validate` | Validate configuration file |
| `xs config set <key> <value>` | Set a configuration value |

#### Operator

| Command | Description |
|---------|-------------|
| `xs operator create --label <name>` | Create operator (`--role`, `--provider`, `--wallet` flags) |
| `xs operator list` | List operators |
| `xs operator info <id>` | Show operator details and linked inboxes |
| `xs operator rename <id> --label <new>` | Change label (ID stable) |
| `xs operator rm <id>` | Remove operator (dry run, `--force`) |

#### Inbox

| Command | Description |
|---------|-------------|
| `xs inbox create --label <name>` | Create XMTP inbox (`--op <id>` to auto-link) |
| `xs inbox list` | List all managed inboxes |
| `xs inbox info <id>` | Show inbox details (`--network`, `--only`) |
| `xs inbox rm <id>` | Remove inbox (dry run, `--force`) |
| `xs inbox link <id> --op <id>` | Link inbox to operator |
| `xs inbox unlink <id>` | Unlink inbox from operator |

#### Chat

| Command | Description |
|---------|-------------|
| `xs chat create --name <name>` | Create group (`--as`, `--op` flags) |
| `xs chat list` | List conversations (`--op`, `--watch`) |
| `xs chat info <id>` | Show details (`--only members`, `--only permissions`, `--debug`) |
| `xs chat update <id>` | Update metadata (`--name`, `--description`, `--image`) |
| `xs chat sync [id]` | Sync from network (one or all) |
| `xs chat join <url>` | Join via invite URL (auto-creates inbox if per-chat scope) |
| `xs chat invite <id>` | Generate invite URL/QR |
| `xs chat leave <id>` | Leave group (`--purge` + `--force` for local data) |
| `xs chat rm <id>` | Remove local chat data (dry run, `--force`) |
| `xs chat member list <id>` | List members |
| `xs chat member add <id> <inbox>` | Add member |
| `xs chat member rm <id> <inbox>` | Remove member |
| `xs chat member promote <id> <inbox>` | Promote to admin |
| `xs chat member demote <id> <inbox>` | Demote from admin |

DMs: `xs msg send "text" --to <inbox-id-or-0x-address>` creates or finds DM implicitly.

#### Message

| Command | Description |
|---------|-------------|
| `xs msg send "text" --to <id>` | Send text (chat ID, inbox ID, or 0x address for DM) |
| `xs msg reply "text" --to <msg-id>` | Reply to a message |
| `xs msg react <emoji> --to <msg-id>` | React to a message |
| `xs msg read <msg-id>[,<msg-id>]` | Send read receipt(s) (`--chat <id> --all` for bulk) |
| `xs msg list --from <chat>` | List messages (`--watch` for live tail) |
| `xs msg info <msg-id>` | Single message details |
| `xs msg attach <file> --to <chat>` | Send file attachment (deferred) |
| `xs msg download <msg-id>` | Download attachment (deferred) |

All `msg` commands support `--as <inbox>` for explicit inbox selection. Inbox is inferred when unambiguous (one inbox in chat).

#### Policy

Policies are named, reusable bundles of permission rules. Credentials reference policies instead of (or in addition to) inline `--allow`/`--deny` scopes.

| Command | Description |
|---------|-------------|
| `xs policy create --label <name>` | Create policy (`--allow`, `--deny` scopes) |
| `xs policy list` | List all policies |
| `xs policy info <id>` | Show policy rules |
| `xs policy update <id>` | Update rules (`--allow`, `--deny`) |
| `xs policy rm <id>` | Remove policy (dry run, `--force`) |

Credentials can reference a policy, use inline scopes, or both (inline overrides, deny wins):
```
xs cred issue --op alice-bot --chat conv_1 --policy read-only-agent
xs cred issue --op bob-bot --chat conv_2 --policy support-bot --deny react
```

#### Credential

| Command | Description |
|---------|-------------|
| `xs cred issue --op <id> --chat <id>` | Issue credential (`--policy`, `--allow`, `--deny`) |
| `xs cred list` | List credentials (`--op`, `--watch`) |
| `xs cred info <id>` | Show credential details |
| `xs cred revoke <id>` | Revoke credential (`--purge` + `--force` to delete record) |
| `xs cred update <id>` | Update permissions (`--allow`, `--deny`) |

#### Seal

| Command | Description |
|---------|-------------|
| `xs seal list` | List active seals |
| `xs seal info <id>` | Show seal details |
| `xs seal verify <id>` | Run verification pipeline |
| `xs seal history <cred-id>` | Show seal chain for a credential |

#### Wallet

Wallets are the source material — BIP-39 mnemonics that derive all key material. Managed by the signet (`internal` provider) or by external OWS tools (`ows` provider).

| Command | Description |
|---------|-------------|
| `xs wallet list` | List all wallets (internal + external OWS) |
| `xs wallet info <id>` | Wallet details, provider, derived accounts |
| `xs wallet provider set <name> --path <path>` | Configure a wallet provider (e.g., OWS vault path) |
| `xs wallet provider list` | List configured providers |

#### Key

Keys are what the signet derives from wallets and uses for specific purposes: XMTP identity registration, seal signing, credential token binding.

| Command | Description |
|---------|-------------|
| `xs key init` | Initialize key hierarchy from a wallet |
| `xs key rotate` | Derive next operational key |
| `xs key list` | Show all derived keys by tier (identity, operational, credential) |
| `xs key info <id>` | Key details, purpose, backing wallet |

#### Logs

| Command | Description |
|---------|-------------|
| `xs logs` | Tail audit log (`--watch`, `--since`, `--limit`) |
| `xs logs export` | Full runtime state dump |

#### Lookup

| Command | Description |
|---------|-------------|
| `xs lookup <address-or-id>` | Query XMTP network (registration, installations, reachability) |

Resolves `xmtp_` network IDs to local IDs and vice versa.

#### Search

| Command | Description |
|---------|-------------|
| `xs search <query>` | Search message content (local DB, scoped to operator/credential) |

Flags: `--chat`, `--inbox`, `--op`, `--sender`, `--since`, `--before`, `--limit`

#### Schema

| Command | Description |
|---------|-------------|
| `xs schema` | List all commands with summaries |
| `xs schema <command>` | Full JSON schema for a command |

#### Consent

| Command | Description |
|---------|-------------|
| `xs consent check <entity>` | Check consent state (`--as <inbox>`) |
| `xs consent allow <entity>[,<entity>]` | Allow entities (batch or `--from <file>`) |
| `xs consent deny <entity>[,<entity>]` | Deny entities (batch or `--from <file>`) |
| `xs consent list` | List pending/unknown entities (reserved for future) |

### Global Flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--json` | | Machine-readable JSON output |
| `--watch` | | Poll/stream for changes |
| `--as <inbox>` | | Act as specific inbox |
| `--op <id>` | `--operator` | Scope to operator |
| `--config <path>` | | Config file path |
| `--only <field>` | | Filter output to specific field |
| `--force` | | Execute destructive operations |
| `--purge` | | Also clean up associated data |
| `--allow <scopes>` | | Grant specific permissions |
| `--deny <scopes>` | | Explicitly block specific permissions |
| `--provider <name>` | | Wallet provider (`internal` or `ows`) |
| `--wallet <id>` | | Backing wallet for an operator |
| `--policy <id>` | | Policy to apply to a credential |

## Test Strategy

### Security Boundary Tests

Every access boundary in the access matrix needs a deterministic test that proves the boundary holds.

#### Role Isolation Tests

```
TEST: operator cannot create other operators
  1. Create operator alice-bot (role: operator)
  2. As alice-bot, attempt xs operator create --label evil-bot
  3. Assert: permission denied

TEST: operator cannot issue credentials
  1. Create operator alice-bot (role: operator)
  2. As alice-bot, attempt xs cred issue --op alice-bot --chat conv_1
  3. Assert: permission denied

TEST: admin can only manage own operators
  1. Create admin-a (role: admin)
  2. Admin-a creates operator alice-bot
  3. Create admin-b (role: admin)
  4. Admin-b creates operator bob-bot
  5. As admin-a, attempt xs cred revoke on bob-bot's credential
  6. Assert: permission denied
  7. As admin-a, xs cred revoke on alice-bot's credential
  8. Assert: success

TEST: superadmin can manage any operator
  1. Create admin-a (role: admin), creates alice-bot
  2. Create super (role: superadmin)
  3. As super, xs cred revoke on alice-bot's credential
  4. Assert: success
```

#### Message Access Boundary Tests

```
TEST: admin cannot read operator messages
  1. Create admin (role: admin)
  2. Admin creates alice-bot, issues credential for conv_1
  3. Alice-bot sends message to conv_1
  4. As admin, attempt xs msg list --from conv_1
  5. Assert: permission denied

TEST: superadmin cannot read operator messages
  1. Create super (role: superadmin)
  2. Super creates alice-bot, issues credential for conv_1
  3. Alice-bot sends message to conv_1
  4. As super, attempt xs msg list --from conv_1
  5. Assert: permission denied

TEST: superadmin can read after owner-approved elevation
  1. Create super (role: superadmin)
  2. Alice-bot sends message to conv_1
  3. Super requests elevation for alice-bot's conv_1
  4. Owner approves (mock biometric gate)
  5. As super (with elevation cred), xs msg list --from conv_1
  6. Assert: success, messages visible

TEST: elevation credential expires
  1. Create elevation with short TTL
  2. Wait for expiry
  3. Attempt xs msg list with expired elevation
  4. Assert: permission denied

TEST: elevation is audited
  1. Request and approve elevation
  2. xs logs --limit 5
  3. Assert: audit log contains elevation request, approval, scope, expiry
```

#### Storage Isolation Tests

```
TEST: operator databases are cryptographically separated
  1. Create alice-bot and bob-bot with separate credentials
  2. Both send messages to their respective chats
  3. Directly read alice-bot's messages.db with bob-bot's keys
  4. Assert: decryption fails

TEST: rm operator purges encrypted storage
  1. Create alice-bot, send messages
  2. xs operator rm alice-bot --force
  3. Assert: operator data directory no longer exists
```

#### Credential Scope Tests

```
TEST: credential scoped to one chat cannot access another
  1. Issue credential for alice-bot scoped to conv_1 only
  2. As alice-bot, xs msg send "hello" --to conv_1
  3. Assert: success
  4. As alice-bot, xs msg send "hello" --to conv_2
  5. Assert: permission denied

TEST: deny overrides allow
  1. Issue credential with --allow send,react --deny send
  2. Attempt xs msg send
  3. Assert: permission denied (deny wins)

TEST: credential expiry blocks access
  1. Issue credential with short TTL
  2. Wait for expiry
  3. Attempt xs msg send
  4. Assert: credential expired
```

#### Per-Chat Scope Isolation Tests

```
TEST: per-chat operator cannot cross-pollinate
  1. Create alice-bot (scope: per-chat)
  2. Alice-bot joins conv_1 (gets inbox_a) and conv_2 (gets inbox_b)
  3. As alice-bot in conv_1 context, attempt xs msg list --from conv_2
  4. Assert: permission denied

TEST: shared scope operator can access multiple chats
  1. Create research-bot (scope: shared)
  2. Research-bot joins conv_1 and conv_2 (same inbox)
  3. xs msg list --from conv_1, xs msg list --from conv_2
  4. Assert: both succeed

TEST: seal communicates scope mode
  1. Create per-chat operator, join chat
  2. xs seal info on the published seal
  3. Assert: seal contains scope: "per-chat"
```

### Test Infrastructure

All security boundary tests run against a real signet instance (not mocks) using:
- In-memory SQLite for speed
- Mock biometric gate (accepts/rejects programmatically)
- `env: local` to skip XMTP network (tests are about the signet's access model)
- Deterministic UUIDs for reproducibility
- Each test creates its own operator/credential/chat graph from scratch

## Not in Scope

- `conversation explode` — Convos-specific destruction
- `conversation lock/unlock` — Convos-specific join prevention
- `update-profile` / `profiles` — per-conversation display names (Convos-specific)
- `agent serve` — replaced by `xs daemon start`

## Resolved Design Decisions

- **Inbox inference on msg send** — infer when unambiguous (one inbox in chat), require `--as` when multiple
- **Search** — local decrypted DB only, scoped to operator/credential
- **DM support** — `xs msg send --to <inbox-or-0x-address>` creates/finds DM implicitly
- **Admin role** — permission level on operator (`--role operator/admin/superadmin`), not separate resource
- **Permission scopes** — 30 scopes across 6 categories
- **Destructive operations** — `rm` for deletion, `--purge` for cleanup, dry run by default, `--force` to execute
- **Admin message access** — requires `--dangerously-allow-message-read`, biometric gate, seal disclosure
- **Credential composition** — per-chat operators get one credential per chat. Shared operators can span or split.
- **Seal updates** — automatic republish on credential mutation, inline chaining with previous payload
- **Message-seal binding** — messages signed with active seal ref, clients verify provenance
- **Admin queue** — deferred. Credentials have `status` field for future approval workflows.

## Future Work

- [ ] Approval queue: credentials issued as `pending`, require approval to activate
- [ ] XIP proposal for seal content type with inline chaining and client-side diff rendering
- [ ] XIP proposal for message-seal binding metadata extension
- [ ] Attachment support (`xs msg attach` / `xs msg download`)
