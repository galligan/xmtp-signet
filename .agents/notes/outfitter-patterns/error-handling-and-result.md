# Error Handling and Result Pattern

Extracted from `outfitter/stack` as reference for xmtp-broker error handling.

## Core Principle: No Throw

Handlers never throw. All error paths return `Result.err(error)`. This is enforced by:
- An oxlint rule (`no-throw-in-handler`) that flags `throw` in handler code
- Convention: only test assertions and explicit `expect()` utilities may throw

## Result Type

Uses the `better-result` library:

```typescript
Result<T, E>             // Success value T or error E
Result.ok(value)         // Construct Ok
Result.err(error)        // Construct Err
result.isOk()            // Type guard
result.isErr()           // Type guard
result.value             // Access T when Ok
result.error             // Access E when Err
```

Extended with custom combinators:
- `unwrapOrElse(result, fn)` — lazy default on error
- `orElse(result1, result2)` — alternative result on error
- `combine2(r1, r2)` — combine multiple results into tuple
- `expect(result, message)` — unwrap or throw with context (for boundaries only)

## Error Taxonomy

10 categories, each with dedicated error class, numeric code range, and cross-transport mappings:

| Category | Class(es) | Exit | HTTP | JSON-RPC | Retryable |
|----------|-----------|------|------|----------|-----------|
| validation | ValidationError | 1 | 400 | -32602 | no |
| not_found | NotFoundError | 2 | 404 | -32007 | no |
| conflict | AlreadyExistsError, ConflictError | 3 | 409 | -32002 | no |
| permission | PermissionError | 4 | 403 | -32003 | no |
| timeout | TimeoutError | 5 | 504 | -32001 | yes |
| rate_limit | RateLimitError | 6 | 429 | -32004 | yes |
| network | NetworkError | 7 | 502 | -32005 | yes |
| internal | InternalError, AssertionError | 8 | 500 | -32603 | no |
| auth | AuthError | 9 | 401 | -32000 | no |
| cancelled | CancelledError | 130 | 499 | -32006 | no |

Numeric error code ranges (1000-10999) provide fine-grained identification within categories.

## Error Class Shape

All errors inherit from a `TaggedError` base:

```typescript
interface OutfitterError extends Error {
  _tag: string;                          // class name for discrimination
  code: number;                          // specific numeric code
  category: ErrorCategory;               // taxonomy bucket
  context?: Record<string, unknown>;     // structured data
}
```

Each class has static factory methods:
- `ValidationError.create(field, reason, context?)`
- `NotFoundError.create(resourceType, resourceId, context?)`
- `TimeoutError.create(operation, timeoutMs)`
- etc.

## Cross-Transport Error Flow

```
Handler returns Result.err(error)
    │
    ├── CLI: error.exitCode() → process.exit(N), stderr output
    ├── MCP: error serialized → { isError: true, content: [...] }
    ├── HTTP: error.statusCode() → HTTP status, JSON body
    └── WebSocket: error serialized → structured error frame
```

Unified lookup: `errorCategoryMeta(category)` returns `{ exitCode, statusCode, jsonRpcCode, retryable }`.

## Retryability

Only transient errors are retryable: `timeout`, `rate_limit`, `network`. Permanent errors (validation, not_found, permission, auth, internal) require human intervention.

## Adaptation Notes for xmtp-broker

**Adopt:**
- Result type for all handler returns (use `better-result` or similar)
- Error taxonomy with categories mapping to transport-specific codes
- Static factory methods on error classes for consistent construction
- `_tag` discriminant for type-safe error matching
- Retryability classification (important for session reconnection logic)
- Structured `context` field on errors for debugging

**Adapt for broker domain:**
- Add broker-specific error categories or classes:
  - `SessionExpiredError` (maps to auth)
  - `GrantDeniedError` (maps to permission)
  - `AttestationError` (maps to validation or conflict)
  - `ViewFilterError` (maps to internal)
  - `RevocationError` (maps to permission)
- WebSocket transport needs error frame format (not HTTP status codes)
- Consider whether the full 10-category taxonomy is needed initially — start with what the broker actually produces

**Start with:**
- validation, not_found, permission, auth, internal, timeout, cancelled
- Add conflict, rate_limit, network as transports mature
