# xmtp-signet

Agent signet for XMTP. The signet is the real XMTP client: it owns the signer,
encrypted storage, message sync, and transport surfaces. Agent harnesses never
touch raw credentials, raw databases, or the XMTP SDK directly. They connect
through a controlled interface with scoped credentials, policy-based permission
sets, and public seals that disclose what an agent can do.

## Why a signet?

Without a signet, an XMTP agent is usually a full client: it holds wallet
material, stores the encrypted database, and can read or send anything the raw
SDK allows. Any "read-only" or "limited" permissions are advisory because the
harness already has the keys.

The signet makes those limits real:

- The **signet** owns the XMTP client, signer material, and encrypted state.
- The **harness** only receives the conversations, actions, and tools its
  active credential allows.
- **Seals** published into chats make the agent's scope and permissions visible
  to other participants.

This moves agents from opaque trust to inspectable trust.

## Core concepts

| Concept                      | What it is                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------- |
| **Signet**                   | Trusted runtime boundary that owns the real XMTP client and key material          |
| **Owner / Admin / Operator** | Role hierarchy for who approves, manages, and acts                                |
| **Policy**                   | Reusable permission bundle with allow/deny scopes (30 scopes across 6 categories) |
| **Credential**               | Time-bound, chat-scoped authorization issued to an operator                       |
| **Seal**                     | Signed, group-visible declaration of an operator's current permissions and scope  |
| **Projection**               | Four-stage filtering pipeline that determines what a harness sees                 |
| **Reveal**                   | Explicit mechanism for surfacing hidden content (5 granularities)                 |

See [docs/concepts.md](docs/concepts.md) for the full model.

## Architecture

```text
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
```

Dependencies flow downward only. Domain logic is transport agnostic: handlers
receive typed input and return `Result<T, E>`, never throw.

See [docs/architecture.md](docs/architecture.md) for the runtime, transport,
event model, and connection lifecycle details.

## Packages

| Package                    | Layer      | Purpose                                                                                                        |
| -------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| `@xmtp/signet-schemas`     | Foundation | Zod schemas, inferred types, resource IDs, permission scopes, error taxonomy                                   |
| `@xmtp/signet-contracts`   | Foundation | Service interfaces, handler contract, authored action specs, derivation/validation, surface maps, wire formats |
| `@xmtp/signet-core`        | Runtime    | XMTP client lifecycle, identity store, conversation and message streaming                                      |
| `@xmtp/signet-keys`        | Runtime    | Key backend, encrypted vault, admin auth, BIP-39/44 derivation, key rotation                                   |
| `@xmtp/signet-sessions`    | Runtime    | Credential lifecycle, reveal state, pending actions, materiality checks                                        |
| `@xmtp/signet-seals`       | Runtime    | Seal issuance, chaining, signing, revocation, auto-republish with retry                                        |
| `@xmtp/signet-policy`      | Runtime    | Scope resolution, projection pipeline, reveal enforcement, content type filtering                              |
| `@xmtp/signet-verifier`    | Runtime    | Multi-check verification pipeline for signet trust                                                             |
| `@xmtp/signet-ws`          | Transport  | WebSocket transport with sequenced frames, replay, and reconnection                                            |
| `@xmtp/signet-mcp`         | Transport  | MCP transport for credential-scoped tool access                                                                |
| `@xmtp/signet-sdk`         | Client     | TypeScript harness SDK with typed events and Result-based requests                                             |
| `@xmtp/signet-cli`         | Transport  | `xs` CLI, daemon lifecycle, admin socket, contract-driven HTTP admin/action surface                            |
| `@xmtp/signet-integration` | Test       | Cross-package integration tests and fixtures                                                                   |

## Quick start

