# Transport-Agnostic Handler Patterns

Extracted from `outfitter/stack` as reference for xmtp-broker's broker interface design.

## Core Idea

All domain logic lives in a single handler function. The handler is transport-agnostic — it doesn't know whether it's being called from CLI, MCP, HTTP, or anything else. Transport adapters handle protocol-specific concerns (arg parsing, output formatting, error codes).

## The Handler Contract

```typescript
type Handler<TInput, TOutput, TError extends OutfitterError> = (
  input: TInput,
  ctx: HandlerContext
) => Promise<Result<TOutput, TError>>;
```

- **input**: Pre-validated, typed data matching a Zod schema
- **ctx**: Cross-cutting concerns (config, logger, cwd, env, signal, requestId, progress callback)
- **returns**: `Result<TOutput, TError>` — never throws

## HandlerContext

```typescript
interface HandlerContext {
  config: Config;
  cwd: string;
  env: Record<string, string | undefined>;
  logger: Logger;
  progress?: ProgressCallback;  // streaming updates for long ops
  requestId: string;             // tracing
  signal: AbortSignal;           // cancellation
  workspaceRoot: string;
}
```

## ActionSpec: One Definition, Many Surfaces

An `ActionSpec` bundles a handler with its schema and surface-specific metadata:

```typescript
interface ActionSpec<TInput, TOutput, TError extends OutfitterError> {
  readonly id: string;
  readonly handler: Handler<TInput, TOutput, TError>;
  readonly input: z.ZodType<TInput>;
  readonly output?: z.ZodType<TOutput>;
  readonly cli?: ActionCliSpec<TInput>;    // CLI-specific: options, aliases, mapInput
  readonly mcp?: ActionMcpSpec<TInput>;    // MCP-specific: readOnly, destructive, deferLoading
  readonly api?: ActionApiSpec;            // HTTP-specific
  readonly surfaces?: readonly ActionSurface[];
}
```

Each surface adapter (CLI, MCP, HTTP) reads its specific config from the ActionSpec and wires up the shared handler.

## CLI Surface

CLI commands are built with a fluent builder on top of Commander.js:

```typescript
command("note:get")
  .description("Fetch a note by ID")
  .input(GetNoteInput)              // Zod schema
  .option("--id <id>", "Note ID")
  .action(handler)                   // the shared handler
  .build();
```

The builder handles:
1. Parsing CLI args into raw object
2. Validating against Zod schema
3. Constructing HandlerContext
4. Calling handler
5. Formatting output for terminal (or JSON with `--output=json`)
6. Mapping errors to exit codes

## MCP Surface

MCP tools are registered with the same handler:

```typescript
registerTool({
  name: "notes/get",
  description: "Fetch a note by ID",
  inputSchema: GetNoteInput,         // same Zod schema → auto-converted to JSON Schema
  handler: handler,                   // same handler
  readOnly: true,
});
```

The MCP transport:
1. Receives `CallToolRequest`
2. Validates args against Zod schema
3. Constructs HandlerContext
4. Calls handler
5. Wraps result in MCP protocol envelope (content array with text/structured)
6. Maps errors to `isError: true` responses

## Output Envelope

All responses follow a consistent envelope:

```typescript
{
  ok: boolean;
  data?: T;            // on success
  error?: {            // on failure
    _tag: string;
    category: string;
    message: string;
    context?: Record<string, unknown>;
  };
  meta: {
    requestId: string;
    timestamp: string;
    durationMs: number;
  };
  pagination?: {
    count: number;
    hasMore: boolean;
    nextCursor?: string;
    total?: number;
  };
}
```

## Adaptation Notes for xmtp-broker

**Key insight**: The broker's "derived plane" interface is essentially another transport surface. The same pattern applies:

- **Broker core handlers** contain the domain logic (view filtering, grant enforcement, attestation management)
- **WebSocket transport** adapts handlers for the primary live interface
- **MCP transport** can expose the same handlers as MCP tools (later)
- **CLI transport** can expose them as commands (later)
- **HTTP transport** for REST API (later)

**Adopt:**
- Handler contract pattern (input + context -> Result)
- Zod schemas for all inputs, auto-derived JSON Schema for MCP
- HandlerContext with logger, signal, requestId
- Result return type (never throw)
- ActionSpec-like registration that bundles handler + schema + surface metadata

**Simplify for v1:**
- Start with WebSocket as sole transport
- Don't need the full ActionSpec builder — a simpler registration will do
- Add CLI/MCP/HTTP adapters incrementally as the interface stabilizes
- Keep the schema-first principle from day one so adding transports later is mechanical
