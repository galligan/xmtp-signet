# 14-mcp-transport

**Package:** `@xmtp-broker/mcp`
**Spec version:** 0.1.0

## Overview

The MCP transport exposes broker ActionSpecs as MCP tools, enabling AI agents (Claude Code, Cursor, etc.) to interact with the broker through the Model Context Protocol. It is the second transport surface after WebSocket, and -- like WebSocket -- it is **harness-facing**. MCP callers operate as agent sessions with scoped views and grants, not as broker administrators.

An AI agent using MCP tools is acting as a participant in XMTP conversations: sending messages, listing conversations, creating groups, managing its identity. It is NOT acting as the broker administrator. Admin operations (daemon lifecycle, session/grant management, key rotation, attestation management, audit) remain locked down in the CLI with admin key JWT auth.

The transport is a thin adapter. It reads ActionSpecs from the registry, converts Zod input schemas to JSON Schema via `zodToJsonSchema()`, registers them as MCP tools, and translates handler Results into MCP content blocks. All domain logic remains in the handlers. The MCP package contains no business logic.

Two deployment modes:

- **Stdio mode** (default): The MCP server runs as a standalone process, communicating with the MCP client over stdin/stdout. This is the standard integration for Claude Code and similar tools.
- **Daemon-embedded mode**: The MCP server runs inside the broker daemon process, sharing the same runtime context. This avoids a second process and allows the MCP server to participate in the broker's lifecycle (startup, shutdown, health monitoring).

Built on `@modelcontextprotocol/sdk`, the official MCP SDK. The SDK handles protocol negotiation, message framing, and transport mechanics. This package focuses on the bridge between ActionSpecs and MCP tool registrations.

## Dependencies

**Imports:**
- `@xmtp-broker/contracts` -- `ActionSpec`, `ActionRegistry`, `HandlerContext`, `Handler`
- `@xmtp-broker/schemas` -- `ActionResultMetaSchema`, `ActionErrorSchema`, `BrokerError`, `ValidationError`, `SessionToken`, `ViewConfig`, `GrantConfig`, error category metadata
- `@xmtp-broker/sessions` -- `SessionManager` (token validation, session lookup)
- `@xmtp-broker/policy` -- `projectMessage`, grant validation functions
- `@modelcontextprotocol/sdk` -- `Server`, `StdioServerTransport`, `CallToolRequestSchema`, `ListToolsRequestSchema`
- `better-result` -- `Result`, `ok`, `err`
- `zod` -- runtime validation
- `zod-to-json-schema` -- convert Zod schemas to JSON Schema for MCP tool input schemas

**Imported by:** Nothing -- this is a transport-tier leaf package. The broker daemon imports it to embed the MCP server; the standalone entry point imports it to run as a process.

## Public Interfaces

### MCP Server Configuration

```typescript
const McpServerConfigSchema = z.object({
  mode: z.enum(["stdio", "embedded"])
    .default("stdio")
    .describe("Transport mode: stdio for standalone, embedded for daemon"),
  serverName: z.string()
    .default("xmtp-broker")
    .describe("Server name advertised during MCP initialization"),
  serverVersion: z.string()
    .default("0.1.0")
    .describe("Server version advertised during MCP initialization"),
  toolPrefix: z.string()
    .default("broker")
    .describe("Prefix for all tool names (e.g., broker/message/send)"),
  sessionToken: z.string()
    .describe("Session bearer token for authenticating the MCP caller"),
  requestTimeoutMs: z.number().int().positive()
    .default(30_000)
    .describe("Timeout for handler execution"),
}).describe("MCP server configuration");

type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
```

### MCP Server

```typescript
interface McpServerDeps {
  /** The action registry to discover actions from. */
  readonly registry: ActionRegistry;

  /** Base context for constructing HandlerContext. */
  readonly brokerId: string;
  readonly signerProvider: SignerProvider;

  /** Session manager for token validation and session lookup. */
  readonly sessionManager: SessionManager;
}

interface McpServer {
  /** Start the MCP server. In stdio mode, begins reading stdin. */
  start(): Promise<Result<void, InternalError>>;

  /**
   * Stop the MCP server. Completes in-flight requests,
   * then closes the transport.
   */
  stop(): Promise<Result<void, InternalError>>;

  /** Current server state. */
  readonly state: McpServerState;

  /** Number of registered tools. */
  readonly toolCount: number;
}

type McpServerState = "idle" | "running" | "stopping" | "stopped";

function createMcpServer(
  config: McpServerConfig,
  deps: McpServerDeps,
): McpServer;
```

