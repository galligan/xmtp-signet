---
name: xmtp-admin
description: >
  Administer an xmtp-signet as an orchestrating agent or owner — bootstrap
  the daemon, initialize and rotate keys, create managed wallets, create and
  remove operators, define policies, issue and revoke credentials, create
  and link managed inboxes, verify seals and walk seal history, and drive
  the privileged `xs` command surface that sets agents up to operate
  against the signet. Use this skill whenever someone asks how to set up a
  signet for agents, how to issue or revoke a credential, how to provision
  an operator with a scoped policy, how to rotate or export operator keys,
  how to link an inbox to an operator, how to verify a seal chain, or how
  to run privileged admin flows. For day-to-day agent use (messaging,
  reading, inspecting credentials and seals, harness connection), use the
  `xmtp` skill.
---

# Administering xmtp-signet

> [!IMPORTANT]
> You are the **orchestrator**. You set things up so *other* agents can
> operate through the signet safely. You do not hold raw message content,
> and you cannot read operator messages without an explicit, owner-approved
> elevation. Every flow below leans on that boundary — the signet enforces
> it structurally, not by policy alone.

> [!NOTE]
> The current runtime model is v1: owner, admin, operator, credential,
> seal. The public CLI is credential-native.

**Companion skill:** for the conceptual model (owner/admin/operator/
credential/seal, projection pipeline, event types, harness lifecycle) and
for day-to-day agent use (messaging, inspecting, harness connection), use
the `xmtp` skill. This skill focuses on the *privileged* half of the CLI.

## Trust boundary at a glance

```text
Owner      -> anchors trust, approves owner-gated operations (biometric)
Admin      -> manages operators, credentials, policies, inboxes, keys
Operator   -> conversational agent profile (per-chat or shared)
Credential -> time-bound, chat-scoped, policy-driven authorization
Seal       -> public declaration of operator scope in a chat
```

You will spend most of your time at the Admin layer, occasionally asking
the Owner to approve something that requires elevation.

## Bootstrap

### First-run init

```bash
xs init --env dev --label owner
```

Creates the local key hierarchy, writes a config when needed, sets
`defaults.profileName` from `--label` if it's still unset.

Presets:

- `xs init` — recommended defaults
- `xs init trusted-local` — shared identity mode, lower ceremony for local
  smoke tests
- `xs init hardened` — stricter gates, shorter-lived defaults

Run `xs init --help` for the current preset deltas.

### Daemon lifecycle

```bash
xs daemon start
xs daemon status
xs daemon stop
xs status --json          # scheme, identity mode, network, connected inboxes
xs reset                  # wipe local state — destructive
```

### Agent-setup helpers

```bash
xs agent setup            # interactive bootstrap for a new operator+cred
xs agent status
xs agent doctor           # diagnose keys, daemon, credential, seal health
```

Use `agent setup` for happy-path provisioning and `agent doctor` as the
first thing you run when something feels off.

## Keys

Keys are per-operator. `xs key init` is not redundant with `xs init` —
`xs init` sets up the owner/admin hierarchy and daemon; `xs key init`
provisions key material for a specific operator profile.

```bash
xs key init --op op_...                   # create key material for an operator
xs key rotate --op op_...                 # operational rotation, chain preserved
xs key list
xs key info --op op_...
xs key export-public --op op_...          # safe: public material only
```

Key material lives in the local encrypted vault. The Swift `signet-signer`
CLI in `signet-signer/` handles Secure Enclave operations on macOS when
available.

**Never** export, paste, or log raw private material. The CLI doesn't
surface it; if you find yourself reaching for it, stop and reconsider.

## Wallets

Managed wallets back operator identities.

```bash
xs wallet create --label ops-wallet
xs wallet list
xs wallet info wallet_...
xs wallet provider         # provider management — currently the deferred piece
```

`wallet provider` is the one surface that isn't fully live. Everything else
in `wallet` and `key` is.

## Operators

```bash
xs operator create --label "support-bot" --scope per-chat
xs operator list
xs operator info op_...
xs operator rename op_... --label "support-bot-v2"
xs operator rm op_...
```

Scope choices:

- `per-chat` — isolated state per conversation (default, strongest
  isolation)
- `shared` — one context across multiple chats

Role levels (set at creation or via update where supported):

- `operator` — can only act within its own credentials
- `admin` — can manage operators and resources it created
- `superadmin` — can manage anything, but still cannot read messages
  without owner-approved elevation

## Policies

Policies are reusable allow/deny bundles over the 30 permission scopes
(categories: `messaging`, `group-management`, `metadata`, `access`,
`observation`, `egress`).

```bash
xs policy create --name "helper" --allow send,reply,react
xs policy list
xs policy info  policy_...
xs policy update policy_... --deny forward-to-provider
xs policy rm policy_...
```

Design rule of thumb:

- **helper/chat bot** — allow `send`, `reply`, `react`; deny
  `group-management`
- **observer / summarizer** — allow `read-messages`, `stream-messages`;
  deny all `egress` scopes (`forward-to-provider`, `store-excerpts`,
  `use-for-memory`)
- **research assistant with LLM egress** — allow observation scopes and
  `forward-to-provider` explicitly; keep `read-history` deliberate

Deny always wins. When in doubt, deny and add back.

## Credentials

`xs cred` is the canonical credential lifecycle surface. A credential binds
operator + chat scope + effective permission set (policy + inline
overrides) + content-type allowlist + TTL + status.

