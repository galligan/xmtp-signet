# 10-action-registry

**Package:** `@xmtp-broker/contracts` (ActionSpec, HandlerContext extensions), `@xmtp-broker/schemas` (ActionResult envelope)
**Spec version:** 0.1.0

## Overview

The action registry introduces the "define once, expose everywhere" pattern to xmtp-broker. An `ActionSpec` bundles a handler function with its Zod input schema and per-surface metadata (CLI, MCP) into a single registration unit. Transport adapters consume ActionSpecs to mechanically wire domain logic into their protocol -- no per-transport handler code needed.

This spec adds three things:

1. **`ActionSpec<TInput, TOutput, TError>`** -- the bundling type that connects a handler to its schemas and surface metadata. Lives in `@xmtp-broker/contracts` alongside the existing `Handler` type it references.

2. **`ActionResult<T>`** -- the universal output envelope that all transports render from. Defined as a Zod schema in `@xmtp-broker/schemas` so it can be validated at boundaries and used for type inference.

3. **Extended `HandlerContext`** -- adds `requestId`, `signal`, and optional `adminAuth`/`sessionId` to the existing `CoreContext`-based `HandlerContext`. These fields are needed by all handlers regardless of transport.

4. **`ActionRegistry`** -- a simple registry for ActionSpec registration and lookup. Transport adapters query the registry at startup to discover which actions they should expose.

The ActionSpec type is deliberately minimal. It does not prescribe how transports consume it -- each transport reads the surface metadata it cares about and ignores the rest. This keeps the contract stable as new transports are added.

## Dependencies

**Imports:**
- `@xmtp-broker/schemas` -- `BrokerError`, `ErrorCategory`, Zod (for ActionResult schema)
- `better-result` -- `Result` (in Handler signature)

**Imported by:**
- All runtime packages that define handlers (`core`, `sessions`, `policy`, `attestations`)
- All transport packages (`ws`, `mcp`, future CLI)

## Public Interfaces

### ActionSpec

```typescript
/**
 * Bundles a handler with its input schema and per-surface metadata.
 * Transport adapters consume ActionSpecs to wire domain logic into
 * their protocol. Co-located with handlers in runtime packages.
 */
interface ActionSpec<
  TInput,
  TOutput,
  TError extends BrokerError = BrokerError,
> {
  /** Unique action identifier. Convention: `{domain}.{verb}` (e.g., `session.list`). */
  readonly id: string;

  /** The transport-agnostic handler function. */
  readonly handler: Handler<TInput, TOutput, TError>;

  /** Zod schema for input validation. Transports parse raw input against this. */
  readonly input: z.ZodType<TInput>;

  /** Zod schema for output validation. Optional; used for documentation and testing. */
  readonly output?: z.ZodType<TOutput>;

  /** CLI surface metadata. Omit to exclude from CLI. */
  readonly cli?: CliSurface;

  /** MCP surface metadata. Omit to exclude from MCP. */
  readonly mcp?: McpSurface;
}
```

### CliSurface

```typescript
/**
 * CLI-specific metadata for an ActionSpec.
 * The CLI adapter uses this to build commands, parse arguments,
 * and format output.
 */
interface CliSurface {
  /** Command name. Colon-delimited for namespacing (e.g., `session:list`). */
  readonly command: string;

  /**
   * JSON-RPC method name for admin socket dispatch.
   * Dot-delimited (e.g., `session.list`). Derived from `command` by
   * replacing `:` with `.` if not explicitly set.
   */
  readonly rpcMethod?: string;

  /** Short aliases (e.g., `["sl"]`). */
  readonly aliases?: readonly string[];

  /** CLI option definitions. Maps CLI flags to input schema fields. */
  readonly options?: readonly CliOption[];

  /** Default output format for this command. */
  readonly outputFormat?: "table" | "json" | "text";

  /** Command group for help text organization. */
  readonly group?: string;

  /** One-line description for help text. */
  readonly description?: string;
}

interface CliOption {
  /** Flag definition (e.g., `"--group-id <id>"`). */
  readonly flag: string;

  /** Human-readable description. */
  readonly description: string;

  /** Input schema field this maps to. Dot-path for nested fields. */
  readonly field: string;

  /** Whether this option is required. Defaults to false. */
  readonly required?: boolean;
}
```