### Tool Registration

```typescript
/**
 * Convert an ActionSpec into an MCP tool registration.
 * Called internally during server startup for each spec
 * that has MCP surface metadata.
 */
interface McpToolRegistration {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;  // JSON Schema
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
  };
}

function actionSpecToMcpTool(
  spec: ActionSpec<unknown, unknown, BrokerError>,
): McpToolRegistration;
```

### Standalone Entry Point

```typescript
/**
 * Entry point for running the MCP server as a standalone process.
 * Reads config from environment (including session token),
 * connects to the broker daemon, and starts the stdio transport.
 */
// packages/mcp/src/bin/mcp-server.ts
```

## Zod Schemas

This package adds only `McpServerConfigSchema` (defined above). All other schemas are imported from `@xmtp-broker/schemas` (ActionResult envelope) and `@xmtp-broker/contracts` (ActionSpec types).

## Behaviors

### Session Token Source

The MCP caller authenticates with a **session token**, the same credential used by WebSocket harnesses. The token is provided at server startup, not per-request:

1. **Stdio mode**: The session token is passed via MCP server config, which the MCP client (Claude Code, Cursor) provides at process launch. Typically sourced from the MCP client's `env` configuration block (e.g., `XMTP_BROKER_SESSION_TOKEN`).
2. **Embedded mode**: The session token is provided in the `McpServerConfig` when the daemon creates the MCP server.

The token is validated at startup via `sessionManager.getSessionByToken()`. The resolved `SessionRecord` (including view and grant) is cached. On each tool call, the server performs a lightweight session liveness check:

1. **Expiry check**: Compare `sessionRecord.expiresAt` against `Date.now()`. If expired, return `AuthError("session expired")` and shut down the MCP server.
2. **Revocation check**: Call `sessionManager.isActive(sessionId)` to detect explicit revocation. This is a fast in-memory lookup, not a full token revalidation.

If either check fails, the current tool call returns an `auth` error and the MCP server shuts down gracefully (closes stdio, exits process). The MCP client will need to restart the server with a fresh session token.

### View and Grant Enforcement

MCP callers operate within the same policy boundary as WebSocket sessions:

- **View filtering**: List operations (conversations, messages) are filtered through the session's `ViewConfig`. The MCP caller only sees conversations and messages within its view scope.
- **Grant checks**: Write operations (send message, create group, add member) are validated against the session's `GrantConfig`. Unauthorized actions return a `permission` error.
- **Identity scope**: Identity creation is allowed within the session's grant. The MCP caller cannot access existing identity keys, delete identities, or export key material.

This is the same `projectMessage()` and grant validation pipeline used by the WebSocket transport.

### Server Startup Flow

```
createMcpServer(config, deps)
        │
        ▼
  Validate session token via sessionManager
        │
        ▼
  Cache SessionRecord (view, grant, agentInboxId)
        │
        ▼
  Create @modelcontextprotocol/sdk Server
        │
        ▼
  Query registry.listForSurface("mcp")
        │
        ▼
  For each ActionSpec with mcp metadata:
        │
        ├── Convert input schema: zodToJsonSchema(spec.input)
        ├── Build tool name: `${prefix}/${spec.mcp.toolName}`
        │   (or spec.mcp.toolName if it already includes prefix)
        ├── Register tool handler with MCP server
        │
        ▼
  Register ListTools handler (returns all tool definitions)
        │
        ▼
  Register CallTool handler (routes to correct ActionSpec)
        │
        ▼
  Connect transport (StdioServerTransport or embedded)
        │
        ▼
  Set state = "running"
```

### Tool Naming Convention

MCP tool names follow the pattern `broker/{group}/{action}`:

| Action ID | MCP Tool Name |
|-----------|---------------|
| `message.send` | `broker/message/send` |
| `message.list` | `broker/message/list` |
| `conversation.list` | `broker/conversation/list` |
| `conversation.info` | `broker/conversation/info` |
| `conversation.create` | `broker/conversation/create` |
| `conversation.add_member` | `broker/conversation/add-member` |
| `identity.create` | `broker/identity/create` |

The `toolName` field in `McpSurface` stores the full name (e.g., `broker/message/send`). The `toolPrefix` config is used only for validation and logging, not for name construction -- the spec author controls the exact tool name.