```bash
# Issue
xs cred issue \
  --op op_a7f3 \
  --chat conv_9e2d1a4b8c3f7e60 \
  --policy policy_helper \
  --allow send,reply \
  --ttl 24h

# Inspect
xs cred list
xs cred list --op op_a7f3
xs cred info cred_b2c1

# Adjust (in place where possible)
xs cred update cred_b2c1 --deny forward-to-provider
xs cred update cred_b2c1 --extend 12h

# Revoke
xs cred revoke cred_b2c1 --reason "project ended"
```

### When an update reconnects the harness vs when it doesn't

Not every credential change requires reconnection.

- **In place, no reconnect** — narrowing scopes, adjusting the content-
  type allowlist, extending a reveal
- **Reauthorization required** — expanding scopes, adding egress
  permissions, granting group management

On reauth the signet emits `credential.reauthorization_required` and
terminates the connection. The harness should re-auth with a fresh token.

### Revocation publishes a public seal

`xs cred revoke` terminates the WebSocket connection *and* publishes a
`xmtp.org/agentRevocation:1.0` seal to affected chats. The revocation is
public by design — participants can see that the operator no longer has
scope.

## Managed inboxes

Inboxes are the daemon-backed mailbox surface for operators.

```bash
xs inbox create --label qa-inbox
xs inbox list
xs inbox info inbox_...
xs inbox link   inbox_... --operator op_...
xs inbox unlink inbox_... --operator op_...
xs inbox rm     inbox_...
```

`inbox` complements the direct bootstrap path exposed through `xs init`.
Link is how you attach an inbox to an operator for ongoing use.

## Seal verification and history

`xs seal list` and `xs seal info` are covered in the `xmtp` skill. The
admin-side verification flows:

```bash
xs seal verify seal_...         # Ed25519 signature + chain integrity
xs seal history --chat conv_... # full chain with deltas, including revocations
```

Verification checks:

- source availability
- build provenance
- release signing
- seal signature validity
- seal chain integrity (predecessor IDs, monotonic timestamps)
- schema compliance

Trust tiers surfaced on seals: `source-verified` (hardware-backed root
key) or `unverified` (software vault).

## Owner-gated elevations

Some flows require the human owner to unlock through a biometric gate.
Common triggers:

- reading projected message content as an admin (not ambient)
- approving actions for credentials that require confirmation
- approving certain rotations or key exports that exceed operational scope

Ordinary admin auth is **not** ambient message access. The dangerous-
looking flag on search/message-inspection flows isn't theatre — it's
asking the daemon to request or reuse a short-lived, chat-scoped admin
read elevation:

```bash
xs search "incident" --type messages --dangerously-allow-message-read
xs msg list --from conv_... --dangerously-allow-message-read
```

Don't paper over the noise — it's the mechanism telling you that this
call is crossing a boundary.

## Typical orchestration flows

### Stand up a new helper agent from scratch

```bash
# 1. Admin layer should already exist (xs init done once)
xs daemon status

# 2. Provision an operator profile
xs operator create --label "helper" --scope per-chat
xs key init --op op_helper
xs key export-public --op op_helper   # share with chat participants if needed

# 3. Define (or reuse) a policy
xs policy create --name "helper" --allow send,reply,react

# 4. Attach an inbox
xs inbox create --label helper-inbox
xs inbox link inbox_helper --operator op_helper

# 5. Issue a credential for the chat
xs cred issue --op op_helper --chat conv_... --policy policy_helper --ttl 24h

# 6. Hand the credential token to the harness; it connects via WebSocket
```

### Rotate an operator's key without breaking continuity

```bash
xs key rotate --op op_...             # operational rotation, seal chain preserved
xs seal history --chat conv_...       # confirm the new seal was stamped
```

### End a credential

```bash
xs cred revoke cred_... --reason "project ended"
xs seal history --chat conv_...       # revocation seal is now on-chain
```

### Expand scopes mid-run

```bash
xs cred update cred_... --allow forward-to-provider
# Expect a credential.reauthorization_required event — harness must
# reconnect with a fresh token.
```

## Safety posture

- **No raw keys flow through the CLI.** If you're being asked to paste
  private material, something is wrong — stop and verify.
- **Revocation is public.** Expect participants to see the revocation
  seal. Use `--reason` thoughtfully.
- **Deny wins.** Prefer additive policies with narrow defaults.
- **Elevation is opt-in.** Never normalize `--dangerously-allow-message-
  read` in scripts; each use is a deliberate crossing.
- **Keep operators scoped.** Per-chat is the default for a reason.

## Error taxonomy

Handler failures use the shared categories from
`@xmtp/signet-schemas`:

| Category      | When                                                   |
| ------------- | ------------------------------------------------------ |
| `validation`  | Input fails schema validation or a business rule       |
| `not_found`   | Resource does not exist                                |
| `permission`  | Caller lacks the required scope                        |
| `auth`        | Invalid or expired admin token or credential           |
| `internal`    | Unexpected runtime failure                             |
| `timeout`     | Operation exceeded its deadline                        |
| `cancelled`   | Operation cancelled via abort signal                   |

`auth` in v1 generally means an invalid/expired admin token or credential;
`permission` means authenticated but out of scope.

## When in doubt

`xs --help`, `xs <group> --help`, and `xs <group> <command> --help` are
the authoritative surface. If flags or options here look stale, trust
the help output and flag it.