### McpSurface

```typescript
/**
 * MCP-specific metadata for an ActionSpec.
 * The MCP adapter uses this to register tools with the MCP server.
 */
interface McpSurface {
  /**
   * MCP tool name. Convention: `broker/{group}/{action}`
   * (e.g., `broker/session/list`).
   */
  readonly toolName: string;

  /** Human-readable tool description for the MCP tool listing. */
  readonly description: string;

  /** Whether this tool only reads data (no side effects). */
  readonly readOnly: boolean;

  /**
   * Whether this tool performs destructive/irreversible operations.
   * MCP clients may require confirmation for destructive tools.
   */
  readonly destructive?: boolean;

  /**
   * Additional MCP tool annotations. Passed through to the MCP
   * server as-is. See MCP spec for supported annotation keys.
   */
  readonly annotations?: Record<string, unknown>;
}
```

### Extended HandlerContext

The existing `HandlerContext` extends `CoreContext` with no additional fields. This spec adds the fields that all handlers need regardless of transport:

```typescript
/**
 * Canonical handler context. Extends CoreContext with cross-cutting
 * concerns needed by all handlers.
 */
interface HandlerContext extends CoreContext {
  /** Unique identifier for this request. Used in ActionResult.meta and tracing. */
  readonly requestId: string;

  /** Cancellation signal. Handlers should check this for long operations. */
  readonly signal: AbortSignal;

  /**
   * Admin authentication context. Present when the caller is the broker
   * admin (CLI, local MCP). Absent for harness sessions.
   */
  readonly adminAuth?: AdminAuthContext;

  /**
   * Session identifier. Present when the caller is an authenticated
   * harness session. Absent for admin callers.
   */
  readonly sessionId?: string;
}

/**
 * Authentication context for admin callers. The admin key proves
 * the caller has root access to the broker.
 */
interface AdminAuthContext {
  /** Fingerprint of the admin key used for authentication. */
  readonly adminKeyFingerprint: string;
}
```

### ActionResult Envelope

```typescript
/**
 * Universal output envelope. All transports render from this shape.
 * Defined as a Zod schema for boundary validation and type inference.
 */
const ActionResultSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    ok: z.literal(true),
    data: dataSchema,
    meta: ActionResultMetaSchema,
    pagination: PaginationSchema.optional(),
  });

const ActionErrorResultSchema = z.object({
  ok: z.literal(false),
  error: ActionErrorSchema,
  meta: ActionResultMetaSchema,
});

const ActionResultMetaSchema = z.object({
  requestId: z.string()
    .describe("Correlates with HandlerContext.requestId"),
  timestamp: z.string().datetime()
    .describe("ISO 8601 timestamp of response creation"),
  durationMs: z.number().nonnegative()
    .describe("Handler execution time in milliseconds"),
}).describe("Response metadata present on every ActionResult");

type ActionResultMeta = z.infer<typeof ActionResultMetaSchema>;

const ActionErrorSchema = z.object({
  _tag: z.string()
    .describe("Error discriminant (e.g., 'ValidationError')"),
  category: ErrorCategory
    .describe("Error category for cross-transport mapping"),
  message: z.string()
    .describe("Human-readable error description"),
  context: z.record(z.string(), z.unknown()).nullable()
    .describe("Structured error context, null if none"),
}).describe("Error detail in a failed ActionResult");

type ActionError = z.infer<typeof ActionErrorSchema>;

const PaginationSchema = z.object({
  count: z.number().int().nonnegative()
    .describe("Number of items in this page"),
  hasMore: z.boolean()
    .describe("Whether more items exist beyond this page"),
  nextCursor: z.string().optional()
    .describe("Opaque cursor for the next page"),
  total: z.number().int().nonnegative().optional()
    .describe("Total item count, if known"),
}).describe("Pagination metadata for list operations");

type Pagination = z.infer<typeof PaginationSchema>;
```

