# CLI Guide

This document describes the live `xs` command surface on `main`. For config
layout and path resolution, see [configuration.md](./configuration.md).

If `xs` is not already on your `PATH`, either:

- run the repo entrypoint directly with `bun packages/cli/src/bin.ts ...`, or
- install the wrapper script from `scripts/install.sh`

## Command Map

Top-level commands:

- `init`
- `status`
- `reset`
- `logs`
- `lookup`
- `search`
- `consent`

Command groups:

- `daemon` — daemon lifecycle
- `operator` — operator management
- `cred` — credential lifecycle
- `inbox` — managed inbox lifecycle and operator linking
- `chat` — conversation creation, invites, join flows, metadata, and members
- `msg` — send, reply, react, read, list, and inspect messages
- `policy` — reusable allow/deny bundles
- `seal` — inspect and verify seals
- `wallet` — managed wallet lifecycle
- `key` — key initialization, rotation, and public export

## First Run

`xs init` is the first-run entrypoint:

```bash
xs init --env dev --label owner
```

It creates the local key hierarchy, writes a config file when needed, and uses
the provided label as the default human-facing profile name if
`defaults.profileName` is still unset.

Supported presets:

- `xs init` — recommended defaults
- `xs init trusted-local` — shared identity mode and lower ceremony for local
  smoke tests
- `xs init hardened` — stricter gates and shorter-lived defaults

The precise preset deltas are documented in [configuration.md](./configuration.md).

## Common Workflows

### Inspect daemon state

```bash
xs status --json
```

The status payload includes the configured onboarding scheme, identity mode,
network state, and connected inbox IDs.

### Create a chat and immediately publish an invite

```bash
xs chat create \
  --name "Device Test" \
  --invite \
  --profile-name "Owner" \
  --format both
```

Notable `chat create` flags:

- `--invite` — immediately generate a Convos invite after chat creation
- `--profile-name` — publish a Convos profile update before invite output
- `--invite-name` / `--invite-description` — override invite display metadata
- `--format link|qr|both` — choose the output presentation

### Join a conversation via invite

```bash
xs chat join "<invite-url>" --as "alice-joined" --profile-name "Alice"
```

`chat join` accepts:

- `--as` — label for the new joined identity
- `--op` — operator ID to use for profile defaults
- `--profile-name` — explicit Convos profile name
- `--timeout` — join timeout in seconds

### Update a conversation profile

```bash
xs chat update-profile conv_1234 --profile-name "Alice"
```

The current onboarding flow is Convos-specific. Profile updates and snapshots
use the Convos content types and compatibility rules described in
[architecture/onboarding-schemes.md](./architecture/onboarding-schemes.md).

### Search and lookup

```bash
xs lookup op_alice
xs search "support escalation"
xs search "refund" --type messages --chat conv_1234 --as alice-bot
```

`search` can target:

- `messages`
- `resources`
- `operator`
- `policy`
- `credential`
- `conversation`

### Message reads that require local admin elevation

Some search or message-inspection flows need an explicit local admin read
elevation:

```bash
xs search "incident" --type messages --dangerously-allow-message-read
xs msg list --from conv_1234 --dangerously-allow-message-read
```

That flag is intentionally noisy. It asks the daemon to request or reuse a
short-lived, chat-scoped admin read elevation rather than treating ordinary
admin auth as ambient message access. See [security.md](./security.md) for the
full model.

### Managed inboxes

```bash
xs inbox create --label qa-inbox
xs inbox list
xs inbox link inbox_1234 --operator op_1234
```

`inbox` is the daemon-backed surface for managed inbox lifecycle. It complements
the direct bootstrap path exposed through `xs init`.

### Consent state

```bash
xs consent check inbox_abc
xs consent allow inbox_abc
xs consent deny inbox_abc
```

## Notes

- The user-facing invite and profile UX is currently Convos-shaped even though
  the internal runtime now resolves an onboarding scheme seam.
- `wallet provider` remains the deferred part of the wallet surface; the
  broader `wallet` and `key` groups are now live commands.