### Curated Subset

Only harness-facing actions are exposed through MCP. The curating mechanism is the presence or absence of `mcp` metadata on the ActionSpec.

**Actions exposed via MCP (harness-facing):**

| Action ID | MCP Tool Name | Description |
|-----------|---------------|-------------|
| `message.send` | `broker/message/send` | Send a message to a conversation |
| `message.list` | `broker/message/list` | List messages in a conversation |
| `conversation.list` | `broker/conversation/list` | List conversations visible to this session |
| `conversation.info` | `broker/conversation/info` | Get conversation details |
| `conversation.create` | `broker/conversation/create` | Create a new group conversation |
| `conversation.add_member` | `broker/conversation/add-member` | Add a member to a conversation |
| `identity.create` | `broker/identity/create` | Create a new XMTP identity for an agent |

**Actions excluded from MCP (admin-only, CLI-only):**

| Action ID | Reason for Exclusion |
|-----------|---------------------|
| `broker.start` | Daemon lifecycle -- CLI only |
| `broker.stop` | Daemon lifecycle -- CLI only |
| `broker.status` | Daemon inspection -- CLI only |
| `session.list` | Session management -- admin only |
| `session.issue` | Session management -- admin only |
| `session.revoke` | Session management -- admin only |
| `key.list` | Key management -- admin only |
| `key.rotate` | Key management -- admin only |
| `key.import` | Key management -- admin only |
| `key.export` | Key management -- admin only |
| `attestation.current` | Attestation management -- admin only |
| `attestation.refresh` | Attestation management -- admin only |
| `attestation.revoke` | Attestation management -- admin only |
| `identity.delete` | Destructive identity operation -- admin only |
| `identity.export` | Key material exposure -- admin only |

### CallTool Request Flow

```
MCP Client                    MCP Server                  ActionSpec Handler
    │                              │                              │
    │  CallToolRequest             │                              │
    │  { name, arguments }         │                              │
    │─────────────────────────────►│                              │
    │                              │                              │
    │                              │  Check session still valid   │
    │                              │  (not expired/revoked)       │
    │                              │                              │
    │                              │  Look up ActionSpec by       │
    │                              │  tool name in registry       │
    │                              │                              │
    │                              │  Parse arguments against     │
    │                              │  spec.input (Zod schema)     │
    │                              │                              │
    │                              │  Check grant allows action   │
    │                              │                              │
    │                              │  Build HandlerContext:       │
    │                              │    requestId: randomUUID()   │
    │                              │    signal: timeout signal    │
    │                              │    sessionId: from session   │
    │                              │    brokerId: from deps       │
    │                              │                              │
    │                              │  handler(parsedInput, ctx)   │
    │                              │─────────────────────────────►│
    │                              │  Result<T, BrokerError>      │
    │                              │◄─────────────────────────────│
    │                              │                              │
    │                              │  toActionResult(result, meta)│
    │                              │                              │
    │                              │  Format as MCP content       │
    │                              │                              │
    │  CallToolResult              │                              │
    │  { content, isError? }       │                              │
    │◄─────────────────────────────│                              │
```

### Input Schema Conversion

Zod schemas are converted to JSON Schema for MCP tool registration using `zodToJsonSchema()`:

```typescript
import { zodToJsonSchema } from "zod-to-json-schema";

const jsonSchema = zodToJsonSchema(spec.input, {
  $refStrategy: "none",        // inline all refs for MCP compatibility
  errorMessages: true,         // include Zod error messages in schema
});
```

The `$refStrategy: "none"` option is important -- MCP clients do not resolve `$ref` pointers, so all type definitions must be inlined.

### Output Formatting

Handler results are converted to MCP content blocks:

**Success case:**
```typescript
{
  content: [
    {
      type: "text",
      text: JSON.stringify(actionResult, null, 2),
    },
  ],
  isError: false,
}
```

**Error case:**
```typescript
{
  content: [
    {
      type: "text",
      text: JSON.stringify(actionResult, null, 2),
    },
  ],
  isError: true,
}
```

Both cases serialize the full `ActionResult` envelope as formatted JSON. The MCP client (AI agent) receives the complete envelope including `meta` and `error.category`, which gives it enough context to decide on retry behavior, user messaging, etc.

### Streaming Limitation