Usage:

```typescript
// For a specific action's success type:
const ListSessionsResultSchema = ActionResultSchema(
  z.array(SessionTokenSchema)
);

// The discriminated union of success/error:
type ActionResult<T> =
  | { ok: true; data: T; meta: ActionResultMeta; pagination?: Pagination }
  | { ok: false; error: ActionError; meta: ActionResultMeta };
```

### ActionRegistry

```typescript
/**
 * Registry for ActionSpec instances. Transport adapters query the
 * registry at startup to discover actions they should expose.
 */
interface ActionRegistry {
  /**
   * Register an ActionSpec. Throws if an action with the same id
   * is already registered (fail-fast for duplicate registrations).
   */
  register(spec: ActionSpec<unknown, unknown, BrokerError>): void;

  /** Look up an ActionSpec by id. Returns undefined if not found. */
  lookup(id: string): ActionSpec<unknown, unknown, BrokerError> | undefined;

  /** List all registered ActionSpecs. */
  list(): readonly ActionSpec<unknown, unknown, BrokerError>[];

  /**
   * List ActionSpecs that have a specific surface.
   * Convenience for transport adapters.
   */
  listForSurface(surface: "cli" | "mcp"): readonly ActionSpec<unknown, unknown, BrokerError>[];

  /** Number of registered actions. */
  readonly size: number;
}

/**
 * Create an ActionRegistry instance.
 * The registry is an in-memory Map. No persistence, no async.
 */
function createActionRegistry(): ActionRegistry;
```

### Result-to-Envelope Conversion

```typescript
/**
 * Convert a handler Result into an ActionResult envelope.
 * Called by transport adapters after handler execution.
 */
function toActionResult<T>(
  result: Result<T, BrokerError>,
  meta: ActionResultMeta,
  pagination?: Pagination,
): ActionResult<T>;
```

This function is the bridge between the handler world (returns `Result<T, BrokerError>`) and the transport world (renders `ActionResult<T>`). It extracts `_tag`, `category`, `message`, and `context` from the error case and wraps the success case with `ok: true`.

## Zod Schemas

All Zod schemas are defined inline in the Public Interfaces section above. Summary of where they live:

| Schema | Package | File |
|--------|---------|------|
| `ActionResultMetaSchema` | `@xmtp-broker/schemas` | `src/result/action-result.ts` |
| `ActionErrorSchema` | `@xmtp-broker/schemas` | `src/result/action-result.ts` |
| `PaginationSchema` | `@xmtp-broker/schemas` | `src/result/action-result.ts` |
| `ActionResultSchema` (factory) | `@xmtp-broker/schemas` | `src/result/action-result.ts` |
| `ActionErrorResultSchema` | `@xmtp-broker/schemas` | `src/result/action-result.ts` |

The `ActionSpec`, `CliSurface`, `McpSurface`, and registry types are plain TypeScript interfaces in `@xmtp-broker/contracts`. They are not Zod schemas because they are internal compile-time contracts, not wire formats validated at boundaries.

## Behaviors

### Action Registration Flow

```
Runtime packages                 Registry               Transport adapters
                                                          (at startup)
     │                              │                          │
     │  register(sessionListSpec)   │                          │
     │─────────────────────────────►│                          │
     │  register(sessionRevokeSpec) │                          │
     │─────────────────────────────►│                          │
     │  register(messageListSpec)   │                          │
     │─────────────────────────────►│                          │
     │                              │                          │
     │                              │  listForSurface("mcp")  │
     │                              │◄─────────────────────────│
     │                              │  [sessionListSpec,       │
     │                              │   messageListSpec]       │
     │                              │─────────────────────────►│
     │                              │                          │
     │                              │  listForSurface("cli")  │
     │                              │◄─────────────────────────│
     │                              │  [sessionListSpec,       │
     │                              │   sessionRevokeSpec,     │
     │                              │   messageListSpec]       │
     │                              │─────────────────────────►│
```

