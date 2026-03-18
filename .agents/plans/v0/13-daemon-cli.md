# 13-daemon-cli

**Package:** `@xmtp/signet-cli`
**Spec version:** 0.1.0

## Overview

The CLI package is the composition root and primary human interface for the xmtp-signet. It wires all runtime packages into a running daemon process and exposes 8 command groups for operating, administering, and debugging the broker. The CLI is a thin transport adapter over the same handler contract used by WebSocket -- every command maps to a handler that receives typed input and returns `Result<T, E>`.

The package serves three distinct roles:

1. **Daemon lifecycle** -- Start, stop, and monitor the broker process. The daemon owns the XMTP client, key hierarchy, session store, policy engine, WebSocket server, and admin socket.
2. **Admin transport** -- CLI commands connect to the daemon's Unix domain socket, send JSON-RPC 2.0 requests, and display results. This is the admin-facing counterpart to the WebSocket's harness-facing interface.
3. **Direct mode fallback** -- When no daemon is running, qualifying commands spin up a one-shot XMTP client for development and scripting, bypassing the session/grant/seal system entirely.

The binary name is `xmtp-broker`. Built with Commander.js on Bun, it composes cleanly with the broker's Zod schemas for argument validation and the existing error taxonomy for exit code mapping.

## Dependencies

**Imports:**
- `@xmtp/signet-contracts` -- `SignetCore`, `SessionManager`, `SealManager`, `CoreContext`, `HandlerContext`, `Handler`, `SignerProvider`, `CoreState`, `GroupInfo`, `SessionRecord`, `RawEvent` (canonical interface definitions)
- `@xmtp/signet-schemas` -- `SessionConfig`, `SessionToken`, `ViewConfig`, `GrantConfig`, `BrokerEvent`, error classes (`ValidationError`, `AuthError`, `InternalError`, `NotFoundError`, `PermissionError`, `TimeoutError`, `CancelledError`), `ErrorCategory`, `ERROR_CATEGORY_META`
- `@xmtp/signet-core` -- `SignetCore` implementation, `SignetCoreConfig`
- `@xmtp/signet-policy` -- `PolicyEngine`, view filtering, grant enforcement
- `@xmtp/signet-sessions` -- `SessionManager` implementation
- `@xmtp/signet-seals` -- `SealManager` implementation
- `@xmtp/signet-keys` -- `KeyManager`, `SignerProvider` implementation
- `@xmtp/signet-ws` -- `WsServer`, `WsServerConfig`
- `commander` -- CLI framework
- `smol-toml` -- TOML config parsing
- `better-result` -- `Result`, `ok`, `err`
- `zod` -- config and argument validation

**Imported by:** Nothing -- this is the top of the dependency graph, alongside `@xmtp/signet-ws`.

## Public Interfaces

### CLI Configuration

```typescript
const CliConfigSchema = z.object({
  /** Broker identity and XMTP settings. */
  broker: z.object({
    env: z.enum(["local", "dev", "production"]).default("dev")
      .describe("XMTP network environment"),
    identityMode: z.enum(["per-group", "shared"]).default("per-group")
      .describe("Identity isolation strategy"),
    dataDir: z.string().default("~/.local/share/xmtp-broker")
      .describe("Base directory for broker data"),
  }).default({}),

  /** Key management settings. */
  keys: z.object({
    rootKeyPolicy: z.enum(["biometric", "passcode", "open"]).default("biometric")
      .describe("Access control policy for root key"),
    operationalKeyPolicy: z.enum(["biometric", "passcode", "open"]).default("open")
      .describe("Access control policy for operational keys"),
  }).default({}),

  /** WebSocket server settings. */
  ws: z.object({
    port: z.number().int().positive().default(8393)
      .describe("WebSocket server port"),
    host: z.string().default("127.0.0.1")
      .describe("WebSocket server bind address"),
  }).default({}),

  /** Admin socket settings. */
  admin: z.object({
    socketPath: z.string().optional()
      .describe("Override admin socket path (default: $XDG_RUNTIME_DIR/xmtp-broker/admin.sock)"),
    authMode: z.literal("admin-key").default("admin-key")
      .describe("Admin authentication mode"),
  }).default({}),

  /** Session defaults. */
  sessions: z.object({
    defaultTtlSeconds: z.number().int().positive().default(3600)
      .describe("Default session TTL"),
    maxConcurrentPerAgent: z.number().int().positive().default(3)
      .describe("Maximum concurrent sessions per agent"),
    heartbeatIntervalSeconds: z.number().int().positive().default(30)
      .describe("Heartbeat interval for session liveness"),
  }).default({}),

  /** Logging and audit. */
  logging: z.object({
    level: z.enum(["debug", "info", "warn", "error"]).default("info")
      .describe("Log level"),
    auditLogPath: z.string().optional()
      .describe("Override audit log path (default: $XDG_STATE_HOME/xmtp-broker/audit.jsonl)"),
  }).default({}),
}).describe("CLI and daemon configuration");

type CliConfig = z.infer<typeof CliConfigSchema>;
```

### Resolved Paths

```typescript
/** All runtime-resolved paths the daemon uses. */
interface ResolvedPaths {
  readonly configFile: string;
  readonly dataDir: string;
  readonly pidFile: string;
  readonly adminSocket: string;
  readonly auditLog: string;
  readonly identityKeyFile: string;
}

/** Resolve all paths with XDG fallbacks. */
function resolvePaths(config: CliConfig): ResolvedPaths;
```

Path resolution follows XDG Base Directory conventions:

| Path | Default | XDG Override |
|------|---------|-------------|
| Config file | `~/.config/xmtp-broker/config.toml` | `$XDG_CONFIG_HOME/xmtp-broker/config.toml` |
| Data directory | `~/.local/share/xmtp-broker` | `$XDG_DATA_HOME/xmtp-broker` |
| PID file | `$TMPDIR/xmtp-broker/broker.pid` | `$XDG_RUNTIME_DIR/xmtp-broker/broker.pid` |
| Admin socket | `$TMPDIR/xmtp-broker/admin.sock` | `$XDG_RUNTIME_DIR/xmtp-broker/admin.sock` |
| Audit log | `~/.local/state/xmtp-broker/audit.jsonl` | `$XDG_STATE_HOME/xmtp-broker/audit.jsonl` |
| Vault | `~/.local/share/xmtp-broker/vault.db` | `$XDG_DATA_HOME/xmtp-broker/vault.db` |

On macOS, `$XDG_RUNTIME_DIR` defaults to `$TMPDIR` if unset.

### Broker Runtime

```typescript
/** The fully wired broker runtime returned by the composition root. */
interface BrokerRuntime {
  readonly core: SignetCore;
  readonly sessionManager: SessionManager;
  readonly attestationManager: SealManager;
  readonly keyManager: KeyManager;
  readonly policyEngine: PolicyEngine;
  readonly wsServer: WsServer;
  readonly adminServer: AdminServer;
  readonly config: CliConfig;
  readonly paths: ResolvedPaths;

  /** Start all services in dependency order. */
  start(): Promise<Result<void, SignetError>>;

  /** Graceful shutdown in reverse dependency order. */
  shutdown(): Promise<Result<void, SignetError>>;

  /** Current lifecycle state. */
  readonly state: DaemonState;
}

type DaemonState =
  | "created"
  | "starting"
  | "running"
  | "draining"
  | "stopped"
  | "error";
```