MCP's request/response model does not natively support persistent event streams like WebSocket does. For v0:

- **`message.list`** returns a paginated snapshot. The MCP caller polls for new messages by calling `message.list` with a cursor or timestamp filter.
- **No `message.stream` tool.** Real-time streaming is a WebSocket concern. MCP callers that need real-time updates should use the WebSocket transport instead.

If MCP notifications become widely supported by MCP clients, a notification-based event push mechanism can be added in a future version.

### Stdio Transport

In stdio mode, the MCP server communicates via stdin/stdout using JSON-RPC 2.0 framing as defined by the MCP specification. The `@modelcontextprotocol/sdk` handles all framing mechanics.

```typescript
const transport = new StdioServerTransport();
await server.connect(transport);
```

Stderr is available for logging. The MCP server logs to stderr to avoid corrupting the JSON-RPC stream on stdout.

### Daemon-Embedded Mode

When running inside the broker daemon, the MCP server shares the daemon's process and runtime context:

```typescript
// In the daemon's startup sequence:
const mcpServer = createMcpServer(
  { mode: "embedded", sessionToken: agentSessionToken },
  {
    registry: daemon.registry,
    brokerId: daemon.brokerId,
    signerProvider: daemon.signerProvider,
    sessionManager: daemon.sessionManager,
  },
);
await mcpServer.start();

// In the daemon's shutdown sequence:
await mcpServer.stop();
```

In embedded mode, the MCP server does not create a `StdioServerTransport`. Instead, it exposes its `Server` instance for the daemon to connect to whatever transport it provides (e.g., a Unix socket or named pipe). The exact embedded transport mechanism is defined by the daemon spec (not this spec).

### HandlerContext Construction

MCP constructs `HandlerContext` with session-scoped fields, matching the WebSocket pattern:

```typescript
{
  brokerId: deps.brokerId,
  signerProvider: deps.signerProvider,
  requestId: crypto.randomUUID(),
  signal: AbortSignal.timeout(config.requestTimeoutMs),
  sessionId: cachedSession.sessionId,
  // no adminAuth -- MCP is session-scoped, not admin
}
```

This is intentionally parallel to the WebSocket adapter's context construction. Both transports authenticate via session token, both populate `sessionId`, neither populates `adminAuth`.

### Graceful Shutdown

```
stop() called
    │
    ▼
Set state = "stopping"
    │
    ▼
Wait for in-flight CallTool requests to complete
(up to requestTimeoutMs)
    │
    ▼
Close MCP transport
    │
    ▼
Set state = "stopped"
```

In stdio mode, closing the transport causes the process to exit. In embedded mode, the MCP server simply stops accepting new requests; the daemon process continues running.

### Error Mapping

Handler errors are mapped to MCP responses through the ActionResult envelope:

| Handler Result | ActionResult | MCP Response |
|---------------|-------------|-------------|
| `ok(data)` | `{ ok: true, data }` | `{ content: [...], isError: false }` |
| `err(ValidationError)` | `{ ok: false, error: { category: "validation" } }` | `{ content: [...], isError: true }` |
| `err(NotFoundError)` | `{ ok: false, error: { category: "not_found" } }` | `{ content: [...], isError: true }` |
| `err(PermissionError)` | `{ ok: false, error: { category: "permission" } }` | `{ content: [...], isError: true }` |
| `err(AuthError)` | `{ ok: false, error: { category: "auth" } }` | `{ content: [...], isError: true }` |
| `err(InternalError)` | `{ ok: false, error: { category: "internal" } }` | `{ content: [...], isError: true }` |
| Handler throws | `{ ok: false, error: { category: "internal" } }` | `{ content: [...], isError: true }` |
| Unknown tool name | -- | MCP-level error (tool not found) |
| Session expired/revoked | `{ ok: false, error: { category: "auth" } }` | `{ content: [...], isError: true }` + server shutdown |

The `isError` flag tells the MCP client whether the tool invocation succeeded. The `error.category` inside the ActionResult envelope gives the AI agent semantic context for deciding what to do next.

### Tool Annotations

MCP tool annotations are populated from `McpSurface` metadata:

```typescript
{
  readOnlyHint: spec.mcp.readOnly,
  destructiveHint: spec.mcp.destructive ?? false,
}
```

These hints help MCP clients make UI decisions (e.g., requiring confirmation for destructive tools, batching read-only tools).

## Error Cases

