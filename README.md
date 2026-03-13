# xmtp-broker

Agent broker for XMTP. The broker is the real XMTP client — agent harnesses never touch raw credentials, databases, or signing keys. Instead, they connect through a controlled interface and receive a filtered **view** of conversations and a scoped **grant** of allowed actions.

> [!NOTE]
> This project is in active development. The broker runs on the XMTP devnet with real network connectivity, Convos interop, and a full CLI. APIs may still change.

## Why a broker?

Today, an XMTP agent typically runs as a full client: it holds wallet material, stores database encryption keys, and joins groups as a normal member. Any "read-only" or "limited" permissions are advisory — the harness has raw access to everything.

The broker model fixes this by introducing a real security boundary:

- **The broker** owns the XMTP signer, database, and message sync.
- **The agent harness** connects over a transport (WebSocket, MCP, CLI, HTTP) and only sees what its policy allows.
- **Attestations** published to the group make the agent's permissions inspectable by other participants.

This moves agents from **opaque trust** to **inspectable trust** — you can verify what an agent is allowed to do, not just take its word for it.

## Core concepts

| Concept         | What it is                                                                         |
| --------------- | ---------------------------------------------------------------------------------- |
| **Broker**      | Trusted runtime that owns the XMTP client, signer material, and encrypted database |
| **View**        | Policy-filtered projection of what an agent can see                                |
| **Grant**       | Structured description of what an agent can do                                     |
| **Attestation** | Signed, group-visible declaration of an agent's current permissions                |
| **Session**     | Ephemeral authorization context between harness and broker                         |

See [docs/concepts.md](docs/concepts.md) for the full conceptual model.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                         Transport                            │
│               WebSocket · MCP · CLI · HTTP                   │
├──────────────────────────────────────────────────────────────┤
│                          Runtime                             │
│  Core · Keys · Sessions · Attestations · Policy · Verifier   │
├──────────────────────────────────────────────────────────────┤
│                         Foundation                           │
│                    Schemas · Contracts                        │
└──────────────────────────────────────────────────────────────┘
```

Dependencies flow downward only. Domain logic is transport-agnostic — handlers receive typed input and return `Result<T, E>`, never throw.

See [docs/architecture.md](docs/architecture.md) for the full architecture guide.

## Packages

| Package                     | Layer      | Purpose                                                  |
| --------------------------- | ---------- | -------------------------------------------------------- |
| `@xmtp-broker/schemas`      | Foundation | Zod schemas, inferred types, error taxonomy              |
| `@xmtp-broker/contracts`    | Foundation | Service interfaces, provider contracts, wire formats     |
| `@xmtp-broker/core`         | Runtime    | XMTP client lifecycle, identity store, Convos protocol   |
| `@xmtp-broker/keys`         | Runtime    | Three-tier key hierarchy, encrypted vault, JWT auth      |
| `@xmtp-broker/sessions`     | Runtime    | Session lifecycle, token generation, policy dedup        |
| `@xmtp-broker/attestations` | Runtime    | Attestation lifecycle, chain management, signing         |
| `@xmtp-broker/policy`       | Runtime    | View projection pipeline, grant validation, materiality  |
| `@xmtp-broker/verifier`     | Runtime    | 6-check verification service for broker trust            |
| `@xmtp-broker/ws`           | Transport  | WebSocket transport with Bun.serve()                     |
| `@xmtp-broker/mcp`          | Transport  | MCP transport with session-scoped tools                  |
| `@xmtp-broker/handler`      | Transport  | TypeScript client SDK for harness developers             |
| `@xmtp-broker/cli`          | Transport  | CLI daemon, admin socket, 8 command groups               |
| `@xmtp-broker/integration`  | Test       | Cross-package integration tests and fixtures             |

## Quick start

**Requirements:** [Bun](https://bun.sh) 1.2.9+

```bash
# Clone and bootstrap
git clone https://github.com/xmtp/xmtp-broker.git
cd xmtp-broker
bun run bootstrap

# Build and test
bun run build
bun run test
```

### Run the broker

## Status

# Start the daemon
bun run packages/cli/src/bin.ts broker start

# Check status
bun run packages/cli/src/bin.ts broker status --json

# Create a group and invite someone
bun run packages/cli/src/bin.ts conversation create --name "test" --as my-agent
bun run packages/cli/src/bin.ts conversation invite <group-id> --as my-agent

# Issue a session for an agent harness
bun run packages/cli/src/bin.ts session issue --agent <inbox-id> --view @view.json --grant @grant.json
```

See [docs/development.md](docs/development.md) for the full development guide.

## CLI commands

| Group            | Commands                                              |
| ---------------- | ----------------------------------------------------- |
| `broker`         | `start`, `stop`, `status`                             |
| `identity`       | `init`, `list`                                        |
| `session`        | `issue`, `list`, `inspect`, `revoke`                  |
| `conversation`   | `create`, `list`, `info`, `join`, `invite`, `add-member`, `members` |
| `admin`          | `token`                                               |

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
- Attestation lifecycle with materiality detection and chain management
- 6-check verification service for broker trust anchoring
- MCP transport with session-scoped tools (infrastructure ready)
- TypeScript client SDK for harness developers
- End-to-end tracer bullets validated on XMTP devnet

## Design

For the complete product requirements document, see [.agents/docs/init/xmtp-broker.md](.agents/docs/init/xmtp-broker.md).

## Contributing

This project uses:

- **Bun** as the runtime and package manager
- **TypeScript** in strict mode with maximum safety
- **TDD** — write the test before the code
- **Result types** — functions that can fail return `Result<T, E>`, not exceptions
- **Conventional commits** — `feat(scope):`, `fix(scope):`, `test(scope):`
- **Stacked PRs** via [Graphite](https://graphite.dev)

See [docs/development.md](docs/development.md) for coding conventions and workflow details.