### Admin Server (Unix Socket)

```typescript
const AdminServerConfigSchema = z.object({
  socketPath: z.string()
    .describe("Path to Unix domain socket"),
  authMode: z.literal("admin-key").default("admin-key")
    .describe("Authentication mode for admin connections"),
  requestTimeoutMs: z.number().int().positive().default(30_000)
    .describe("Timeout for admin request handling"),
}).describe("Admin server configuration");

type AdminServerConfig = z.infer<typeof AdminServerConfigSchema>;

interface AdminServer {
  /** Start listening on the Unix domain socket. */
  start(): Promise<Result<void, InternalError>>;

  /** Stop the admin server. */
  stop(): Promise<Result<void, InternalError>>;

  /** Current server state. */
  readonly state: "idle" | "listening" | "stopped";
}

interface AdminServerDeps {
  readonly runtime: BrokerRuntime;
  readonly auditLog: AuditLog;
}

function createAdminServer(
  config: AdminServerConfig,
  deps: AdminServerDeps,
): AdminServer;
```

### Admin Client (CLI Side)

```typescript
/** Client for CLI commands to communicate with the daemon. */
interface AdminClient {
  /** Send a JSON-RPC request and receive a response. */
  request<T>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<Result<T, SignetError>>;

  /** Check if the daemon is reachable. */
  ping(): Promise<Result<DaemonStatus, SignetError>>;

  /** Close the connection. */
  close(): void;
}

function createAdminClient(socketPath: string): AdminClient;
```

### Daemon Status

```typescript
const DaemonStatusSchema = z.object({
  state: z.enum(["running", "draining", "stopped"])
    .describe("Current daemon state"),
  pid: z.number().int().positive()
    .describe("Daemon process ID"),
  uptime: z.number().nonneg()
    .describe("Uptime in seconds"),
  activeSessions: z.number().int().nonneg()
    .describe("Number of active sessions"),
  activeConnections: z.number().int().nonneg()
    .describe("Number of active WebSocket connections"),
  xmtpEnv: z.enum(["local", "dev", "production"])
    .describe("XMTP network environment"),
  identityMode: z.enum(["per-group", "shared"])
    .describe("Identity isolation strategy"),
  wsPort: z.number().int().positive()
    .describe("WebSocket server port"),
  version: z.string()
    .describe("Broker version string"),
}).describe("Daemon status response");

type DaemonStatus = z.infer<typeof DaemonStatusSchema>;
```

### Audit Log

```typescript
const AuditEntrySchema = z.object({
  timestamp: z.string().datetime()
    .describe("ISO 8601 timestamp"),
  action: z.string()
    .describe("Action performed (e.g., session.issue, grant.revoke)"),
  actor: z.enum(["admin", "system"])
    .describe("Who performed the action"),
  target: z.string().optional()
    .describe("Resource ID acted upon"),
  detail: z.record(z.unknown()).optional()
    .describe("Additional context"),
  success: z.boolean()
    .describe("Whether the action succeeded"),
}).describe("Audit log entry");

type AuditEntry = z.infer<typeof AuditEntrySchema>;

interface AuditLog {
  /** Append an entry to the audit log. */
  append(entry: AuditEntry): Promise<void>;

  /** Read the last N entries. */
  tail(count: number): Promise<readonly AuditEntry[]>;
}

function createAuditLog(filePath: string): AuditLog;
```

### JSON-RPC Protocol

```typescript
/** JSON-RPC 2.0 request over admin socket. */
const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
}).describe("JSON-RPC 2.0 request");

type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

/** JSON-RPC 2.0 success response. */
const JsonRpcSuccessSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  result: z.unknown(),
}).describe("JSON-RPC 2.0 success response");

type JsonRpcSuccess = z.infer<typeof JsonRpcSuccessSchema>;

/** JSON-RPC 2.0 error response. */
const JsonRpcErrorSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  error: z.object({
    code: z.number().int(),
    message: z.string(),
    data: z.record(z.unknown()).optional(),
  }),
}).describe("JSON-RPC 2.0 error response");

type JsonRpcError = z.infer<typeof JsonRpcErrorSchema>;
```

### Command Action Mapping

Each CLI command maps to a JSON-RPC method name. The admin server consumes ActionSpecs from the shared `ActionRegistry` (spec 10) -- the same registry used by MCP and WebSocket. Admin-specific ActionSpecs include a `CliSurface` with the method name, and the admin socket uses `ActionRegistry.listForSurface("cli")` to discover available commands.

```typescript
/** Admin socket dispatch uses the shared ActionRegistry from spec 10. */
function createAdminDispatcher(
  registry: ActionRegistry,
): AdminDispatcher;

interface AdminDispatcher {
  /** Dispatch a JSON-RPC method to the matching ActionSpec handler. */
  dispatch(
    method: string,
    params: Record<string, unknown>,
    ctx: HandlerContext,
  ): Promise<Result<unknown, SignetError>>;
}
```

The dispatcher looks up the ActionSpec by mapping the JSON-RPC method name (e.g., `session.list`) to the ActionSpec's `CliSurface.rpcMethod` (dot-delimited). If `rpcMethod` is not set, the dispatcher derives it from `CliSurface.command` by replacing `:` with `.`. No separate registry.

### Method Name Convention

JSON-RPC methods use dot-delimited names matching the CLI command structure:

| CLI Command | JSON-RPC Method |
|-------------|----------------|
| `broker status` | `broker.status` |
| `broker config show` | `broker.config.show` |
| `broker config validate` | `broker.config.validate` |
| `identity info` | `identity.info` |
| `identity rotate-keys` | `identity.rotateKeys` |
| `identity export-public` | `identity.exportPublic` |
| `session list` | `session.list` |
| `session inspect <id>` | `session.inspect` |
| `session revoke <id>` | `session.revoke` |
| `session issue` | `session.issue` |
| `grant list` | `grant.list` |
| `grant inspect <id>` | `grant.inspect` |
| `grant revoke <id>` | `grant.revoke` |
| `seal list` | `seal.list` |
| `seal inspect <id>` | `seal.inspect` |
| `seal verify <id>` | `seal.verify` |
| `seal revoke <id>` | `seal.revoke` |
| `message send <group> <text>` | `message.send` |
| `message list <group>` | `message.list` |
| `message stream <group>` | `message.stream` |
| `conversation list` | `conversation.list` |
| `conversation info <group>` | `conversation.info` |
| `conversation create` | `conversation.create` |
| `conversation add-member <group>` | `conversation.addMember` |
| `admin verify-keys` | `admin.verifyKeys` |
| `admin export-state` | `admin.exportState` |
| `admin audit-log` | `admin.auditLog` |

### Output Formatting

```typescript
type OutputFormat = "human" | "json";

interface OutputOptions {
  readonly format: OutputFormat;
  readonly verbose: boolean;
  readonly quiet: boolean;
}

/** Format a Result for CLI output. */
function formatResult<T>(
  result: Result<T, SignetError>,
  options: OutputOptions,
  formatter: (value: T) => string,
): string;

/** Format a SignetError for CLI output. */
function formatError(
  error: SignetError,
  options: OutputOptions,
): string;

/** Map an error category to a CLI exit code. */
function exitCodeFromCategory(category: ErrorCategory): number;
```