**Requirements:** [Bun](https://bun.sh) 1.2.9+

```bash
# Clone and bootstrap
git clone https://github.com/xmtp/xmtp-signet.git
cd xmtp-signet
bun run bootstrap

# Build and verify
bun run build
bun run check
```

### Run the signet

```bash
# Create a local XMTP identity and key hierarchy with the recommended posture
xs init --env dev --label owner

# Use the lower-ceremony trusted local posture for smoke testing
xs init trusted-local --env dev --label owner

# Use the stricter hardened posture for shorter-lived defaults and explicit approval gates
xs init hardened --env production --label owner

# Start the daemon
xs daemon start

# Inspect live state
xs status --json

# Create an operator
xs operator create --label alice-bot --role operator --scope per-chat

# Issue a credential scoped to a conversation
xs cred issue --op alice-bot --chat conv_9e2d1a4b8c3f7e60 \
  --policy support-bot --allow send,reply --deny invite

# Inspect that credential
xs cred info cred_b2c1

# Create a conversation
xs chat create --name "Design Team"

# Send a message
xs msg send "Hello from the signet" --to conv_9e2d1a4b8c3f7e60

# Create a reusable policy
xs policy create --label chatty --allow send,reply
```

`xs cred ...` is the canonical v1 lifecycle surface. Credential metadata
includes the scoped conversations and effective allow/deny sets directly.

### `xs init` posture presets

`xs init` now supports a small set of onboarding postures so first-run setup can
stay simple without collapsing the custody boundary:

| Command                 | Posture                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `xs init`               | Recommended default: per-chat isolation with owner-gated sensitive reads               |
| `xs init trusted-local` | Trusted local testing: shared identity mode and lower ceremony                         |
| `xs init hardened`      | Stricter approval defaults, shorter-lived credentials, stronger operational boundaries |

All three presets keep the signet as the real XMTP client. They do not hand raw
keys, raw databases, or direct XMTP SDK access to the harness.

See [docs/development.md](docs/development.md) for the development workflow and
package layout.

## CLI commands

| Group                 | Commands                                                                    |
| --------------------- | --------------------------------------------------------------------------- |
| top-level             | `init`, `status`, `reset`, `logs`, `lookup`, `search`, `consent`            |
| `daemon`              | `start`, `stop`, `status`                                                   |
| `operator`            | `create`, `list`, `info`, `rename`, `rm`                                    |
| `cred`                | `issue`, `list`, `info`, `revoke`, `update`                                 |
| `chat`                | `create`, `list`, `info`, `update`, `sync`, `join`, `invite`, `leave`, `rm` |
| `chat ... member`     | `list`, `add`, `rm`, `promote`, `demote`                                    |
| `msg`                 | `send`, `reply`, `react`, `read`, `list`, `info`                            |
| `policy`              | `create`, `list`, `info`, `update`, `rm`                                    |
| `seal` _(deferred)_   | `list`, `info`, `verify`, `history`                                         |
| `wallet` _(deferred)_ | `list`, `info`, `provider set`, `provider list`                             |
| `key` _(deferred)_    | `init`, `rotate`, `list`, `info`                                            |

## What's working

- 13-package workspace with 800+ tests and cross-package integration coverage
- Owner/Admin/Operator/Credential/Seal identity model with role levels
- BIP-39/44 key derivation with OWS-compatible encrypted vault (Keystore v3)
- 30 permission scopes across 6 categories with deny-wins resolution
- Three-tier content type allowlists with default-deny for unknown types
- Four-stage message projection pipeline with six visibility states
- Five-granularity reveal system (message, thread, sender, content-type,
  time-window)
- Seal chaining with inline diffs, message-seal binding, TTL-based renewal,
  and materiality-gated refresh
- Automatic seal republish with exponential backoff retry
- Action confirmation for sensitive operations
- WebSocket transport with sequenced frames, credential replay buffer, and
  reconnection recovery
- MCP transport with credential-scoped tool surfaces and reveal workflows
- TypeScript harness SDK with typed events and automatic reconnection
- CLI daemon with admin socket and HTTP admin API
- Multi-check verifier pipeline (source, build, signing, chain, schema)
- Group-visible liveness signals via `xmtp.org/agentLiveness:1.0`
- Real XMTP connectivity, group creation, invites, and membership management
- End-to-end tracer bullets validated on XMTP devnet

## Documentation

| Document                                     | Covers                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| [docs/concepts.md](docs/concepts.md)         | Identity model, permissions, scopes, seals, projection, reveals        |
| [docs/architecture.md](docs/architecture.md) | Package tiers, handler contract, event model, connection lifecycle     |
| [docs/security.md](docs/security.md)         | Key hierarchy, vault, threat model, access matrix, privilege elevation |
| [docs/development.md](docs/development.md)   | Setup, conventions, testing, CLI usage                                 |
| [CLAUDE.md](CLAUDE.md)                       | Agent-specific repo guidance                                           |

Design docs:

- Product requirements: [.agents/docs/init/xmtp-signet.md](.agents/docs/init/xmtp-signet.md)
- v1 architecture plan: [.agents/plans/v1/v1-architecture.md](.agents/plans/v1/v1-architecture.md)
- OWS/key backend plan: [.agents/plans/v1/ows-integration.md](.agents/plans/v1/ows-integration.md)

## Contributing

This project uses:

- **Bun** as the runtime and package manager
- **TypeScript** in strict mode with maximum safety
- **Exported API doc coverage** enforced by `bun run docs:check`
- **TDD**: write the test before the code
- **Result types**: functions that can fail return `Result<T, E>`, not exceptions
- **Conventional commits**: `feat(scope):`, `fix(scope):`, `test(scope):`
- **Stacked PRs** via [Graphite](https://graphite.dev)

See [docs/development.md](docs/development.md) for setup and workflow details.