1. Runtime packages register their ActionSpecs during broker initialization (before any transport starts).
2. Transport adapters query the registry for actions relevant to their surface.
3. Each transport wires the returned specs into its protocol machinery.

### Handler Execution Flow (Transport-Agnostic)

```
Transport adapter         Zod schema              Handler              toActionResult
      │                       │                      │                       │
      │  raw input arrives    │                      │                       │
      │  parse(rawInput)      │                      │                       │
      │──────────────────────►│                      │                       │
      │  validatedInput       │                      │                       │
      │◄──────────────────────│                      │                       │
      │                       │                      │                       │
      │  handler(validatedInput, ctx)                │                       │
      │─────────────────────────────────────────────►│                       │
      │  Result<T, BrokerError>                      │                       │
      │◄─────────────────────────────────────────────│                       │
      │                                              │                       │
      │  toActionResult(result, meta, pagination?)                           │
      │─────────────────────────────────────────────────────────────────────►│
      │  ActionResult<T>                                                     │
      │◄─────────────────────────────────────────────────────────────────────│
      │                                              │                       │
      │  render ActionResult via transport protocol  │                       │
```

Every transport follows this same flow. The differences are:
- **Where raw input comes from** (CLI args, MCP CallToolRequest, WS frame).
- **How ActionResult is rendered** (exit code + stdout, MCP content blocks, WS response frame).
- **How HandlerContext is constructed** (CLI populates `adminAuth`, WS populates `sessionId`).

### Action ID Convention

Action IDs use `{domain}.{verb}` format:

| Domain | Example IDs |
|--------|-------------|
| `session` | `session.list`, `session.issue`, `session.revoke`, `session.inspect` |
| `message` | `message.send`, `message.list` |
| `group` | `group.list`, `group.info` |
| `attestation` | `attestation.current`, `attestation.refresh`, `attestation.revoke` |
| `broker` | `broker.status`, `broker.start`, `broker.stop` |
| `key` | `key.list`, `key.rotate` |

The ID is used for registry lookup and logging. Surface-specific names (CLI command, MCP tool name) are defined in their respective surface metadata and can differ from the action ID.

### HandlerContext Construction

Each transport constructs `HandlerContext` differently:

**CLI adapter:**
```typescript
{
  brokerId: config.brokerId,
  signerProvider: config.signerProvider,
  requestId: crypto.randomUUID(),
  signal: AbortSignal.timeout(30_000),
  adminAuth: { adminKeyFingerprint: verifiedFingerprint },
  // no sessionId -- CLI is admin-only
}
```

**MCP adapter:**
```typescript
{
  brokerId: config.brokerId,
  signerProvider: config.signerProvider,
  requestId: crypto.randomUUID(),
  signal: AbortSignal.timeout(30_000),
  sessionId: cachedSession.sessionId,
  // no adminAuth -- MCP is harness/session-scoped
}
```

**WebSocket adapter:**
```typescript
{
  brokerId: config.brokerId,
  signerProvider: config.signerProvider,
  requestId: frame.requestId,
  signal: AbortSignal.timeout(30_000),
  sessionId: connection.sessionRecord.sessionId,
  // no adminAuth -- WS is session-scoped
}
```

### Surface Filtering

The `listForSurface` method returns only specs that have the requested surface metadata:

```typescript
listForSurface(surface: "cli" | "mcp"): readonly ActionSpec[] {
  return [...this.specs.values()].filter(spec => spec[surface] != null);
}
```