The `exitCodeFromCategory` function reads from `ERROR_CATEGORY_META` in `@xmtp/signet-schemas`, which maps categories to exit codes. This is the single source of truth -- the CLI does not maintain its own exit code table.

### Direct Mode Client

```typescript
const DirectModeConfigSchema = z.object({
  env: z.enum(["local", "dev", "production"]).default("dev")
    .describe("XMTP network environment"),
  dataDir: z.string().optional()
    .describe("Data directory containing the vault"),
}).describe("Direct mode configuration");

type DirectModeConfig = z.infer<typeof DirectModeConfigSchema>;

/** Create a one-shot XMTP client for direct mode. */
function createDirectClient(
  config: DirectModeConfig,
): Promise<Result<DirectClient, SignetError>>;

interface DirectClient {
  /** The underlying XMTP client (raw access, no policy). */
  readonly xmtpClient: Client;

  /** Tear down the client and clean up. */
  close(): Promise<void>;
}
```

Direct mode accesses key material exclusively through the vault, which is unlocked by the hardware-bound root key (Secure Enclave on macOS). No raw keys are ever exposed via environment variables, keyfiles, or CLI arguments. The vault path is resolved from the data directory (`$XDG_DATA_HOME/xmtp-broker/` or `~/.local/share/xmtp-broker/`).

This means Secure Enclave integration (spec 07) is a hard dependency for the CLI, not a nice-to-have. Direct mode cannot function without the vault unlock path.

## Zod Schemas

All new schemas are defined above. This package imports existing schemas from `@xmtp/signet-schemas` (error taxonomy, session types, view/grant configs) and `@xmtp/signet-contracts` (service interfaces).

Schemas defined in this package:

- `CliConfigSchema` -- Full daemon configuration
- `AdminServerConfigSchema` -- Admin socket configuration
- `DaemonStatusSchema` -- Health check response
- `AuditEntrySchema` -- Audit log entry format
- `JsonRpcRequestSchema`, `JsonRpcSuccessSchema`, `JsonRpcErrorSchema` -- JSON-RPC 2.0 wire formats
- `DirectModeConfigSchema` -- Direct mode client configuration

## Behaviors

### Daemon Lifecycle State Machine

```
  createBrokerRuntime()
         |
         v
  ┌──────────┐
  │ created  │
  └────┬─────┘
       | start()
       v
  ┌──────────┐   initialization failure    ┌────────┐
  │ starting │ ─────────────────────────>  │ error  │
  └────┬─────┘                             └────────┘
       | all services initialized
       v
  ┌──────────┐   SIGTERM / SIGINT / stop()
  │ running  │ ─────────────────────────>  ┌──────────┐
  └──────────┘                             │ draining │
                                           └────┬─────┘
                                                | drain complete
                                                v
                                           ┌──────────┐
                                           │ stopped  │
                                           └──────────┘
```

**created**: Runtime object exists but no services are started. Configuration is validated.

**starting**: Services initialize in dependency order:
1. Key manager -- detect platform, load or create root key
2. Broker core -- create XMTP client(s), sync groups
3. Session manager -- initialize session store
4. Seal manager -- bind to key manager and core
5. Policy engine -- wire to session and seal managers
6. WebSocket server -- begin accepting harness connections
7. Admin server -- open Unix domain socket
8. Write PID file

If any step fails, previously started services are shut down in reverse order and the state transitions to `error`.

**running**: All services operational. The daemon accepts admin commands via Unix socket and harness connections via WebSocket. Signal handlers are installed for SIGTERM and SIGINT.

**draining**: Graceful shutdown initiated. Steps:
1. Stop accepting new connections (both WebSocket and admin socket)
2. Drain active WebSocket connections (send terminal events, wait for in-flight)
3. Revoke all active sessions (reason: `explicit-revoke`)
4. Close XMTP client(s)
5. Remove PID file and admin socket file
6. Flush and close audit log

**stopped**: All services stopped, resources released. Process exits.

**error**: Initialization failed. The error is logged and the process exits with the appropriate exit code.

### Startup Sequence (`xmtp-broker start`)

```
  xmtp-broker start [--daemon] [--config <path>]
         |
         v
  Load config file (TOML)
         |
         v
  Apply environment variable overrides
         |
         v
  Apply CLI flag overrides
         |
         v
  Validate merged config via CliConfigSchema
         |
         v
  Check for existing PID file
         |  |
         |  +--> PID file exists AND process alive: exit with error
         |  |    "Broker already running (PID <pid>)"
         |  |
         |  +--> PID file exists AND process dead: remove stale PID file
         |
         v
  createBrokerRuntime(config)
         |
         v
  runtime.start()
         |
         +--> If --daemon: fork, write PID file, detach from terminal
         |
         +--> If foreground: install signal handlers, block
         |
         v
  Emit startup banner to stdout:
    "xmtp-broker v0.1.0 started"
    "  XMTP env: dev"
    "  WebSocket: 127.0.0.1:8393"
    "  Admin socket: /tmp/xmtp-broker/admin.sock"
    "  PID: 12345"
```

### Configuration Precedence

Configuration values are resolved in this order (later wins):

1. **Schema defaults** -- values defined in `CliConfigSchema.default()`
2. **Config file** -- TOML file at `~/.config/xmtp-broker/config.toml`
3. **Environment variables** -- `XMTP_BROKER_*` prefix
4. **CLI flags** -- `--port`, `--host`, `--config`, etc.

Environment variable mapping uses a flat, uppercase, underscore-separated convention:

| Config path | Environment variable |
|-------------|---------------------|
| `broker.env` | `XMTP_BROKER_ENV` |
| `broker.dataDir` | `XMTP_BROKER_DATA_DIR` |
| `ws.port` | `XMTP_BROKER_WS_PORT` |
| `ws.host` | `XMTP_BROKER_WS_HOST` |
| `sessions.defaultTtlSeconds` | `XMTP_BROKER_SESSION_TTL` |
| `logging.level` | `XMTP_BROKER_LOG_LEVEL` |

```typescript
/** Load and merge config from all sources. */
function loadConfig(options: {
  configPath?: string;
  overrides?: Partial<CliConfig>;
}): Result<CliConfig, ValidationError>;
```

### Config File Format

```toml
# ~/.config/xmtp-broker/config.toml

[broker]
env = "dev"
identityMode = "per-group"
dataDir = "~/.local/share/xmtp-broker"

[keys]
rootKeyPolicy = "biometric"
operationalKeyPolicy = "open"

[ws]
port = 8393
host = "127.0.0.1"

[admin]
authMode = "admin-key"
# socketPath = "/tmp/xmtp-broker/admin.sock"
# admin key loaded from vault (no external keyfile)

[sessions]
defaultTtlSeconds = 3600
maxConcurrentPerAgent = 3
heartbeatIntervalSeconds = 30

[logging]
level = "info"
# auditLogPath = "~/.local/state/xmtp-broker/audit.jsonl"
```

### Admin Socket Protocol

The admin socket uses JSON-RPC 2.0 over a Unix domain socket. Each request-response pair is a single JSON message terminated by a newline (`\n`).

**Connection flow:**

```
  CLI command
       |
       v
  createAdminClient(socketPath)
       |
       v
  Connect to Unix socket
       |
       v
  [Optional: auth handshake if authMode is admin-key]
       |
       v
  Send JSON-RPC request
       |
       v
  Receive JSON-RPC response
       |
       v
  Close connection
```

**Authentication:**