| Scenario | Error | MCP Behavior |
|----------|-------|-------------|
| Invalid session token at startup | `AuthError` | Server fails to start |
| Session expired during operation | `AuthError` | `isError: true`, server initiates shutdown |
| Session revoked during operation | `AuthError` | `isError: true`, server initiates shutdown |
| Grant denies requested action | `PermissionError` | `isError: true`, envelope with grant details |
| Conversation outside view scope | `PermissionError` | `isError: true`, envelope with view details |
| Unknown tool name in CallTool | -- | MCP SDK returns method-not-found error |
| Input fails Zod validation | `ValidationError` | `isError: true`, envelope with validation details |
| Handler returns `err()` | varies | `isError: true`, envelope with error details |
| Handler throws (bug) | `InternalError` | `isError: true`, generic internal error |
| Handler exceeds timeout | `TimeoutError` | `isError: true`, timeout error |
| Signal cancelled | `CancelledError` | `isError: true`, cancelled error |
| Stdio transport disconnected | -- | Process exits (stdio mode) |
| Registry has no MCP actions | -- | Server starts with zero tools; ListTools returns empty |

## Open Questions Resolved

**Q: Should MCP callers authenticate as admin or as a session?**
**A:** As a session. MCP callers are agent participants in conversations, not broker administrators. The session token provides the same scoped access as WebSocket -- view-filtered reads, grant-checked writes. Admin operations (daemon lifecycle, session management, key rotation, attestation management) stay in the CLI with admin key JWT auth. This is consistent with the Convos approach where agents interact with the messaging layer, not the infrastructure layer.

**Q: Where does the session token come from?**
**A:** From the MCP server configuration, provided by the MCP client at process launch. In stdio mode, the MCP client (Claude Code, Cursor) passes the token via its config block, typically as an environment variable (`XMTP_BROKER_SESSION_TOKEN`). The token is validated at startup and the session record is cached. Each tool call performs a lightweight liveness check (expiry + revocation via `sessionManager.isActive()`). The admin obtains the session token via the CLI (`broker session:issue`) and configures the MCP client with it.

**Q: Which MCP SDK to use -- `@modelcontextprotocol/sdk` or a lighter alternative?**
**A:** `@modelcontextprotocol/sdk`. It is the official SDK maintained by Anthropic, provides full protocol compliance, handles all framing mechanics, and works with Bun via stdio. The SDK is lightweight (~15KB bundled) and well-tested. Rolling a custom implementation would be premature optimization and a maintenance burden.

**Q: How should streaming/real-time updates work in MCP?**
**A:** They don't, in v0. MCP is request/response. Message listing uses pagination and the MCP caller polls when it needs updates. Real-time event streaming is the WebSocket transport's strength. If MCP notifications gain wide client support, a push mechanism can be layered on later.

**Q: Should output be structured (JSON) or human-readable?**
**A:** JSON (the full ActionResult envelope). MCP clients are AI agents that parse structured data. Human-readable formatting is the CLI's concern. The ActionResult envelope gives the AI agent all the context it needs (data, error category, request ID, duration) in a parseable format.

**Q: How does embedded mode differ from stdio mode?**
**A:** Embedded mode skips `StdioServerTransport` creation. The MCP `Server` instance is exposed for the daemon to connect to its own transport. All other behavior (token validation, tool registration, request handling, ActionResult formatting) is identical. The mode flag controls only transport initialization, not protocol behavior.

## Deferred

- **SSE/HTTP transport.** MCP supports Server-Sent Events for remote connections. v0 uses stdio only. SSE transport enables remote MCP clients but requires additional auth considerations.
- **MCP notifications for events.** Push-based event delivery via MCP notifications. Requires MCP client support, which is not yet widespread. v0 uses polling via `message.list`.
- **Resource endpoints.** MCP supports `resources/read` for exposing data. v0 uses tools only. Resources could expose conversation history, identity info, etc. Deferred until the tool set stabilizes.
- **Prompt templates.** MCP supports `prompts/list` for pre-built prompt templates. Deferred as a convenience layer on top of the tool set.
- **Tool pagination.** For large action registries, MCP supports paginated `ListTools` responses. v0 expects < 10 tools, so pagination is unnecessary.
- **Multi-session MCP.** A single MCP server serving multiple sessions (e.g., for multi-agent scenarios). v0 is one session per MCP server instance.
- **Session refresh.** Automatic session token refresh when nearing expiry. v0 shuts down on session expiry; the MCP client must be restarted with a fresh token.
- **Draft/confirmation flow.** The WebSocket transport supports `draftOnly` messages that require confirmation. MCP could support this via a two-step tool flow (send draft, confirm draft), but it is deferred until the pattern is validated over WebSocket.