This is the curating mechanism. Lifecycle commands (start, stop) include `cli` metadata but omit `mcp` metadata, so they appear in the CLI but not in MCP. Read-only query commands include both. The handler author makes this decision at the spec definition site.

### Duplicate Registration

Calling `register()` with an action ID that already exists throws immediately. This is a programming error (two packages both defining an action with the same ID), not a runtime condition. Fail-fast prevents subtle routing bugs.

## Error Cases

| Scenario | Error | Category |
|----------|-------|----------|
| Duplicate action ID registration | Throws `Error` (programming bug, not `BrokerError`) | -- |
| Input fails Zod validation | `ValidationError` | validation |
| Handler returns `err()` | Error propagated through `toActionResult` | varies |
| Handler throws (bug) | Caught by transport, wrapped as `InternalError` | internal |
| Signal aborted before completion | `CancelledError` | cancelled |
| Handler exceeds timeout | `TimeoutError` (from AbortSignal) | timeout |

Note: the registry itself has no error cases beyond the duplicate check. All other errors originate in the handler or the transport's input parsing.

## Open Questions Resolved

**Q: Where does ActionSpec live -- contracts or a new package?**
**A:** In `@xmtp-broker/contracts`. ActionSpec is a cross-package interface (runtime packages implement it, transport packages consume it). That is exactly what the contracts package is for. Adding a new package for a single type + a registry function is overengineering.

**Q: Should the registry be async?**
**A:** No. The registry is an in-memory Map. Registration happens synchronously during broker initialization before any transport starts listening. There is no persistence, no I/O, no reason for async.

**Q: Should ActionResult be a class or a plain object?**
**A:** Plain object with a Zod schema. ActionResult crosses process boundaries (WebSocket, MCP stdio) and must be serializable. A class would add methods that are lost on serialization. The Zod schema provides validation and type inference.

**Q: Should HandlerContext changes be backward-compatible with existing specs?**
**A:** Yes. The new fields (`requestId`, `signal`, `adminAuth`, `sessionId`) are all additive. `requestId` and `signal` are required but were not on the previous empty extension. Since no handlers exist yet (early development), this is a non-breaking change. If handlers existed, `requestId` and `signal` would need to be optional or the interface would need a major version bump.

**Q: How does ActionResult relate to the existing WebSocket `RequestResponse`?**
**A:** ActionResult replaces the inline response shape. The WebSocket transport wraps ActionResult in its frame envelope (adding `requestId` correlation at the frame level). The `ok`/`data`/`error` structure is the same -- ActionResult formalizes what the WS spec already described informally.

## Deferred

- **HTTP/REST surface (`ApiSurface`).** No HTTP transport in v0. The surface metadata type can be added when the HTTP transport is specced.
- **CLI builder fluent API.** v0 CLI (if built) can wire commands manually. A builder that reads `CliSurface` and auto-generates Commander.js commands is a Phase 2 convenience.
- **Progress streaming.** Outfitter's `HandlerContext` includes a `progress` callback for long-running operations. Broker handlers are request/response; long-running state changes use the event stream. Deferred until a handler genuinely needs progress reporting.
- **Action versioning.** Action IDs are unversioned in v0. If input schemas change incompatibly, the action ID changes (e.g., `session.list` -> `session.list_v2`). A formal versioning scheme is deferred.
- **Dynamic registration.** Plugins that register actions at runtime (after transports start). v0 assumes a fixed set of actions registered at startup.
- **Action middleware.** Cross-cutting concerns (logging, metrics, auth checks) applied to all handlers. v0 handles these in each transport adapter. A middleware pipeline is deferred until patterns emerge.

## Testing Strategy

### What to Test

