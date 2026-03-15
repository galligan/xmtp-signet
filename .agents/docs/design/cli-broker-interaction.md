# CLI/Broker Interaction Design

**Status:** Draft
**Updated:** 2026-03-14

## Overview

The xmtp-broker is a daemon that owns the XMTP client, keys, sessions, grants, and WebSocket server. The CLI is the primary human interface for operating and administering the broker. It is not a wrapper around the existing `@xmtp/cli` binary -- it shares the same SDK (`@xmtp/node-sdk`) and uses the broker's own Zod schemas and handler contract.

Three interaction modes define how different actors reach the broker:

1. **Harness mode** -- agent runtimes connect via WebSocket with session tokens and grants.
2. **Admin mode** -- operators manage the broker via CLI commands routed through the daemon's Unix socket.
3. **Direct mode** -- developers run one-shot commands without a daemon for testing and scripting.

The daemon is the default model. CLI commands first try the running daemon's socket; if no daemon is available, qualifying commands fall back to a one-shot client.

## Interaction Modes

### Harness Mode

Agent runtimes connect to the broker over WebSocket (and eventually MCP, HTTP). The harness authenticates with a session token issued by the broker and operates within the bounds of its view and grant.

| Aspect | Detail |
|--------|--------|
| Transport | WebSocket (v0), MCP (Phase 2), HTTP (Phase 3) |
| Auth | Session token (JWT signed by session key) |
| Scope | View + Grant define what the harness can see and do |
| Key type | Session key (ephemeral, in-memory) |
| Capabilities | Send/receive messages within view, react, use tools -- all per grant |

The harness never touches inbox keys, the XMTP database, or the MLS key schedule. The broker enforces all policy before forwarding requests to the XMTP client.

### Admin Mode

Operators manage the broker through CLI commands that connect to the daemon's Unix socket. Admin commands manage sessions, revoke grants, inspect state, rotate keys, and control the daemon lifecycle.

| Aspect | Detail |
|--------|--------|
| Transport | Unix domain socket |
| Auth | Admin key pair or local socket peer credentials |
| Scope | Broker administration -- no message access |
| Key type | Admin key (separate from inbox keys) |
| Capabilities | Daemon lifecycle, session management, grant revocation, key rotation, state inspection |

Admin commands do not require grants or sessions. They authenticate via a separate admin key pair, or via Unix socket peer credentials (uid-based auth for local-only operation).

### Direct Mode

Developers and scripts run CLI commands without a running daemon. The CLI spins up a one-shot XMTP client, executes the command, and exits. This is a convenience for development and testing -- not for production.

| Aspect | Detail |
|--------|--------|
| Transport | In-process (no socket) |
| Auth | Raw XMTP keys (from env or keyfile) |
| Scope | Full XMTP access -- no broker policy enforcement |
| Key type | Inbox key (raw) |
| Capabilities | Everything the XMTP SDK supports, no sessions/grants/attestations |

Direct mode is explicitly lower-security than daemon mode. It exists because spinning up a full daemon for `xmtp-broker message send "hello"` during development is unnecessary friction.

## Key Separation Model

Admin keys and inbox keys serve fundamentally different purposes and must never be conflated.

### Why Separate Keys?

The broker's security model depends on a clear boundary: the inbox key controls XMTP identity and message operations; the admin key controls broker operations. Conflating them would mean anyone who can restart the daemon can also impersonate the agent or read message content.

Think of it like a database: the DBA manages users, permissions, and backups but does not automatically see application data.

### Key Capabilities

| Operation | Inbox Key | Admin Key |
|-----------|:---------:|:---------:|
| Send messages | Yes | No |
| Receive/decrypt messages | Yes | No |
| Join/leave groups | Yes | No |
| Sign attestations | Yes | No |
| Start/stop daemon | No | Yes |
| Issue sessions | No | Yes |
| Revoke sessions/grants | No | Yes |
| Rotate operational keys | No | Yes (triggers, does not hold) |
| Inspect broker state | No | Yes |
| View session metadata | No | Yes |
| Read message content | Yes | No |

### Key Hierarchy (Existing)

The broker already implements a three-tier key hierarchy:

```
Root Key (hardware-bound or encrypted at rest)
  |
  +-- Operational Key (Ed25519, per-identity or per-group)
  |     Used for XMTP signing, attestation signing
  |
  +-- Session Key (ephemeral, in-memory)
        Used for JWT signing, harness auth
```