The first message from the CLI must be an auth frame containing an admin JWT:

```typescript
const AdminAuthFrame = z.object({
  type: z.literal("admin_auth"),
  token: z.string()
    .describe("Admin JWT (EdDSA-signed, from spec 12)"),
}).describe("Admin authentication frame");
```

The daemon verifies the JWT signature against the admin public key stored in the vault, checks expiration, and attaches `AdminAuthContext` to the connection. All subsequent requests on this connection are authorized.

**Request framing:**

Each JSON-RPC message is a complete JSON object followed by `\n`. This allows simple line-based parsing with `Bun.connect()`:

```typescript
// CLI side
const socket = await Bun.connect({
  unix: socketPath,
  socket: {
    data(socket, data) {
      const line = decoder.decode(data);
      const response = JSON.parse(line);
      // handle response
    },
  },
});
socket.write(JSON.stringify(request) + "\n");

// Server side
Bun.listen({
  unix: socketPath,
  socket: {
    data(socket, data) {
      const line = decoder.decode(data);
      const request = JsonRpcRequestSchema.parse(JSON.parse(line));
      // dispatch to handler
    },
  },
});
```

**Streaming responses (message stream, conversation stream):**

For streaming commands, the server sends multiple JSON-RPC notifications (no `id` field) followed by a final response with the original `id`:

```typescript
const JsonRpcNotificationSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
}).describe("JSON-RPC 2.0 notification (no id, no response expected)");
```

The CLI keeps the socket open, printing each notification as it arrives (NDJSON with `--json`, formatted text otherwise), until the user sends SIGINT or the stream ends.

### Command Groups

#### `broker` -- Daemon Lifecycle

```
xmtp-broker start [--daemon] [--config <path>]
xmtp-broker stop [--timeout <ms>]
xmtp-broker status
xmtp-broker config show
xmtp-broker config validate [--config <path>]
```

**`start`**: The only command that does not connect to the admin socket. It creates and starts the `BrokerRuntime`. With `--daemon`, the process forks and detaches. Without it, the process runs in the foreground with signal handling.

**`stop`**: Connects to the admin socket and sends `broker.stop`. The daemon initiates graceful shutdown. The CLI waits for the daemon to confirm shutdown or times out (default 10 seconds, configurable via `--timeout`).

**`status`**: Connects to the admin socket and sends `broker.status`. Displays daemon state, uptime, session count, connection count, XMTP env, and version.

**`config show`**: Connects to the admin socket and sends `broker.config.show`. Displays the active merged configuration (with secrets redacted).

**`config validate`**: Does not require a running daemon. Loads and validates the config file, reporting any errors. Exits 0 if valid, 1 if invalid.

#### `identity` -- Inbox/Client Management

```
xmtp-broker identity init
xmtp-broker identity info
xmtp-broker identity rotate-keys
xmtp-broker identity export-public
```

**`init`**: Works in direct mode. Creates a new XMTP identity and key hierarchy. Generates the root key (may trigger biometric prompt), creates an operational key, initializes the encrypted vault, and registers with the XMTP network. Writes the identity key file.

**`info`**: Daemon mode. Displays inbox ID, installation ID, identity mode, key fingerprints, platform capability, and trust tier.

**`rotate-keys`**: Daemon mode, admin auth required. Triggers operational key rotation through the key manager. May prompt for biometric. Publishes updated seals.

**`export-public`**: Daemon mode. Exports public key material (operational key public key, root key public key, fingerprints) in a format suitable for verification.

#### `session` -- Session Lifecycle

```
xmtp-broker session list
xmtp-broker session inspect <id>
xmtp-broker session revoke <id> [--reason <reason>]
xmtp-broker session issue [--agent <inboxId>] [--ttl <seconds>] [--view <json>] [--grant <json>]
```

All session commands require the daemon and admin auth.

**`list`**: Displays a table of active sessions with columns: session ID, agent inbox ID, state, created, expires, heartbeat.

**`inspect <id>`**: Shows full session details including view config, grant config, policy hash, session key fingerprint, and timestamps.

**`revoke <id>`**: Immediately revokes a session. Optional `--reason` flag (defaults to `explicit-revoke`). The daemon sends a `session.expired` event to connected harnesses and closes WebSocket connections.

**`issue`**: Creates a new session. Requires `--agent` (target agent inbox ID). Accepts `--view` and `--grant` as inline JSON or file paths (prefixed with `@`). The session token is printed to stdout. With `--json`, the full session record is output.

```typescript
/** Input schema for session.issue via CLI. */
const SessionIssueInputSchema = z.object({
  agentInboxId: z.string()
    .describe("Target agent inbox ID"),
  ttlSeconds: z.number().int().positive().optional()
    .describe("Session TTL override"),
  view: ViewConfig.optional()
    .describe("View configuration"),
  grant: GrantConfig.optional()
    .describe("Grant configuration"),
}).describe("Session issuance input");
```

#### `grant` -- Grant Management

```
xmtp-broker grant list [--session <id>]
xmtp-broker grant inspect <id>
xmtp-broker grant revoke <id>
```

All grant commands require the daemon and admin auth.

**`list`**: Lists grants across active sessions. Optional `--session` filter narrows to a single session. Displays: grant ID, session ID, agent, messaging permissions, management permissions.

**`inspect <id>`**: Shows full grant details including all permission fields, content type allowlist, and tool scopes.

**`revoke <id>`**: Revokes a specific grant, which triggers session reauthorization (material change).

#### `seal` -- Seal Lifecycle

```
xmtp-signet seal list [--group <groupId>] [--agent <inboxId>]
xmtp-signet seal inspect <id>
xmtp-signet seal verify <id>
xmtp-signet seal revoke <id>
```

All seal commands require the daemon. `verify` and `inspect` have limited direct mode support if given raw seal data via stdin.

**`list`**: Lists seals filtered by group or agent. Displays: seal ID, group, agent, trust tier, issued, expires.

**`inspect <id>`**: Shows full seal content including the signed envelope, verification chain, view/grant summary, and provenance metadata.

**`verify <id>`**: Runs the 6-check verification pipeline from spec 09 against a specific seal. Displays pass/fail for each check and an overall result.

**`revoke <id>`**: Revokes a seal and publishes a revocation message to the group.

#### `message` -- Message Operations

```
xmtp-broker message send <group> "<text>"
xmtp-broker message list <group> [--limit <n>] [--before <timestamp>]
xmtp-broker message stream <group>
```

Available in daemon mode and direct mode. In daemon mode, messages are routed through the policy engine and respect the active session's view and grant. In direct mode, raw XMTP access with no policy.

**`send`**: Sends a text message to a group conversation. In daemon mode, the message goes through grant enforcement. Prints the message ID on success.

**`list`**: Lists recent messages in a group. Default limit: 25. Displays: timestamp, sender, content preview. With `--json`, full message objects.

**`stream`**: Streams messages from a group in real time. Long-running command. With `--json`, outputs NDJSON (one JSON object per line per message). Without `--json`, formatted display. Exits on SIGINT (exit code 130).

#### `conversation` -- Conversation Operations

```
xmtp-broker conversation list [--limit <n>]
xmtp-broker conversation info <group>
xmtp-broker conversation create [--members <inboxId,...>]
xmtp-broker conversation add-member <group> <inboxId>
```

Available in daemon mode and direct mode.