1. **ActionRegistry registration** -- Register succeeds, duplicate throws, lookup returns correct spec.
2. **ActionRegistry surface filtering** -- `listForSurface("mcp")` returns only specs with `mcp` metadata.
3. **ActionResult construction** -- `toActionResult` correctly wraps success and error cases.
4. **ActionResult schema validation** -- Success and error envelopes validate against their schemas.
5. **HandlerContext construction** -- Each transport builds a valid context with the correct fields.
6. **Input validation flow** -- Raw input parsed against Zod schema, validation errors produce correct ActionResult.

### How to Test

**Unit tests** for the registry and `toActionResult`. These are pure functions with no I/O.

**Schema tests** for ActionResult -- round-trip through `z.parse()` to ensure the schema accepts valid envelopes and rejects malformed ones.

**Integration tests** are per-transport (tested in 08-ws, 14-mcp, etc.). Each transport tests that it correctly discovers specs from the registry and renders ActionResults through its protocol.

### Key Test Scenarios

```typescript
// Registry: register and lookup
const registry = createActionRegistry();
const spec = createTestActionSpec("session.list");
registry.register(spec);
expect(registry.lookup("session.list")).toBe(spec);
expect(registry.size).toBe(1);

// Registry: duplicate throws
expect(() => registry.register(spec)).toThrow();

// Registry: surface filtering
const cliOnly = createTestActionSpec("broker.stop", { cli: cliMeta });
const mcpOnly = createTestActionSpec("message.list", { mcp: mcpMeta });
const both = createTestActionSpec("session.list", { cli: cliMeta, mcp: mcpMeta });
registry.register(cliOnly);
registry.register(mcpOnly);
registry.register(both);
expect(registry.listForSurface("mcp")).toHaveLength(2); // mcpOnly + both
expect(registry.listForSurface("cli")).toHaveLength(2); // cliOnly + both

// toActionResult: success
const result = ok({ sessions: [] });
const meta = { requestId: "r1", timestamp: new Date().toISOString(), durationMs: 5 };
const envelope = toActionResult(result, meta);
expect(envelope.ok).toBe(true);
expect(envelope.data).toEqual({ sessions: [] });

// toActionResult: error
const result2 = err(ValidationError.create("bad input", { field: "groupId" }));
const envelope2 = toActionResult(result2, meta);
expect(envelope2.ok).toBe(false);
expect(envelope2.error._tag).toBe("ValidationError");
expect(envelope2.error.category).toBe("validation");

// ActionResult schema validation
const parsed = ActionErrorResultSchema.safeParse(envelope2);
expect(parsed.success).toBe(true);
```

### Test Utilities

```typescript
/** Create a minimal ActionSpec for testing. */
function createTestActionSpec(
  id: string,
  surfaces?: { cli?: CliSurface; mcp?: McpSurface },
): ActionSpec<unknown, unknown, BrokerError>;

/** Create test HandlerContext with defaults. */
function createTestHandlerContext(
  overrides?: Partial<HandlerContext>,
): HandlerContext;
```

## File Layout

```
packages/contracts/src/
  action-spec.ts              # ActionSpec, CliSurface, McpSurface, CliOption interfaces
  action-registry.ts          # ActionRegistry interface + createActionRegistry()
  handler-types.ts            # (existing) HandlerContext extended with new fields,
                              # Handler type unchanged
  result-envelope.ts          # toActionResult() conversion function,
                              # ActionResult type alias
  __tests__/
    action-registry.test.ts   # Registry registration, lookup, surface filtering
    result-envelope.test.ts   # toActionResult success/error cases

packages/schemas/src/
  result/
    action-result.ts          # ActionResultMetaSchema, ActionErrorSchema,
                              # PaginationSchema, ActionResultSchema factory,
                              # ActionErrorResultSchema
    index.ts                  # Re-exports
  index.ts                    # (existing) add re-export for result/
```

Each source file targets under 150 LOC. The `action-spec.ts` file is pure interface declarations. The `action-registry.ts` file contains the interface and a ~30-line implementation. The `result-envelope.ts` file contains the type alias and conversion function. The Zod schemas in `action-result.ts` are the densest file at ~80 LOC.