Admin keys sit outside this hierarchy. They are a separate key pair used exclusively for broker administration:

```
Admin Key (Ed25519 or local socket auth)
  |
  +-- Daemon lifecycle commands
  +-- Session/grant management
  +-- Key rotation triggers
  +-- State inspection
```

The admin key can _trigger_ a key rotation, but it never holds or derives the inbox key material. The rotation is performed by the broker runtime using the root key.

## Command Taxonomy

Commands are grouped by domain concept. Each group maps to the broker's service interfaces (`BrokerCore`, `SessionManager`, `AttestationManager`, etc.).

### `broker` -- Daemon Lifecycle

```bash
xmtp-broker start                    # Start daemon (foreground)
xmtp-broker start --daemon           # Start daemon (background, PID file)
xmtp-broker stop                     # Graceful shutdown via socket
xmtp-broker status                   # Daemon status, uptime, connected sessions
xmtp-broker config show              # Show active configuration
xmtp-broker config validate          # Validate config file without starting
```

All `broker` commands except `start` require a running daemon. `start` is the only command that does not connect to the socket.

### `identity` -- Inbox/Client Management

```bash
xmtp-broker identity init            # Create new XMTP identity + key hierarchy
xmtp-broker identity info            # Show inbox ID, installation ID, key fingerprints
xmtp-broker identity rotate-keys     # Rotate operational keys (admin auth required)
xmtp-broker identity export-public   # Export public key material for verification
```

`identity init` works in direct mode (no daemon needed). All others require the daemon.

### `session` -- Session Lifecycle

```bash
xmtp-broker session list             # List active sessions with metadata
xmtp-broker session inspect <id>     # Show session details: view, grant, timestamps
xmtp-broker session revoke <id>      # Revoke a session (admin auth required)
xmtp-broker session issue            # Issue a new session token (admin auth required)
```

All session commands require the daemon and admin auth.

### `grant` -- Grant Management

```bash
xmtp-broker grant list               # List grants across active sessions
xmtp-broker grant inspect <id>       # Show grant details and effective permissions
xmtp-broker grant revoke <id>        # Revoke a specific grant
```

All grant commands require the daemon and admin auth.

### `attestation` -- Attestation Lifecycle

```bash
xmtp-broker attestation list         # List attestations by group or agent
xmtp-broker attestation inspect <id> # Show attestation content, signatures, chain
xmtp-broker attestation verify <id>  # Run 6-check verification on an attestation
xmtp-broker attestation revoke <id>  # Revoke and publish revocation to group
```

All attestation commands require the daemon. `verify` and `inspect` may work with reduced functionality in direct mode if given raw attestation data.

### `message` -- Message Operations

```bash
xmtp-broker message send <group> "text"   # Send a message through the broker
xmtp-broker message list <group>          # List recent messages in a group
xmtp-broker message stream <group>        # Stream messages (long-running)
```

In daemon mode, message commands route through the broker's policy engine and respect the active session's view and grant. In direct mode, they use the raw XMTP client with no policy filtering.

### `conversation` -- Conversation Operations

```bash
xmtp-broker conversation list               # List conversations/groups
xmtp-broker conversation info <group>        # Show group metadata and members
xmtp-broker conversation create              # Create a new group
xmtp-broker conversation add-member <group>  # Add a member to a group
```

In daemon mode, these operations go through the broker. In direct mode, they use the raw SDK.

### `admin` -- Administrative Operations

```bash
xmtp-broker admin verify-keys        # Verify key hierarchy integrity
xmtp-broker admin export-state       # Export broker state for debugging
xmtp-broker admin audit-log          # Show admin action audit trail
```

Admin commands always require the daemon and admin auth. They are separated from other groups because they operate on the broker itself, not on XMTP concepts.

### Mode Availability Summary

| Command Group | Daemon (Admin) | Daemon (Harness) | Direct Mode |
|---------------|:--------------:|:-----------------:|:-----------:|
| `broker`      | Yes            | --                | `start` only |
| `identity`    | Yes            | --                | `init` only |
| `session`     | Yes            | --                | No          |
| `grant`       | Yes            | --                | No          |
| `attestation` | Yes            | --                | Partial     |
| `message`     | Yes            | Yes (via session) | Yes (raw)   |
| `conversation`| Yes            | Partial           | Yes (raw)   |
| `admin`       | Yes            | --                | No          |

## Daemon Lifecycle