**`list`**: Lists conversations/groups the broker participates in. Displays: group ID, member count, last activity.

**`info <group>`**: Shows group metadata: group ID, members, creation date, identity key fingerprint (if per-group mode).

**`create`**: Creates a new group conversation. Optional `--members` flag adds initial members. Prints the new group ID.

**`add-member <group> <inboxId>`**: Adds a member to a group conversation.

#### `admin` -- Administrative Operations

```
xmtp-broker admin verify-keys
xmtp-broker admin export-state
xmtp-broker admin audit-log [--limit <n>] [--since <timestamp>]
```

All admin commands require the daemon and admin auth.

**`verify-keys`**: Verifies key hierarchy integrity. Checks that the root key is accessible, operational keys can be decrypted, vault is consistent, and trust tier matches platform capability. Reports pass/fail for each check.

**`export-state`**: Exports a snapshot of the broker's runtime state for debugging. Includes: daemon status, active sessions (tokens redacted), active connections, key fingerprints, group list. Output is JSON.

**`audit-log`**: Reads and displays the audit trail. Default limit: 50 entries. `--since` filters by timestamp. With `--json`, outputs the raw JSONL entries.

### Direct Mode Detection and Fallback

```
  CLI command invoked
         |
         v
  Is command "broker start" or "config validate"?
         |                          |
        yes                        no
         |                          |
         v                          v
  Execute directly            Resolve admin socket path
  (no daemon needed)                |
                                    v
                             Try connect to socket
                                    |
                            ┌───────┴───────┐
                         success          failure
                            |               |
                            v               v
                    Route via admin    Does command support
                    socket (daemon     direct mode?
                    mode)                   |
                                    ┌───────┴───────┐
                                   yes              no
                                    |               |
                                    v               v
                             Create direct    Print error:
                             client, execute  "Broker daemon is not
                             command          running. Start with:
                                              xmtp-broker start"
                                              Exit code 1
```

Commands that support direct mode:

| Command | Direct mode behavior |
|---------|---------------------|
| `identity init` | Full support (creates identity) |
| `message send` | Raw XMTP send, no policy |
| `message list` | Raw XMTP list, no policy |
| `message stream` | Raw XMTP stream, no policy |
| `conversation list` | Raw XMTP list |
| `conversation info` | Raw XMTP group info |
| `conversation create` | Raw XMTP create |
| `conversation add-member` | Raw XMTP add member |

Commands that require the daemon:

| Command | Why daemon required |
|---------|-------------------|
| `broker stop/status` | Operates on the daemon itself |
| `broker config show` | Reports daemon's active config |
| `identity info/rotate-keys/export-public` | Requires key manager |
| `session *` | Sessions are a daemon concept |
| `grant *` | Grants are a daemon concept |
| `seal *` | Seal manager is daemon-internal |
| `admin *` | Admin operations by definition |

### Composition Root

The `createBrokerRuntime` function is the application's composition root. It wires all packages together with explicit dependency injection -- no service locator, no global state.

```typescript
async function createBrokerRuntime(
  config: CliConfig,
): Promise<Result<BrokerRuntime, SignetError>> {
  // 1. Resolve paths
  const paths = resolvePaths(config);

  // 2. Create key manager (platform detection, root key)
  const keyManagerResult = await createKeyManager({
    dataDir: paths.dataDir,
    rootKeyPolicy: config.keys.rootKeyPolicy,
    operationalKeyPolicy: config.keys.operationalKeyPolicy,
  });
  if (!keyManagerResult.ok) return keyManagerResult;
  const keyManager = keyManagerResult.value;

  // 3. Create signer provider from key manager
  const signerProvider = keyManager.toSignerProvider();

  // 4. Create broker core context
  const coreContext: CoreContext = {
    brokerId: `broker_${Bun.hash(paths.dataDir).toString(16)}`,
    signerProvider,
  };

  // 5. Create broker core
  const core = createSignetCore({
    dataDir: paths.dataDir,
    env: config.broker.env,
    identityMode: config.broker.identityMode,
    signerProvider,
  });

  // 6. Create session manager
  const sessionManager = createSessionManager({
    defaultTtlSeconds: config.sessions.defaultTtlSeconds,
    maxConcurrentPerAgent: config.sessions.maxConcurrentPerAgent,
  });

  // 7. Create seal signer and manager
  const attestationSigner = createAttestationSigner(keyManager, coreContext.brokerId);
  const attestationManager = createSealManager({
    signer: attestationSigner,
    publisher: core.toAttestationPublisher(),
  });

  // 8. Create policy engine
  const policyEngine = createPolicyEngine({
    sessionManager,
    attestationManager,
  });

  // 9. Create WebSocket server
  const wsServer = createWsServer(
    { port: config.ws.port, host: config.ws.host },
    { core, sessionManager, attestationManager },
  );

  // 10. Create audit log
  const auditLog = createAuditLog(paths.auditLog);

  // 11. Create admin server
  const adminServer = createAdminServer(
    {
      socketPath: paths.adminSocket,
      authMode: config.admin.authMode,
    },
    { runtime: /* circular -- resolved via lazy ref */ undefined as never, auditLog },
  );

  // Return the runtime handle
  return ok({
    core,
    sessionManager,
    attestationManager,
    keyManager,
    policyEngine,
    wsServer,
    adminServer,
    config,
    paths,
    state: "created",
    start: () => startRuntime(/* ... */),
    shutdown: () => shutdownRuntime(/* ... */),
  });
}
```

The circular dependency between `AdminServer` and `BrokerRuntime` is resolved with a lazy initialization pattern: the admin server receives a reference that is populated after the runtime object is fully constructed.

### Signal Handling

In foreground mode, the daemon installs signal handlers:

```typescript
function installSignalHandlers(runtime: BrokerRuntime): void {
  let shutdownInProgress = false;

  const shutdown = async (signal: string) => {
    if (shutdownInProgress) {
      // Second signal: force exit
      process.exit(128 + (signal === "SIGTERM" ? 15 : 2));
    }
    shutdownInProgress = true;
    console.error(`\nReceived ${signal}, shutting down...`);
    const result = await runtime.shutdown();
    process.exit(result.ok ? 0 : 10);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
```

A second SIGINT/SIGTERM forces immediate exit (matching Unix conventions). The first signal triggers graceful shutdown.

### PID File Management

```typescript
interface PidFile {
  /** Write PID file. Returns error if a live process holds it. */
  acquire(pidPath: string): Result<void, SignetError>;

  /** Remove PID file. */
  release(pidPath: string): void;

  /** Check if a process holds the PID file. */
  check(pidPath: string): { running: boolean; pid: number | null };
}
```

The PID file contains the process ID as a decimal string, followed by a newline. On startup, the daemon checks:

1. Does the PID file exist?
2. If yes, is the process alive? (`process.kill(pid, 0)`)
3. If alive: exit with error.
4. If dead: remove stale PID file, continue.
5. Write new PID file.

On shutdown, the PID file and admin socket file are removed.

### Global CLI Options

```typescript
// Applied to all commands via Commander's global options
program
  .option("--json", "Output in JSON format")
  .option("--verbose", "Enable verbose output")
  .option("--quiet", "Suppress non-essential output")
  .option("--config <path>", "Path to config file");
```

- `--json`: Machine-readable JSON output on stdout. Errors as JSON on stderr.
- `--verbose`: Show debug-level information (request/response details, timing).
- `--quiet`: Suppress banners, progress indicators, and informational messages. Only output the result.
- `--config`: Override the default config file path.