## Testing Strategy

### What to Test

1. **Session validation** -- Valid token resolves to a SessionRecord. Invalid/expired token prevents startup.
2. **Tool registration** -- ActionSpecs with `mcp` metadata produce correct MCP tool definitions. Specs without `mcp` are excluded.
3. **Input schema conversion** -- `zodToJsonSchema()` produces valid JSON Schema from Zod input schemas. Refs are inlined.
4. **CallTool routing** -- Requests route to the correct handler based on tool name.
5. **Grant enforcement** -- Tool calls denied by the session's grant return `permission` error.
6. **View enforcement** -- List operations filtered to the session's view scope.
7. **Input validation** -- Invalid arguments produce `isError: true` with validation details.
8. **Output formatting** -- Success and error ActionResults are serialized as MCP text content blocks.
9. **Tool annotations** -- `readOnlyHint` and `destructiveHint` are set from `McpSurface` metadata.
10. **Session expiry** -- Expired session produces `auth` error and triggers shutdown.
11. **Graceful shutdown** -- In-flight requests complete before the server stops.
12. **HandlerContext construction** -- Context includes `requestId`, `signal`, `sessionId`, and `brokerId`. Does NOT include `adminAuth`.

### How to Test

**Unit tests**: Mock the `ActionRegistry` and `SessionManager`. Test session validation, tool registration, grant/view enforcement, input validation, output formatting, and error mapping in isolation. The `@modelcontextprotocol/sdk` `Server` can be instantiated without a transport for unit testing.

**Integration tests**: Start an MCP server with stdio transport piped to an in-process client. Send `ListTools` and `CallTool` requests and verify responses. Use mock handlers that return canned Results.

### Key Test Scenarios

```typescript
// Session validation at startup
const server = createTestMcpServer({ sessionToken: validToken });
await server.start();
expect(server.state).toBe("running");

const badServer = createTestMcpServer({ sessionToken: "invalid" });
const result = await badServer.start();
expect(result.ok).toBe(false);

// Tool registration from ActionSpec
const spec = createTestActionSpec("message.send", {
  mcp: {
    toolName: "broker/message/send",
    description: "Send a message to a conversation",
    readOnly: false,
  },
});
const tool = actionSpecToMcpTool(spec);
expect(tool.name).toBe("broker/message/send");
expect(tool.description).toBe("Send a message to a conversation");
expect(tool.annotations?.readOnlyHint).toBe(false);
expect(tool.inputSchema).toBeDefined();

// Admin-only spec excluded from MCP
const adminOnly = createTestActionSpec("session.revoke", { cli: cliMeta });
const registry = createActionRegistry();
registry.register(spec);
registry.register(adminOnly);
const mcpSpecs = registry.listForSurface("mcp");
expect(mcpSpecs).toHaveLength(1);
expect(mcpSpecs[0].id).toBe("message.send");

// CallTool success
const server = createTestMcpServer({ registry });
const response = await server.handleCallTool({
  name: "broker/message/send",
  arguments: {
    conversationId: "conv_1",
    content: { text: "hello" },
  },
});
expect(response.isError).toBe(false);
const result = JSON.parse(response.content[0].text);
expect(result.ok).toBe(true);

// CallTool grant denied
const response2 = await server.handleCallTool({
  name: "broker/conversation/create",
  arguments: { name: "new group" },
});
// (mock session grant does not include conversation.create)
expect(response2.isError).toBe(true);
const result2 = JSON.parse(response2.content[0].text);
expect(result2.error.category).toBe("permission");

// CallTool view filtering
const response3 = await server.handleCallTool({
  name: "broker/message/list",
  arguments: { conversationId: "conv_outside_view" },
});
expect(response3.isError).toBe(true);
const result3 = JSON.parse(response3.content[0].text);
expect(result3.error.category).toBe("permission");

// HandlerContext has sessionId, no adminAuth
const capturedCtx = await captureHandlerContext(server, "broker/message/list");
expect(capturedCtx.sessionId).toBeDefined();
expect(capturedCtx.adminAuth).toBeUndefined();
expect(capturedCtx.requestId).toBeDefined();
expect(capturedCtx.signal).toBeInstanceOf(AbortSignal);

// Session expiry triggers shutdown
mockSessionManager.expireSession(validToken);
const response4 = await server.handleCallTool({
  name: "broker/message/list",
  arguments: { conversationId: "conv_1" },
});
expect(response4.isError).toBe(true);
const result4 = JSON.parse(response4.content[0].text);
expect(result4.error.category).toBe("auth");
expect(server.state).toBe("stopping");

// Input schema conversion
const schema = z.object({
  conversationId: z.string(),
  limit: z.number().int().positive().optional(),
});
const jsonSchema = zodToJsonSchema(schema, { $refStrategy: "none" });
expect(jsonSchema.properties.conversationId.type).toBe("string");
expect(jsonSchema.required).toContain("conversationId");

// Tool annotations
const readOnlySpec = createTestActionSpec("conversation.list", {
  mcp: {
    toolName: "broker/conversation/list",
    description: "List conversations",
    readOnly: true,
  },
});
const tool2 = actionSpecToMcpTool(readOnlySpec, "broker");
expect(tool2.annotations?.readOnlyHint).toBe(true);
expect(tool2.annotations?.destructiveHint).toBe(false);
```