### Startup

```bash
xmtp-broker start [--daemon] [--config <path>]
```

1. Load and validate configuration (Zod schema).
2. Initialize key hierarchy (root -> operational). Fail if vault is missing and no `--init` flag.
3. Start XMTP client, sync groups.
4. Open Unix domain socket for admin commands.
5. Start WebSocket server for harness connections.
6. Write PID file to `$XDG_RUNTIME_DIR/xmtp-broker/broker.pid`.
7. Emit `broker.started` event.

### Socket and PID Conventions

| File | Path |
|------|------|
| PID file | `$XDG_RUNTIME_DIR/xmtp-broker/broker.pid` |
| Admin socket | `$XDG_RUNTIME_DIR/xmtp-broker/admin.sock` |
| WebSocket | `0.0.0.0:8765` (configurable) |

On macOS, `$XDG_RUNTIME_DIR` defaults to `$TMPDIR` if unset. The CLI checks for the PID file and socket to determine if a daemon is running before falling back to direct mode.

### Shutdown

```bash
xmtp-broker stop [--timeout <ms>]
```

1. Send `SIGTERM` via socket (or signal if PID file).
2. Broker drains active WebSocket connections (configurable timeout, default 5s).
3. Revoke all active session keys (in-memory, no persistence needed).
4. Close XMTP client gracefully.
5. Remove PID file and socket.
6. Exit 0.

### Health Check

```bash
xmtp-broker status
```

Returns structured output (JSON with `--json` flag):

- Daemon state (running, draining, stopped)
- Uptime
- Active sessions count
- Active WebSocket connections
- XMTP client sync status
- Key hierarchy health (fingerprints, rotation timestamps)

### macOS launchctl Integration (Phase 2)

A `launchd` plist enables automatic daemon startup:

```bash
xmtp-broker install-service           # Install launchd plist
xmtp-broker uninstall-service         # Remove launchd plist
```

Plist goes to `~/Library/LaunchAgents/com.xmtp.broker.plist`. The broker runs as the current user, not as root.

## Transport Architecture

The CLI is a thin transport adapter over the same handler contract used by WebSocket. Every CLI command maps to the same flow:

```
CLI input
  |
  v
Parse args (oclif or similar)
  |
  v
Validate with Zod schema
  |
  v
Route to handler
  |
  v
Handler returns Result<T, E>
  |
  v
Format output (table, JSON, or text)
  |
  v
Exit code (0 = success, 1+ = error category)
```

### Handler Contract

All domain logic uses the existing transport-agnostic handler signature:

```typescript
type Handler<TInput, TOutput, TError extends BrokerError> = (
  input: TInput,
  ctx: HandlerContext,
) => Promise<Result<TOutput, TError>>;
```

The CLI adapter constructs `HandlerContext` differently depending on mode:

| Mode | Context Source |
|------|---------------|
| Daemon (admin) | Admin key auth via Unix socket |
| Daemon (harness) | Session token via WebSocket |
| Direct | One-shot XMTP client, no session |

### Exit Codes

Map error categories to exit codes for scriptability:

| Category | Exit Code |
|----------|-----------|
| Success | 0 |
| Validation | 1 |
| Auth | 2 |
| Permission | 3 |
| Not found | 4 |
| Timeout | 5 |
| Internal | 10 |
| Cancelled | 130 (SIGINT convention) |

### Output Formatting

All commands support `--json` for machine-readable output. Default is human-readable tables/text. Errors go to stderr, data goes to stdout. This makes the CLI composable with `jq` and other Unix tools.

## Direct Mode Fallback

When a CLI command runs and no daemon is detected (no PID file, no socket response), qualifying commands fall back to direct mode.

### Behavior

1. CLI checks for `$XDG_RUNTIME_DIR/xmtp-broker/admin.sock`.
2. If socket exists and responds to health check, route command through daemon.
3. If no socket or health check fails:
   a. If command supports direct mode (see availability table), spin up a one-shot `@xmtp/node-sdk` client.
   b. If command requires daemon, exit with error and a message like: `Broker daemon is not running. Start it with: xmtp-broker start`

### One-Shot Client

The direct mode client:

- Reads XMTP key material from environment or keyfile (same source as `xmtp-broker identity init`).
- Creates a temporary `@xmtp/node-sdk` Client instance.
- Executes the command handler directly (in-process, no socket).
- Tears down the client and exits.

### Limitations