`--verbose` and `--quiet` are mutually exclusive. If both are provided, `--quiet` wins.

### Command Registration Pattern

Each command group is a separate module that exports a function creating a Commander `Command`:

```typescript
// src/commands/session.ts
import { Command } from "commander";

export function createSessionCommand(): Command {
  const session = new Command("session")
    .description("Manage harness sessions");

  session
    .command("list")
    .description("List active sessions")
    .action(async (_, cmd) => {
      const opts = resolveOutputOptions(cmd);
      const client = await requireDaemon(cmd);
      const result = await client.request<SessionRecord[]>("session.list");
      handleResult(result, opts, formatSessionList);
    });

  session
    .command("inspect <id>")
    .description("Show session details")
    .action(async (id: string, _, cmd) => {
      const opts = resolveOutputOptions(cmd);
      const client = await requireDaemon(cmd);
      const result = await client.request<SessionRecord>("session.inspect", { sessionId: id });
      handleResult(result, opts, formatSessionDetail);
    });

  session
    .command("revoke <id>")
    .description("Revoke a session")
    .option("--reason <reason>", "Revocation reason", "explicit-revoke")
    .action(async (id: string, options, cmd) => {
      const opts = resolveOutputOptions(cmd);
      const client = await requireDaemon(cmd);
      const result = await client.request<void>("session.revoke", {
        sessionId: id,
        reason: options.reason,
      });
      handleResult(result, opts, () => `Session ${id} revoked.`);
    });

  session
    .command("issue")
    .description("Issue a new session token")
    .requiredOption("--agent <inboxId>", "Target agent inbox ID")
    .option("--ttl <seconds>", "Session TTL", parseInt)
    .option("--view <json>", "View configuration (JSON or @file)")
    .option("--grant <json>", "Grant configuration (JSON or @file)")
    .action(async (options, cmd) => {
      const opts = resolveOutputOptions(cmd);
      const client = await requireDaemon(cmd);
      const input = SessionIssueInputSchema.parse({
        agentInboxId: options.agent,
        ttlSeconds: options.ttl,
        view: parseJsonOrFile(options.view),
        grant: parseJsonOrFile(options.grant),
      });
      const result = await client.request<SessionToken>("session.issue", input);
      handleResult(result, opts, formatSessionToken);
    });

  return session;
}
```

### Helper Functions

```typescript
/** Connect to daemon or exit with error. */
async function requireDaemon(cmd: Command): Promise<AdminClient>;

/** Connect to daemon, or create direct client if command supports it. */
async function requireDaemonOrDirect(
  cmd: Command,
  directModeSupported: boolean,
): Promise<AdminClient | DirectClient>;

/** Parse a JSON string or read from a file (if prefixed with @). */
function parseJsonOrFile(value: string | undefined): unknown | undefined;

/** Resolve output options from Commander command. */
function resolveOutputOptions(cmd: Command): OutputOptions;

/** Handle a Result: format and print on success, print error and exit on failure. */
function handleResult<T>(
  result: Result<T, SignetError>,
  options: OutputOptions,
  formatter: (value: T) => string,
): void;

/** Handle a streaming Result: print each item as it arrives. */
function handleStream<T>(
  socket: AdminClient,
  options: OutputOptions,
  formatter: (value: T) => string,
): Promise<void>;
```

### Streaming Commands

`message stream` and `conversation stream` (if added) are long-running commands that keep the socket open. The protocol uses JSON-RPC notifications:

```
CLI                          Admin Server
 |                               |
 |-- stream.start request ------>|
 |                               |
 |<-- stream.data notification --|  (repeats)
 |<-- stream.data notification --|
 |<-- stream.data notification --|
 |                               |
 |-- [SIGINT] ------------------>|  (socket close)
 |                               |
```

With `--json`, each notification is printed as a single JSON line (NDJSON). Without `--json`, messages are formatted for human consumption:

```
[12:34:56] alice (0xabc...def):
  Hello, how are you?

[12:34:58] bob (0x123...456):
  I'm doing great!
```

### Audit Trail

Admin operations are logged to the append-only audit log:

```jsonl
{"timestamp":"2026-03-14T10:00:00Z","action":"session.issue","actor":"admin","target":"ses_abc123","detail":{"agentInboxId":"0xdef..."},"success":true}
{"timestamp":"2026-03-14T10:05:00Z","action":"session.revoke","actor":"admin","target":"ses_abc123","detail":{"reason":"explicit-revoke"},"success":true}
{"timestamp":"2026-03-14T10:10:00Z","action":"identity.rotateKeys","actor":"admin","detail":{},"success":true}
```

Operations that trigger audit entries:

| Action | Logged |
|--------|--------|
| `session.issue` | Yes |
| `session.revoke` | Yes |
| `grant.revoke` | Yes |
| `seal.revoke` | Yes |
| `identity.rotateKeys` | Yes |
| `broker.start` | Yes |
| `broker.stop` | Yes |
| `admin.exportState` | Yes |
| Read-only queries (list, inspect, status) | No |

## Error Cases

| Scenario | Error | Exit Code | Category |
|----------|-------|-----------|----------|
| Invalid config file syntax (TOML parse error) | `ValidationError` | 1 | validation |
| Config validation fails (Zod) | `ValidationError` | 1 | validation |
| Daemon already running | `ValidationError` | 1 | validation |
| Admin socket not found (daemon not running) | `InternalError` | 8 | internal |
| Admin socket connection refused | `InternalError` | 8 | internal |
| Admin auth failed (bad admin key) | `AuthError` | 9 | auth |
| Session not found | `NotFoundError` | 2 | not_found |
| Seal not found | `NotFoundError` | 2 | not_found |
| Group not found | `NotFoundError` | 2 | not_found |
| Operation requires daemon (direct mode unsupported) | `ValidationError` | 1 | validation |
| Direct mode vault not found or inaccessible | `AuthError` | 9 | auth |
| XMTP client initialization failure | `InternalError` | 8 | internal |
| Admin request timeout | `TimeoutError` | 5 | timeout |
| User cancelled (SIGINT) | `CancelledError` | 130 | cancelled |
| JSON-RPC protocol error | `InternalError` | 8 | internal |
| PID file locked by live process | `ValidationError` | 1 | validation |
| Permission denied on socket/PID file | `PermissionError` | 4 | permission |

Exit codes are derived from `ERROR_CATEGORY_META` in `@xmtp/signet-schemas/errors/category.ts`. The CLI calls `exitCodeFromCategory(error.category)` -- no separate exit code table.

## Open Questions Resolved

**Q: TOML parser for Bun?** (CLI design doc, Q2)
**A:** `smol-toml`. Lightweight, spec-compliant TOML parser with zero dependencies. Works with Bun's module resolution. No JSONC fallback needed.

**Q: Multi-identity support?** (CLI design doc, Q7)
**A:** v0 is single-identity per daemon process. The config specifies identity settings in `[broker]`, and all commands operate on the single active identity. The CLI is structured for future `--identity` flag support: the `identity` command group exists, and the config schema could extend to `[identities.<name>]` sections. But v0 runs one identity per daemon.

