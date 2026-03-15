# Shared Handler Surfaces: Define Once, Expose Everywhere

Extracted from `outfitter/stack` and adapted for xmtp-broker's multi-transport architecture.

## Core Pattern

A single `ActionSpec` object bundles everything needed to expose a domain handler through any transport surface. The handler contains all domain logic; transport adapters are mechanical wiring that reads surface-specific metadata from the same spec.

```
                    ┌──────────────────┐
                    │    ActionSpec     │
                    │                  │
                    │  id              │
                    │  handler(i, ctx) │
                    │  input (Zod)     │
                    │  output (Zod)    │
                    │  cli?            │
                    │  mcp?            │
                    │  ws?             │
                    └──────┬───────────┘
                           │
             ┌─────────────┼─────────────┐
             │             │             │
        ┌────▼────┐   ┌────▼────┐   ┌────▼────┐
        │  CLI    │   │  MCP    │   │   WS    │
        │ adapter │   │ adapter │   │ adapter │
        └─────────┘   └─────────┘   └─────────┘
```

## ActionSpec Shape

```typescript
interface ActionSpec<TInput, TOutput, TError extends BrokerError> {
  readonly id: string;
  readonly handler: Handler<TInput, TOutput, TError>;
  readonly input: z.ZodType<TInput>;
  readonly output?: z.ZodType<TOutput>;
  readonly cli?: CliSurface;
  readonly mcp?: McpSurface;
  readonly surfaces?: readonly ActionSurface[];
}
```

Each surface property is optional. If a spec omits `mcp`, the MCP transport skips it. If it omits `cli`, the CLI adapter skips it. This is the curating mechanism -- you control which actions appear on which surfaces by including or omitting their surface metadata.

## Surface Metadata

### CLI Surface

```typescript
interface CliSurface {
  readonly command: string;           // e.g., "session:list"
  readonly aliases?: readonly string[];
  readonly options?: readonly CliOption[];
  readonly outputFormat?: "table" | "json" | "text";
  readonly group?: string;            // command grouping in help
}
```

CLI adapters read `options` to build argument parsers, `outputFormat` to choose formatters, and `aliases` for shorthand commands. The Zod `input` schema provides validation; the CLI adapter maps parsed args to the schema shape.

### MCP Surface

```typescript
interface McpSurface {
  readonly toolName: string;          // e.g., "broker/session/list"
  readonly description: string;
  readonly readOnly: boolean;
  readonly destructive?: boolean;
  readonly annotations?: Record<string, unknown>;
}
```

MCP adapters convert the Zod `input` schema to JSON Schema via `zodToJsonSchema()`, use `toolName` for registration, and map `readOnly`/`destructive` to MCP tool annotations.

## Co-location Principle

ActionSpecs live alongside their domain handlers in the runtime packages, not in a central registry file. The handler author knows best which surfaces an action should appear on and what the surface-specific metadata should be.

```
packages/sessions/src/
  handlers/
    list-sessions.ts        # Handler function
    list-sessions.spec.ts   # ActionSpec bundling handler + schemas + surface metadata
  __tests__/
    list-sessions.test.ts   # Tests for the handler
```

Transport packages import the specs at startup and wire them into their protocol machinery. This keeps the handler package as the single source of truth.

## Output Envelope: ActionResult

All handler responses are wrapped in a universal envelope before reaching the transport:

```typescript
{
  ok: boolean;
  data?: T;
  error?: {
    _tag: string;
    category: ErrorCategory;
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

The envelope is defined as a Zod schema so transports can validate it and external consumers can generate types from it. Key properties:

- **`ok`** discriminates success/failure. Transports map this to exit codes (CLI), HTTP status (REST), `isError` (MCP), or `ok` field (WebSocket frames).
- **`meta.requestId`** flows from `HandlerContext.requestId` for tracing.
- **`error._tag`** + **`error.category`** give transports enough info to choose the right protocol-level error representation without inspecting the error object.
- **`pagination`** is optional; present only for list operations.

## Transport Adaptation

Each transport reads the ActionResult envelope and translates it:

| Concern | CLI | MCP | WebSocket |
|---------|-----|-----|-----------|
| Success signal | exit 0 | `isError: false` | `ok: true` in response frame |
| Error signal | exit code from category | `isError: true` | `ok: false` in response frame |
| Data format | table/JSON/text (per `outputFormat`) | MCP text content block | JSON in response frame |
| Error detail | stderr + exit code | error content block | `error` field in response |
| Pagination | `--cursor` flag, footer hint | in text content | in response frame |

## Adaptation Notes for xmtp-broker

**What to adopt directly:**
- ActionSpec bundling handler + schema + surface metadata
- Co-location of specs with handlers
- Universal output envelope with Zod schema
- Surface-specific metadata for CLI and MCP
- `zodToJsonSchema()` for MCP tool input schemas

**What to adapt:**
- Outfitter uses `ActionSurface` as an enum listing all surfaces an action appears on. The broker can use the presence/absence of surface metadata objects instead -- simpler and eliminates redundancy.
- Outfitter's `HandlerContext` includes `cwd`, `env`, `workspaceRoot` (filesystem concerns). The broker's `HandlerContext` extends `CoreContext` with `requestId`, `signal`, `adminAuth`, and `sessionId` -- all runtime concerns.
- The WebSocket transport already has its own framing (SequencedFrame, RequestResponse). The ActionResult envelope slots into the response frame's data field rather than replacing it.

**What to defer:**
- HTTP/REST surface (`ApiSurface`). Not in v0.
- CLI builder fluent API. The broker's CLI can start with manual wiring and adopt a builder when the action count justifies it.
- Progress streaming (`progress` callback in context). Broker handlers are fast request/response; long-running ops use events.
