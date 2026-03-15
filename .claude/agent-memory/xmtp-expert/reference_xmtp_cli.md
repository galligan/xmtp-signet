---
name: xmtp-cli reference
description: Full command surface, auth model, output format, and key management for the official @xmtp/cli package
type: reference
---

## Package

- npm: `@xmtp/cli` (v0.2.0, beta)
- bin: `xmtp`
- Source: `.reference/xmtp-js/packages/xmtp-cli/`
- Framework: oclif v4
- Node SDK dependency: `@xmtp/node-sdk` 5.4.0

## Command Topics (4 topics)

### Top-level commands

- `xmtp init` — generate wallet + db encryption keys, write to `~/.xmtp/.env`
- `xmtp can-message <address...>` — check if addresses are XMTP-reachable (no client needed)
- `xmtp address-authorized <address>` — check if an address is authorized to an inbox
- `xmtp installation-authorized <installation-id>` — check installation authorization
- `xmtp inbox-states <inbox-id...>` — query inbox states for given inbox IDs
- `xmtp revoke-installations` — revoke all other installations (top-level shortcut)

### client topic — identity + installation management

- `client info` — wallet address, inboxId, installationId, registration status, SDK versions
- `client inbox-id` — show inbox ID only
- `client sign <message>` — sign a message with wallet private key
- `client verify-signature <message> --signature <sig>` — verify a signature
- `client add-account --new-wallet-key <key>` — add a wallet to this inbox
- `client remove-account --identifier <address>` — remove a wallet from this inbox
- `client revoke-installations -i <id>...` — revoke specific installation IDs
- `client revoke-all-other-installations` — revoke all except current
- `client key-package-status` — show key package status
- `client change-recovery-identifier` — change the recovery identifier

### conversations topic — list/create/stream (plural)

- `conversations list` — list all conversations
- `conversations get <id>` — get a conversation by ID
- `conversations create-dm <address>` — create a DM
- `conversations get-dm <address>` — get existing DM with an address
- `conversations create-group <address...> --name --description --image-url --permissions` — create group
- `conversations get-message <message-id>` — get message by ID
- `conversations stream --type (dm|group)` — stream new conversations
- `conversations stream-all-messages --type --consent-state --timeout --count --disable-sync` — stream all messages across all conversations
- `conversations sync-all` — sync all conversations
- `conversations hmac-keys` — show HMAC keys

### conversation topic — per-conversation ops (singular)

**Messages:**
- `conversation messages <id> --sync --limit` — read messages
- `conversation send-text <id> <text>` — send plain text
- `conversation send-markdown <id> <text>` — send markdown
- `conversation send-reply <id> <message-id> <text>` — send reply
- `conversation send-reaction <id> <message-id> add|remove <emoji>` — send reaction
- `conversation send-read-receipt <id>` — send read receipt
- `conversation publish-messages <id>` — publish unpublished messages
- `conversation count-messages <id>` — count messages
- `conversation stream <id>` — stream new messages in a conversation
- `conversation sync <id>` — sync a conversation

**Members:**
- `conversation members <id>` — list members with permission levels
- `conversation add-members <id> <address...>` — add members
- `conversation remove-members <id> <address...>` — remove members
- `conversation add-admin <id> <inbox-id>` — grant admin
- `conversation remove-admin <id> <inbox-id>` — revoke admin
- `conversation add-super-admin <id> <inbox-id>` — grant super admin
- `conversation remove-super-admin <id> <inbox-id>` — revoke super admin
- `conversation list-admins <id>` — list admins
- `conversation list-super-admins <id>` — list super admins
- `conversation request-removal <id>` — request to be removed from group

**Group metadata:**
- `conversation update-name <id> <name>` — rename group
- `conversation update-description <id> <text>` — update description
- `conversation update-image-url <id> <url>` — update image URL

**Permissions:**
- `conversation permissions <id>` — show permission policies
- `conversation update-permission <id> --type (add-member|remove-member|add-admin|remove-admin|update-metadata) --policy (allow|deny|admin|super-admin) [--metadata-field]`

**Consent:**
- `conversation consent-state <id>` — get consent state
- `conversation update-consent <id> --state (allowed|denied|unknown)` — set consent

**Debug:**
- `conversation debug-info <id>` — show internal debug info

### preferences topic

- `preferences get-consent` — get consent preferences
- `preferences set-consent --entity-type --entity --state` — set consent
- `preferences inbox-state` — show full inbox state
- `preferences inbox-states <inbox-id...>` — show multiple inbox states
- `preferences stream --timeout --count --disable-sync` — stream all preference changes (ConsentUpdate + HmacKeyUpdate)
- `preferences sync` — sync preferences

## Authentication / Identity Model

Authentication is entirely credential-based, no interactive wallet signing:

1. `xmtp init` generates a random Ethereum private key + 32-byte DB encryption key
2. Keys stored in `~/.xmtp/.env` as `XMTP_WALLET_KEY` and `XMTP_DB_ENCRYPTION_KEY`
3. Every client-creating command loads keys from env file (or flags)
4. Identity is an EOA signer created from the private key via viem `privateKeyToAccount`
5. No hardware wallet, no browser wallet, no interactive signing — plain hex private keys only

Config priority: CLI flags > `--env-file <path>` > `.env` in cwd > `~/.xmtp/.env`

## Key/Wallet Management

- Stored as hex private keys in `.env` files
- `XMTP_WALLET_KEY` — Ethereum private key, determines XMTP identity
- `XMTP_DB_ENCRYPTION_KEY` — 32-byte key for local MLS database encryption
- `XMTP_ENV` — `local | dev | production`
- Multiple wallets can be linked to one inbox via `client add-account`
- Installations can be revoked individually or all-at-once
- No daemon or key rotation — each invocation creates a fresh client from env

## Output Format

- Default: human-readable key-value tables (`formatHuman`, `formatSections`)
- `--json`: pretty JSON for single-value commands; JSONL (one JSON object per line) for streaming commands
- `XMTP_JSON_OUTPUT=true` env var enables JSON globally
- `--verbose`: shows client init details (address, inboxId, installationId, env, dbPath, libxmtpVersion, gatewayHost)
- When `--json` + `--verbose` are combined, verbose logs go to stderr, JSON to stdout

## Server/Daemon Mode

**None.** There is no server, daemon, or long-running service mode. Every command is a one-shot invocation that:
1. Creates a client
2. Runs the command
3. Exits

The streaming commands (`stream`, `stream-all-messages`, `preferences stream`) can run indefinitely until Ctrl+C, `--timeout`, or `--count` is reached — but they are not daemons, just blocking foreground processes.

## No daemon gaps relevant to broker design

The CLI has no:
- Server/daemon mode
- Multi-client management
- Session or grant system
- Plugin points for agent routing
- Request/response protocol beyond stdio
- Access control or scoping for multiple callers

These are exactly what the broker adds on top.

## BaseCommand flags (available on all commands that create a client)

`--env-file`, `--env`, `--gateway-host`, `--json`, `--verbose`,
`--wallet-key`, `--db-encryption-key`, `--db-path`, `--log-level`,
`--structured-logging`, `--disable-device-sync`, `--app-version`