**Q: Config file format and location?** (CLI design doc, Q2)
**A:** TOML at `~/.config/xmtp-broker/config.toml`, following XDG conventions. `$XDG_CONFIG_HOME` is respected. TOML was chosen over JSON (no comments) and YAML (complex spec, whitespace-sensitive) because it is human-readable, supports comments, and has a small, well-defined spec.

**Q: Direct mode key source?** (CLI design doc, Q4)
**A:** Vault only. All key access goes through the encrypted vault, unlocked by the hardware-bound root key (Secure Enclave on macOS). No raw keys in environment variables, keyfiles, or CLI arguments — ever. This is the core security invariant of the entire project. The vault is created by `identity init` and lives in the data directory. Secure Enclave integration (spec 07) is a hard dependency for the CLI.

**Q: Session issuance via CLI?** (CLI design doc, Q5)
**A:** `session issue` prints the session token to stdout. With `--json`, the full session record (token, session ID, expiry, view, grant) is output as JSON. The harness developer copies it. No side channel in v0 -- this is a local-first developer tool.

**Q: Streaming output format?** (CLI design doc, Q6)
**A:** `message stream` and `conversation stream` use NDJSON with `--json` (one complete JSON object per line per event). Default human-readable format shows formatted messages with timestamps and sender. NDJSON is composable with `jq`, `grep`, and other Unix tools.

**Q: Audit trail persistence?** (CLI design doc, Q9)
**A:** Structured JSON log file at `$XDG_STATE_HOME/xmtp-broker/audit.jsonl`. Append-only, one JSON object per line. Covers admin operations only (session issuance, revocation, key rotation, daemon lifecycle). Read-only queries are not logged. The file can be rotated with standard logrotate tooling.

**Q: Admin auth mechanism?** (CLI design doc, Q1)
**A:** Admin key JWT only. The CLI generates a fresh JWT (EdDSA-signed, 2-minute TTL per spec 12) for each command and sends it over the Unix socket. Peer credential auth is deferred to post-v0. Remote admin is deferred (see Deferred section).

## Deferred

- **Background daemon via fork**: v0 `--daemon` flag is specified but may initially only support foreground mode with `nohup`/`tmux` as the backgrounding mechanism. True daemonization with double-fork is non-trivial on macOS and may require additional research. The PID file and socket management work identically in both cases.
- **macOS launchd integration**: `install-service` / `uninstall-service` commands for `~/Library/LaunchAgents/com.xmtp.broker.plist` are Phase 2.
- **Remote admin**: Admin over TLS-encrypted TCP socket for server deployments. v0 is local-only via Unix socket.
- **Shell completions**: Auto-generated bash/zsh/fish completions from Commander. Useful but not v0.
- **Plugin system**: Extensible command groups or middleware hooks for custom commands. Not v0.
- **Config migration**: Automated migration between config versions. v0 is the first version; no migration needed.
- **MCP transport**: MCP adapter for IDE integration is Phase 2. The handler contract ensures adding it is mechanical (spec 14).
- **HTTP transport**: REST API surface for remote programmatic access. Phase 3.
- **Multi-identity**: Multiple XMTP identities per daemon. v0 is single-identity.
- **Config hot-reload**: Reloading config without daemon restart. v0 requires restart for config changes.
- **Structured logging**: v0 uses simple console logging. Structured JSON logging to a file (separate from audit log) is post-v0.

## Testing Strategy

### What to Test

1. **Config loading and merging** -- TOML parsing, environment variable overrides, CLI flag overrides, validation errors, default values.
2. **Path resolution** -- XDG compliance, macOS fallbacks, tilde expansion.
3. **Admin socket protocol** -- JSON-RPC request/response framing, error responses, timeout handling, connection lifecycle.
4. **Admin auth** -- Peer credential verification, admin key challenge-response, rejection of unauthorized connections.
5. **PID file management** -- Acquire, release, stale detection, concurrent access.
6. **Command routing** -- CLI arguments parsed correctly, mapped to JSON-RPC methods, params validated.
7. **Output formatting** -- Human-readable and JSON formats for all response types. Error formatting with exit codes.
8. **Direct mode detection** -- Socket probe, fallback logic, commands that support/reject direct mode.
9. **Direct mode client** -- Key loading from env/file, one-shot client lifecycle.
10. **Composition root** -- All services wired correctly, startup/shutdown order, error propagation.
11. **Signal handling** -- SIGTERM and SIGINT trigger graceful shutdown. Double-signal forces exit.
12. **Streaming commands** -- NDJSON output, SIGINT termination, socket cleanup.
13. **Audit log** -- Append, tail, file creation, entry format.
14. **Action registry** -- Method registration, dispatch, unknown method handling.
15. **Daemon lifecycle** -- State machine transitions, startup failure rollback, shutdown drain.

### How to Test

**Unit tests**: Test config loading, path resolution, output formatting, PID file management, JSON-RPC framing, audit log, and action registry in isolation. Mock the file system and admin socket where needed.

**Integration tests**: Start a real admin server on a temporary Unix socket, connect with the admin client, and exercise the full request/response flow. Use mock runtime deps (mock `SignetCore`, `SessionManager`, etc.) to focus on the transport layer.

**CLI integration tests**: Invoke the `xmtp-broker` binary as a subprocess, feed it arguments, and assert on stdout, stderr, and exit codes. These tests exercise the full Commander pipeline and output formatting.

### Key Test Scenarios

```typescript
// Config loading with TOML file
const toml = `
[broker]
env = "production"

[ws]
port = 9999
`;
const config = loadConfig({ configContent: toml });
expect(config.ok).toBe(true);
expect(config.value.broker.env).toBe("production");
expect(config.value.ws.port).toBe(9999);
expect(config.value.ws.host).toBe("127.0.0.1"); // default preserved

// Config with env var override
process.env.XMTP_BROKER_WS_PORT = "7777";
const config2 = loadConfig({});
expect(config2.value.ws.port).toBe(7777);
delete process.env.XMTP_BROKER_WS_PORT;

// Path resolution on macOS
const paths = resolvePaths(defaultConfig);
expect(paths.configFile).toMatch(/\.config\/xmtp-broker\/config\.toml$/);
expect(paths.pidFile).toContain("xmtp-broker/broker.pid");

// Admin socket round-trip
const { server, client } = await createTestAdminPair();
server.registry.register("session.list", z.object({}), async () => {
  return ok([{ sessionId: "ses_abc", state: "active" }]);
});
const result = await client.request<SessionRecord[]>("session.list");
expect(result.ok).toBe(true);
expect(result.value).toHaveLength(1);

// Admin socket error
const result2 = await client.request("unknown.method");
expect(result2.ok).toBe(false);
expect(result2.error.category).toBe("not_found");

// PID file stale detection
await Bun.write(pidPath, "99999\n"); // non-existent PID
const check = pidFile.check(pidPath);
expect(check.running).toBe(false);
expect(check.pid).toBe(99999);

// Output formatting (JSON mode)
const output = formatResult(ok({ count: 5 }), { format: "json", verbose: false, quiet: false }, JSON.stringify);
expect(JSON.parse(output)).toEqual({ count: 5 });

// Output formatting (error)
const errOutput = formatError(
  NotFoundError.create("session", "ses_xyz"),
  { format: "json", verbose: false, quiet: false },
);
const parsed = JSON.parse(errOutput);
expect(parsed.error.category).toBe("not_found");
expect(parsed.error.message).toContain("ses_xyz");

// Exit code mapping
expect(exitCodeFromCategory("validation")).toBe(1);
expect(exitCodeFromCategory("auth")).toBe(9);
expect(exitCodeFromCategory("cancelled")).toBe(130);
expect(exitCodeFromCategory("timeout")).toBe(5);

// Direct mode detection
const probeResult = await probeDaemon(socketPath);
expect(probeResult).toBe(false); // no daemon running

// Audit log append and tail
const audit = createAuditLog(tmpAuditPath);
await audit.append({
  timestamp: new Date().toISOString(),
  action: "session.issue",
  actor: "admin",
  target: "ses_abc",
  success: true,
});
const entries = await audit.tail(10);
expect(entries).toHaveLength(1);
expect(entries[0].action).toBe("session.issue");

// Action registry dispatch
const registry = createActionRegistry();
registry.register("session.list", z.object({}), async () => ok([]));
const dispatched = await registry.dispatch("session.list", {}, mockContext);
expect(dispatched.ok).toBe(true);
const missing = await registry.dispatch("nonexistent", {}, mockContext);
expect(missing.ok).toBe(false);

// Streaming (NDJSON)
const messages: string[] = [];
const stream = handleStream(client, { format: "json", verbose: false, quiet: false }, JSON.stringify);
// simulate notifications
server.sendNotification("stream.data", { text: "hello" });
server.sendNotification("stream.data", { text: "world" });
// messages collected as NDJSON lines
```