### Test Utilities

```typescript
/** Create an MCP server with mocked deps for testing. */
function createTestMcpServer(
  overrides?: Partial<McpServerDeps & McpServerConfig>,
): McpServer & {
  /** Simulate a CallTool request without a transport. */
  handleCallTool(request: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

  /** Simulate a ListTools request without a transport. */
  handleListTools(): Promise<{ tools: McpToolRegistration[] }>;
};

/** Create a pair of stdio streams for integration testing. */
function createTestStdioPair(): {
  clientIn: Readable;
  clientOut: Writable;
  serverIn: Readable;
  serverOut: Writable;
};

/** Capture the HandlerContext passed to a handler during a tool call. */
async function captureHandlerContext(
  server: McpServer,
  toolName: string,
): Promise<HandlerContext>;
```

## File Layout

```
packages/mcp/
  package.json
  tsconfig.json
  src/
    index.ts                    # Re-exports public API
    config.ts                   # McpServerConfigSchema
    server.ts                   # createMcpServer(), McpServer implementation
    tool-registration.ts        # actionSpecToMcpTool(), zodToJsonSchema bridge
    call-handler.ts             # CallTool request handling: validate, grant check, invoke, format
    output-formatter.ts         # ActionResult -> MCP content blocks
    context-factory.ts          # Build HandlerContext for MCP callers (session-scoped)
    session-guard.ts            # Session validation, expiry detection, shutdown trigger
    bin/
      mcp-server.ts             # Standalone stdio entry point
    __tests__/
      tool-registration.test.ts # ActionSpec -> MCP tool conversion
      call-handler.test.ts      # Request routing, validation, grant enforcement, error mapping
      output-formatter.test.ts  # ActionResult -> MCP content formatting
      context-factory.test.ts   # HandlerContext construction (sessionId, no adminAuth)
      session-guard.test.ts     # Token validation, expiry, revocation
      server.integration.test.ts # Full stdio roundtrip tests
      fixtures.ts               # Test utilities
```

Each source file targets under 150 LOC. The `server.ts` orchestrates but delegates to `tool-registration.ts`, `call-handler.ts`, `output-formatter.ts`, and `session-guard.ts` for the four main concerns.

### Package Configuration

```jsonc
{
  "name": "@xmtp-broker/mcp",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "bin": {
    "xmtp-broker-mcp": "./src/bin/mcp-server.ts"
  },
  "scripts": {
    "build": "bun build ./src/index.ts --outdir ./dist --target bun",
    "typecheck": "tsc --noEmit",
    "lint": "oxlint .",
    "test": "bun test"
  },
  "dependencies": {
    "@xmtp-broker/contracts": "workspace:*",
    "@xmtp-broker/schemas": "workspace:*",
    "@xmtp-broker/sessions": "workspace:*",
    "@xmtp-broker/policy": "workspace:*",
    "@modelcontextprotocol/sdk": "1.27.1",
    "better-result": "catalog:",
    "zod": "catalog:",
    "zod-to-json-schema": "catalog:"
  },
  "devDependencies": {
    "typescript": "catalog:"
  }
}
```
