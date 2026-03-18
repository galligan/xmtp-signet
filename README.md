# xmtp-signet

Agent signet for XMTP. The signet is the real XMTP client — agent harnesses never touch raw credentials, databases, or signing keys. Instead, they connect through a controlled interface and receive a filtered **view** of conversations and a scoped **grant** of allowed actions.

> [!NOTE]
> This project is in active development. The signet runs on the XMTP devnet with real network connectivity, Convos interop, and a full CLI. APIs may still change.

## Why a signet?

Today, an XMTP agent typically runs as a full client: it holds wallet material, stores database encryption keys, and joins groups as a normal member. Any "read-only" or "limited" permissions are advisory — the harness has raw access to everything.

The signet model fixes this by introducing a real security boundary:

- **The signet** owns the XMTP signer, database, and message sync.
- **The agent harness** connects over a transport (WebSocket, MCP, CLI, HTTP) and only sees what its policy allows.
- **Seals** published to the group make the agent's permissions inspectable by other participants.

This moves agents from **opaque trust** to **inspectable trust** — you can verify what an agent is allowed to do, not just take its word for it.

## Core concepts

| Concept     | What it is                                                                         |
| ----------- | ---------------------------------------------------------------------------------- |
| **Signet**  | Trusted runtime that owns the XMTP client, signer material, and encrypted database |
| **View**    | Policy-filtered projection of what an agent can see                                |
| **Grant**   | Structured description of what an agent can do                                     |
| **Seal**    | Signed, group-visible declaration of an agent's current permissions                |
| **Session** | Ephemeral authorization context between harness and signet                         |

See [docs/concepts.md](docs/concepts.md) for the full conceptual model.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                         Transport                            │
│               WebSocket · MCP · CLI · HTTP                   │
├──────────────────────────────────────────────────────────────┤
│                          Runtime                             │
│    Core · Keys · Sessions · Seals · Policy · Verifier        │
├──────────────────────────────────────────────────────────────┤
│                         Foundation                           │
│                    Schemas · Contracts                        │
└──────────────────────────────────────────────────────────────┘
```

Dependencies flow downward only. Domain logic is transport-agnostic — handlers receive typed input and return `Result<T, E>`, never throw.

See [docs/architecture.md](docs/architecture.md) for the full architecture guide.

## Packages

| Package                    | Layer      | Purpose                                                 |
| -------------------------- | ---------- | ------------------------------------------------------- |
| `@xmtp/signet-schemas`     | Foundation | Zod schemas, inferred types, error taxonomy             |
| `@xmtp/signet-contracts`   | Foundation | Service interfaces, provider contracts, wire formats    |
| `@xmtp/signet-core`        | Runtime    | XMTP client lifecycle, identity store, Convos protocol  |
| `@xmtp/signet-keys`        | Runtime    | Three-tier key hierarchy, encrypted vault, JWT auth     |
| `@xmtp/signet-sessions`    | Runtime    | Session lifecycle, token generation, policy dedup       |
| `@xmtp/signet-seals`       | Runtime    | Seal lifecycle, chain management, signing               |
| `@xmtp/signet-policy`      | Runtime    | View projection pipeline, grant validation, materiality |
| `@xmtp/signet-verifier`    | Runtime    | 6-check verification service for signet trust           |
| `@xmtp/signet-ws`          | Transport  | WebSocket transport with Bun.serve()                    |
| `@xmtp/signet-mcp`         | Transport  | MCP transport with session-scoped tools                 |
| `@xmtp/signet-sdk`         | Transport  | TypeScript client SDK for harness developers            |
| `@xmtp/signet-cli`         | Transport  | CLI daemon, admin socket, 8 command groups              |
| `@xmtp/signet-integration` | Test       | Cross-package integration tests and fixtures            |

## Quick start

**Requirements:** [Bun](https://bun.sh) 1.2.9+

```bash
# Clone and bootstrap
git clone https://github.com/xmtp/xmtp-signet.git
cd xmtp-signet
bun run bootstrap

# Build and verify
bun run build
bun run test
bun run check
```

### Run the signet

```bash
# Initialize an identity on devnet
xs identity init --env dev --label my-agent

# Start the daemon
xs start

# Check status
xs status --json

# Create a group and invite someone
xs conversation create --name "test" --as my-agent
xs conversation invite <group-id> --as my-agent

# Issue a session for an agent harness
xs session issue --agent <inbox-id> --view @view.json --grant @grant.json
```

See [docs/development.md](docs/development.md) for the full development guide.

## CLI commands

| Group          | Commands                                                            |
| -------------- | ------------------------------------------------------------------- |
| `start`        | Start the signet daemon                                             |
| `stop`         | Stop the signet daemon                                              |
| `status`       | Show signet status                                                  |
| `identity`     | `init`, `list`                                                      |
| `session`      | `issue`, `list`, `inspect`, `revoke`                                |
| `seal`         | `inspect`, `verify`, `history`                                      |
| `conversation` | `create`, `list`, `info`, `join`, `invite`, `add-member`, `members` |
| `admin`        | `token`                                                             |

## What's working

- 13 packages with comprehensive test coverage
- Three-tier key hierarchy (root, operational, session) with encrypted vault
- CLI daemon with admin socket and WebSocket transport
- Real XMTP network connectivity (devnet and production)
- Multiple identity registration and management
- Group creation, listing, membership management
- Convos invite protocol (generate, parse, verify, join)
- Session-scoped WebSocket with policy enforcement
- View projection pipeline with content-type filtering
- Grant validation across messaging, group management, tools, and egress
- Seal lifecycle with materiality detection and chain management
- 6-check verification service for signet trust anchoring
- MCP transport with session-scoped tools (infrastructure ready)
- TypeScript client SDK for harness developers
- End-to-end tracer bullets validated on XMTP devnet

## Design

For the complete product requirements document, see [.agents/docs/init/xmtp-signet.md](.agents/docs/init/xmtp-signet.md).

## Contributing

This project uses:

- **Bun** as the runtime and package manager
- **TypeScript** in strict mode with maximum safety
- **Exported API doc coverage** enforced by `bun run docs:check`
- **TDD** — write the test before the code
- **Result types** — functions that can fail return `Result<T, E>`, not exceptions
- **Conventional commits** — `feat(scope):`, `fix(scope):`, `test(scope):`
- **Stacked PRs** via [Graphite](https://graphite.dev)

See [docs/development.md](docs/development.md) for coding conventions and workflow details.