Direct mode intentionally lacks broker features:

| Feature | Daemon Mode | Direct Mode |
|---------|:-----------:|:-----------:|
| Policy enforcement | Yes | No |
| Session/grant system | Yes | No |
| Attestation publishing | Yes | No |
| Concurrent harness connections | Yes | No |
| Key hierarchy (three-tier) | Yes | Partial (root key only) |
| Audit logging | Yes | No |
| Message streaming | Yes | Yes (but blocks process) |

Direct mode is for development, debugging, and one-off scripting. It should never be the production operating mode.

## Migration Path

Today the CLI is a standalone binary: `xmtp-broker`. The eventual target is a subcommand of the official `@xmtp/cli`: `xmtp broker`.

### Current State (v0)

- 9 runtime packages (schemas through WebSocket transport).
- No CLI package yet.
- `@xmtp/node-sdk` integration planned but not yet wired into `packages/core`.

### Phase 2: Broker CLI (`@xmtp-broker/cli`)

Built with Commander.js on Bun. Commander is lightweight, well-documented, and composes cleanly with the broker's existing Zod schemas for argument validation.

```typescript
// packages/cli/src/index.ts
import { program } from "commander";

program
  .name("xmtp-broker")
  .description("Agent broker for XMTP")
  .version("0.1.0");

// Each command group is a separate module
program.addCommand(createBrokerCommand());   // start, stop, status
program.addCommand(createSessionCommand());  // list, inspect, revoke
program.addCommand(createMessageCommand());  // send, list, stream
// ...

program.parse();
```

Each command module follows the same pattern: parse args → validate with Zod → call handler → format output → exit code. The handler layer is shared with WebSocket transport.

### Future: `xmtp broker` Subcommand

Eventually the broker CLI merges into `@xmtp/cli` as a subcommand namespace (`xmtp broker start`, `xmtp broker session list`, etc.). The `@xmtp/cli` is oclif-based; integration would require either an oclif plugin wrapper or a coordinated migration. This is a future concern -- the standalone `xmtp-broker` binary comes first.

### What Needs to Happen

| Step | Owner | Notes |
|------|-------|-------|
| Build `@xmtp-broker/cli` with Commander | Broker team | Phase 2 |
| Implement daemon lifecycle (start/stop/socket) | Broker team | Phase 2 |
| Implement admin key system | Broker team | Phase 2 |
| Wire `@xmtp/node-sdk` into `packages/core` | Broker team | Phase 2 |
| Coordinate namespace with `@xmtp/cli` team | Both teams | Future |
| Decide on integration model (plugin vs merge) | XMTP org | Future |

## Open Questions

1. **Admin auth mechanism.** Local socket peer credentials (uid-based) are simplest for single-machine deployments. A separate admin key pair is needed for remote administration. Do we support both, and if so, which is the default?

2. **Config file format and location.** TOML? JSON? YAML? Where does the config live -- `~/.config/xmtp-broker/config.toml`, `$XDG_CONFIG_HOME`, or project-local?

3. ~~**CLI framework choice.**~~ Decided: Commander.js. Lightweight, Bun-compatible, composes well with Zod for argument validation.

4. **Direct mode key source.** Environment variables (`XMTP_PRIVATE_KEY`), a keyfile, or a prompt? The existing `@xmtp/cli` uses `.env` files. We should decide on a convention that doesn't encourage raw keys in shell history.

5. **Session issuance via CLI.** When an admin issues a session via CLI (`xmtp-broker session issue`), how is the session token delivered to the harness? Printed to stdout? Written to a file? Sent via a side channel?

6. **Streaming output.** `message stream` and `conversation stream` are long-running. How do they interact with `--json` mode -- newline-delimited JSON? Server-sent events? This affects scriptability.

7. **Multi-identity support.** The broker may eventually manage multiple XMTP identities. How does the CLI select which identity to operate on? `--identity <id>` flag? Config-level default?

8. **Remote admin.** The design assumes local Unix socket admin. If remote administration is needed (e.g., broker running on a server), do we support admin over TLS, or is that always a separate API surface?

9. **Audit trail persistence.** Admin commands should be logged. Where? Local file? Structured log? Forwarded to an external system? What's the minimum viable audit trail for v0?

10. **CLI package location.** `@xmtp-broker/cli` as a separate package in the broker monorepo (`packages/cli/`). Follows the existing package convention and keeps CLI concerns isolated from runtime packages.