### Test Utilities

```typescript
/** Create a paired admin server and client on a temp socket. */
async function createTestAdminPair(
  overrides?: Partial<AdminServerConfig>,
): Promise<{
  server: AdminServer & { registry: ActionRegistry };
  client: AdminClient;
  socketPath: string;
  cleanup: () => Promise<void>;
}>;

/** Create a CliConfig with test defaults. */
function createTestCliConfig(
  overrides?: Partial<CliConfig>,
): CliConfig;

/** Create a mock BrokerRuntime with all deps mocked. */
function createMockRuntime(): {
  runtime: BrokerRuntime;
  mocks: {
    core: SignetCore;
    sessionManager: SessionManager;
    attestationManager: SealManager;
    keyManager: KeyManager;
  };
};

/** Invoke the CLI binary and capture output. */
async function runCli(
  args: readonly string[],
  env?: Record<string, string>,
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}>;

/** Create a temporary directory with a TOML config file. */
function createTestConfigDir(
  tomlContent: string,
): Promise<{ dir: string; configPath: string; cleanup: () => Promise<void> }>;
```

## File Layout

```
packages/cli/
  package.json
  tsconfig.json
  bin/
    xmtp-broker.ts              # Entry point: #!/usr/bin/env bun
  src/
    index.ts                    # Re-exports public API (createBrokerRuntime, loadConfig)
    program.ts                  # Commander program definition, global options, command registration
    runtime.ts                  # createBrokerRuntime composition root
    config/
      loader.ts                 # loadConfig: TOML + env + CLI merge
      schema.ts                 # CliConfigSchema, env var mapping
      paths.ts                  # resolvePaths, XDG resolution, tilde expansion
      toml.ts                   # TOML parsing wrapper (smol-toml)
    daemon/
      lifecycle.ts              # DaemonState machine, start/shutdown sequences
      pid-file.ts               # PID file acquire/release/check
      signals.ts                # Signal handler installation
    admin/
      server.ts                 # AdminServer: Unix socket listener, JSON-RPC dispatch
      client.ts                 # AdminClient: Unix socket connection, request/response
      auth.ts                   # Peer credential check, admin key challenge-response
      protocol.ts               # JsonRpcRequest/Response/Notification schemas, framing
      registry.ts               # ActionRegistry: method -> handler mapping
    direct/
      client.ts                 # createDirectClient, vault-based key access
      detect.ts                 # probeDaemon, requireDaemon, requireDaemonOrDirect
    commands/
      broker.ts                 # start, stop, status, config show, config validate
      identity.ts               # init, info, rotate-keys, export-public
      session.ts                # list, inspect, revoke, issue
      grant.ts                  # list, inspect, revoke
      attestation.ts            # list, inspect, verify, revoke
      message.ts                # send, list, stream
      conversation.ts           # list, info, create, add-member
      admin.ts                  # verify-keys, export-state, audit-log
    output/
      format.ts                 # formatResult, formatError, OutputOptions
      exit-codes.ts             # exitCodeFromCategory (delegates to ERROR_CATEGORY_META)
      tables.ts                 # Human-readable table formatting helpers
      json.ts                   # JSON output helpers, NDJSON streaming
    audit/
      log.ts                    # AuditLog: append-only JSONL file
      schema.ts                 # AuditEntrySchema
    __tests__/
      config/
        loader.test.ts          # TOML loading, env overrides, CLI overrides
        paths.test.ts           # XDG resolution, macOS fallbacks
        schema.test.ts          # Config schema validation, defaults
      daemon/
        lifecycle.test.ts       # State machine transitions, startup/shutdown
        pid-file.test.ts        # Acquire, release, stale detection
        signals.test.ts         # Signal handler behavior
      admin/
        server.test.ts          # Unix socket server, request handling
        client.test.ts          # Unix socket client, timeout handling
        auth.test.ts            # Peer credentials, admin key challenge
        protocol.test.ts        # JSON-RPC framing, validation
        registry.test.ts        # Method registration, dispatch, unknown methods
      direct/
        client.test.ts          # Vault-based key access, direct client lifecycle
        detect.test.ts          # Daemon probe, fallback logic
      commands/
        broker.test.ts          # Start, stop, status command logic
        session.test.ts         # Session commands, argument parsing
        message.test.ts         # Message commands, streaming
      output/
        format.test.ts          # Human and JSON formatting
        exit-codes.test.ts      # Category-to-exit-code mapping
      audit/
        log.test.ts             # Append, tail, file rotation
      runtime.test.ts           # Composition root wiring
      integration/
        admin-socket.test.ts    # Full admin socket round-trip
        cli.test.ts             # Binary invocation with assertions
      fixtures.ts               # Test utilities, mock factories
```

Each source file targets under 200 LOC. The largest files will be the command modules (`commands/*.ts`), which may approach 150-200 LOC each due to Commander option definitions. If a command module exceeds 200 LOC, its handler logic should be extracted into the corresponding `admin/` or `direct/` layer.

### Package Configuration

```jsonc
{
  "name": "@xmtp/signet-cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": {
    "xmtp-broker": "./bin/xmtp-broker.ts"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "bun build ./src/index.ts --outdir ./dist --target bun",
    "typecheck": "tsc --noEmit",
    "lint": "oxlint .",
    "test": "bun test",
    "start": "bun run bin/xmtp-broker.ts"
  },
  "dependencies": {
    "@xmtp/signet-contracts": "workspace:*",
    "@xmtp/signet-schemas": "workspace:*",
    "@xmtp/signet-core": "workspace:*",
    "@xmtp/signet-policy": "workspace:*",
    "@xmtp/signet-sessions": "workspace:*",
    "@xmtp/signet-seals": "workspace:*",
    "@xmtp/signet-keys": "workspace:*",
    "@xmtp/signet-ws": "workspace:*",
    "better-result": "catalog:",
    "commander": "14.0.3",
    "smol-toml": "1.6.0",
    "zod": "catalog:"
  },
  "devDependencies": {
    "typescript": "catalog:"
  }
}
```
