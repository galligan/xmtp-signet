# 15-handler-sdk

**Package:** `@xmtp-broker/handler`
**Spec version:** 0.1.0

## Overview

The handler SDK is a thin TypeScript client library that harness developers install to connect their agents to the broker. It wraps the WebSocket transport (spec 08) with a developer-friendly API: typed events, Result-based request methods, automatic reconnection, and connection lifecycle management.

This is a client-side library, not a harness. It abstracts the wire protocol completely -- harness developers never see `AuthFrame`, `SequencedFrame`, or WebSocket close codes. They call `sendMessage()`, iterate over `events`, and check `state`. Framework-specific adapters (Claude Agent SDK, OpenAI Agents, etc.) come later and wrap this package.

The handler SDK runs in the harness process, not in the broker. It depends only on type packages (`@xmtp-broker/schemas`, `@xmtp-broker/contracts`) and `better-result`. It has no XMTP SDK dependency, no policy logic, and no framework opinions. The entire real logic is ~300 LOC -- the rest is types and tests.

## Dependencies

**Imports:**
- `@xmtp-broker/schemas` -- `BrokerEvent`, `BrokerError`, `ValidationError`, `AuthError`, `SessionExpiredError`, `ViewConfig`, `GrantConfig`, `SessionToken`, `ContentTypeId`, error classes
- `@xmtp-broker/contracts` -- type-only imports for `HarnessRequest`, `RequestResponse`, `SessionRecord` (wire format types used internally)
- `better-result` -- `Result`, `ok`, `err`
- `zod` -- frame validation at the wire boundary (incoming broker frames)

**Does NOT import:**
- `@xmtp-broker/core`, `@xmtp-broker/policy`, `@xmtp-broker/sessions`, `@xmtp-broker/keys` -- no runtime broker packages
- `@xmtp/node-sdk` -- talks to the broker, not to XMTP directly
- `Bun.serve()` -- this is a client, not a server

**Imported by:** Framework-specific harness adapters (future), custom harness implementations

## Public Interfaces

### Handler Configuration

```typescript
const BrokerHandlerConfigSchema = z.object({
  url: z.string().url()
    .describe("Broker WebSocket URL (e.g., ws://localhost:8393/v1/agent)"),
  token: z.string().min(1)
    .describe("Session bearer token obtained from broker admin"),
  reconnect: z.object({
    enabled: z.boolean().default(true)
      .describe("Enable automatic reconnection"),
    maxAttempts: z.number().int().nonnegative().default(10)
      .describe("Maximum reconnection attempts (0 = unlimited)"),
    baseDelayMs: z.number().int().positive().default(1_000)
      .describe("Base delay for exponential backoff"),
    maxDelayMs: z.number().int().positive().default(30_000)
      .describe("Maximum delay between reconnection attempts"),
    jitter: z.boolean().default(true)
      .describe("Add random jitter to backoff delays"),
  }).default({})
    .describe("Reconnection settings"),
  requestTimeoutMs: z.number().int().positive().default(30_000)
    .describe("Timeout for individual request/response round-trips"),
}).describe("Broker handler configuration");

type BrokerHandlerConfig = z.infer<typeof BrokerHandlerConfigSchema>;
```

### BrokerHandler

```typescript
interface BrokerHandler {
  /** Open the WebSocket connection and authenticate. */
  connect(): Promise<Result<void, BrokerError>>;

  /** Close the connection gracefully. Completes in-flight requests. */
  disconnect(): Promise<Result<void, BrokerError>>;

  /** Typed async iterable of broker events, filtered by the session's view. */
  readonly events: AsyncIterable<BrokerEvent>;

  /** Send a text message to a conversation. */
  sendMessage(
    groupId: string,
    content: MessageContent,
  ): Promise<Result<MessageSent, BrokerError>>;

  /** Send a reaction to a message. */
  sendReaction(
    groupId: string,
    messageId: string,
    reaction: string,
  ): Promise<Result<ReactionSent, BrokerError>>;

  /** List conversations visible to this session. */
  listConversations(): Promise<Result<Conversation[], BrokerError>>;

  /** Get detailed info about a conversation. */
  getConversationInfo(
    groupId: string,
  ): Promise<Result<ConversationInfo, BrokerError>>;

  /** Current session info (view, grant, expiry). */
  readonly session: SessionInfo | null;

  /** Current connection state. */
  readonly state: HandlerState;

  /** Register a listener for connection state changes. Returns unsubscribe function. */
  onStateChange(callback: StateChangeCallback): () => void;

  /** Register a listener for errors (connection failures, protocol errors). Returns unsubscribe. */
  onError(callback: ErrorCallback): () => void;
}

function createBrokerHandler(
  config: BrokerHandlerConfig,
): BrokerHandler;
```

### Connection State

```typescript
type HandlerState =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "connected"
  | "reconnecting"
  | "closed";

type StateChangeCallback = (
  newState: HandlerState,
  previousState: HandlerState,
) => void;

type ErrorCallback = (error: BrokerError) => void;
```

### Session Info

```typescript
/** Read-only view of the current session, derived from the AuthenticatedFrame. */
interface SessionInfo {
  readonly connectionId: string;
  readonly sessionId: string;
  readonly agentInboxId: string;
  readonly view: ViewConfig;
  readonly grant: GrantConfig;
  readonly expiresAt: string;
}
```

### Request/Response Types

```typescript
/** Content for sendMessage. */
type MessageContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "custom"; readonly contentType: ContentTypeId; readonly content: unknown };

/** Successful message send result. */
interface MessageSent {
  readonly messageId: string;
  readonly groupId: string;
  readonly sentAt: string;
}

/** Successful reaction send result. */
interface ReactionSent {
  readonly messageId: string;
  readonly groupId: string;
  readonly sentAt: string;
}

/** Conversation summary for list results. */
interface Conversation {
  readonly groupId: string;
  readonly name: string | null;
  readonly memberCount: number;
  readonly lastMessageAt: string | null;
}

/** Detailed conversation info. */
interface ConversationInfo {
  readonly groupId: string;
  readonly name: string | null;
  readonly members: readonly string[];
  readonly createdAt: string;
  readonly lastMessageAt: string | null;
}
```

## Zod Schemas

This package adds only `BrokerHandlerConfigSchema` (defined above) and internal frame validation schemas. All event and request types are imported from `@xmtp-broker/schemas`.

### Internal Frame Schemas (not exported)

```typescript
/** Validate incoming broker frames. */
const IncomingFrame = z.discriminatedUnion("type", [
  AuthenticatedFrame,
  AuthErrorFrame,
  BackpressureFrame,
  z.object({
    type: z.literal("sequenced"),
    seq: z.number().int().positive(),
    event: BrokerEvent,
  }),
]);
```

These schemas validate broker-to-handler frames at the wire boundary. They are internal -- harness developers never interact with them.

## Behaviors

### Connection Lifecycle State Machine

```
  createBrokerHandler()
         |
         v
  ┌──────────────┐
  │ disconnected  │ <─────────────────────────────────────────┐
  └──────┬───────┘                                            │
         | connect()                                          │
         v                                                    │
  ┌──────────────┐   WebSocket open fails                     │
  │ connecting   │ ──────────────────────────────────────> reconnect?
  └──────┬───────┘                                            │
         | WebSocket open                                     │
         v                                                    │
  ┌──────────────┐   auth rejected (4001)                     │
  │authenticating│ ──────────────────────────> ┌────────┐     │
  └──────┬───────┘                             │ closed │     │
         | AuthenticatedFrame received         └────────┘     │
         v                                                    │
  ┌──────────────┐   transport error / heartbeat timeout      │
  │  connected   │ ──────────────────────────────────────> reconnect?
  └──────┬───────┘                                            │
         | disconnect() called                                │
         v                                                    │
  ┌──────────────┐                                            │
  │   closed     │                                            │
  └──────────────┘                                            │
                                                              │
  reconnect? ─── enabled ──> ┌──────────────┐  success ──> connected
                             │ reconnecting │
                no ──────>   └──────┬───────┘
                disconnected       | max attempts exceeded
                                   v
                             ┌──────────────┐
                             │ disconnected │
                             └──────────────┘
```

**disconnected**: Initial state. No WebSocket connection. `connect()` transitions to `connecting`.

**connecting**: Opening the WebSocket to the broker URL. On success, transitions to `authenticating`. On failure, transitions to `reconnecting` (if enabled) or `disconnected`.

**authenticating**: WebSocket is open. The handler sends an `AuthFrame` with the session token and `lastSeenSeq`. Waits for `AuthenticatedFrame` or `AuthErrorFrame`. On auth success, transitions to `connected`. On auth rejection (close code 4001), transitions to `closed` -- auth failures are not retryable.

**connected**: Fully operational. Events flow on the `events` iterable. Request methods (`sendMessage`, etc.) are available. Transitions to `reconnecting` on transport error or missed heartbeats, or to `closed` on explicit `disconnect()`.

**reconnecting**: Transport lost but reconnection is enabled. Applies exponential backoff with optional jitter. Each attempt goes through `connecting` -> `authenticating` -> `connected`. On success, resumes with `lastSeenSeq` for replay. On max attempts exceeded, transitions to `disconnected` and emits an error.

**closed**: Terminal state after explicit `disconnect()` or non-retryable auth failure. The handler cannot be reused. Create a new one.

### connect() Flow

```
  connect()
      |
      v
  Validate config (Zod parse)
      |
      v
  Set state = "connecting"
      |
      v
  Open WebSocket to config.url
      |
      v
  Set state = "authenticating"
      |
      v
  Send AuthFrame { type: "auth", token, lastSeenSeq }
      |
      v
  Wait for response (AuthenticatedFrame or AuthErrorFrame)
      |
      ├── AuthenticatedFrame:
      |     Cache session info
      |     Set state = "connected"
      |     Start heartbeat monitoring
      |     Begin routing SequencedFrames to event stream
      |     Return ok(undefined)
      |
      └── AuthErrorFrame or close code 4001:
            Set state = "closed"
            Return err(AuthError)
```

### Event Stream

The `events` property is an `AsyncIterable<BrokerEvent>`. Internally, it is backed by an async queue that receives events from the WebSocket message handler.

```typescript
// Harness usage:
const handler = createBrokerHandler({ url, token });
await handler.connect();

for await (const event of handler.events) {
  switch (event.type) {
    case "message":
      console.log(`${event.senderInboxId}: ${event.content.text}`);
      break;
    case "session.expired":
      console.log("Session expired, shutting down");
      break;
  }
}
// Loop exits when handler disconnects or is closed
```

**Event ordering**: Events arrive in the order the broker sends them (sequence number order). The handler does not reorder.

**Reconnection**: During reconnection, the event stream pauses (the async iterator blocks). When reconnected, replayed events flow through normally. The harness sees a continuous stream with no gap indication beyond the implicit pause.

**Termination**: The async iterable completes (returns `done: true`) when the handler transitions to `closed` or `disconnected` with no reconnection pending. A `session.expired` event is the last event before the stream ends on session expiry.

### Request/Response Correlation

Each request method:

1. Generates a unique `requestId` (crypto.randomUUID()).
2. Serializes the `HarnessRequest` and sends it on the WebSocket.
3. Creates a pending promise keyed by `requestId` with a timeout timer.
4. When a `RequestResponse` frame arrives with the matching `requestId`, resolves or rejects the promise.
5. On timeout (`requestTimeoutMs`), rejects with a `TimeoutError`.

```typescript
// Internal request tracking
interface PendingRequest {
  readonly requestId: string;
  readonly resolve: (result: Result<unknown, BrokerError>) => void;
  readonly timer: Timer;
}
```

Multiple requests can be in flight simultaneously. Responses are correlated by `requestId`, not by arrival order.

### Automatic Reconnection

When reconnection is enabled and the connection drops (transport error, heartbeat timeout, close codes 1001/1006/4003/4005):

1. Set state to `reconnecting`.
2. Compute delay: `min(baseDelayMs * 2^attempt, maxDelayMs)`, optionally jittered.
3. Wait for the delay.
4. Attempt to reconnect with `lastSeenSeq` from the last received `SequencedFrame`.
5. On success: broker replays missed events via `resumedFromSeq`. Resume event stream.
6. On failure: increment attempt counter. If `maxAttempts > 0` and attempts exceed it, give up and transition to `disconnected`.

**Non-retryable close codes**: 4001 (auth failed), 4002 (auth timeout), 4004 (session revoked). These transition directly to `closed` -- the session is invalid and reconnecting would fail again.

**Retryable close codes**: 1001 (going away / server shutdown), 1006 (abnormal closure), 4003 (session expired -- token may be refreshed externally), 4005 (policy change), 4008 (backpressure).

### Heartbeat Monitoring

The handler monitors broker heartbeats:

1. On each `HeartbeatEvent` received, reset a local timer to `heartbeatIntervalMs * missedHeartbeatsBeforeDead` (values from the `AuthenticatedFrame` or sensible defaults: 30s interval, 3 missed = 90s).
2. If the timer fires without a heartbeat, consider the connection dead. Trigger reconnection (if enabled) or transition to `disconnected`.

The handler also responds to broker heartbeat requests by sending `HeartbeatRequest` frames to keep the session alive.

### Backpressure Awareness

When the handler receives a `BackpressureFrame`:

1. Emit a `backpressure` error via `onError` so the harness can observe it.
2. The handler does NOT automatically slow down -- that is the harness's responsibility. The handler surfaces the signal; the harness decides what to do (e.g., rate-limit outbound messages, queue locally).

If the broker disconnects with code 4008 (backpressure exceeded), the handler treats it as retryable and attempts reconnection after a longer delay.

### Sequence Tracking

The handler tracks `lastSeenSeq` -- the highest sequence number received from the broker:

1. Every `SequencedFrame` updates `lastSeenSeq` after the event is delivered to the event stream.
2. On reconnect, `lastSeenSeq` is sent in the `AuthFrame` so the broker can replay missed events.
3. If the handler has never connected (fresh start), `lastSeenSeq` is `null`.

### Exponential Backoff

```
  delay = min(baseDelayMs * 2^attempt, maxDelayMs)

  With jitter (full jitter strategy):
  delay = random(0, delay)

  attempt 0:   1s (base)
  attempt 1:   2s
  attempt 2:   4s
  attempt 3:   8s
  attempt 4:  16s
  attempt 5+: 30s (capped at maxDelayMs)
```

## Error Cases

| Scenario | Error | Handler Behavior |
|----------|-------|-----------------|
| Invalid config | `ValidationError` | `createBrokerHandler` returns immediately; methods throw |
| WebSocket open fails | `InternalError` | Reconnect (if enabled) or return `err()` from `connect()` |
| Auth rejected (4001) | `AuthError` | Transition to `closed`. Not retryable |
| Auth timeout (4002) | `AuthError` | Transition to `closed`. Not retryable |
| Session expired (4003) | `SessionExpiredError` | Emit `session.expired` event, transition per reconnect config |
| Session revoked (4004) | `AuthError` | Transition to `closed`. Not retryable |
| Policy change (4005) | `PermissionError` | Emit error, reconnect (if enabled) |
| Backpressure disconnect (4008) | `InternalError` | Reconnect with extended delay |
| Protocol error (4009) | `ValidationError` | Transition to `closed`. Not retryable |
| Request timeout | `TimeoutError` | Reject pending promise with `TimeoutError` |
| Request denied by grant | `PermissionError` | Return `err(PermissionError)` from method |
| Request for group outside view | `PermissionError` | Return `err(PermissionError)` from method |
| Malformed broker frame | `ValidationError` | Log via `onError`, skip frame, continue |
| Max reconnection attempts | `InternalError` | Emit error, transition to `disconnected` |
| `sendMessage` while disconnected | `ValidationError` | Return `err()` immediately |

## Open Questions Resolved

**Q: Should the handler expose raw WebSocket frames or only typed events?**
**A:** Only typed events. The handler abstracts the wire protocol completely. Harness developers never see `AuthFrame`, `SequencedFrame`, `BackpressureFrame`, etc. They see `BrokerEvent` instances on the event stream and `Result` values from request methods. Wire-level concerns (framing, sequencing, auth handshake) are internal implementation details.

**Q: Should reconnection be automatic or manual?**
**A:** Automatic by default with exponential backoff. Configurable via `config.reconnect.enabled = false` for testing or harnesses that want manual control. The automatic strategy handles the common case (transient network failures, broker restarts) without harness code. Manual reconnection is just `disconnect()` + `connect()` on a new handler.

**Q: How should the handler surface session expiry?**
**A:** Three signals: (1) a `session.expired` event on the event stream (the broker sends this before closing), (2) transition to `disconnected` or `closed` state (observable via `onStateChange`), and (3) an error via `onError`. The harness can listen on whichever channel is most natural for its architecture.

**Q: Should request methods throw or return Results?**
**A:** Return `Result<T, BrokerError>`. Consistent with the broker's internal handler contract and the project's "Result types, not exceptions" principle. Harness developers pattern-match on `result.ok` / `result.error` rather than try/catch.

**Q: Should the handler validate outbound requests?**
**A:** No. The handler sends requests to the broker and the broker validates them against the session's grant and view. Client-side validation would duplicate logic and drift from the broker's truth. The handler does minimal structural validation (e.g., non-empty groupId) but defers policy decisions to the broker.

## Deferred

- **Framework-specific adapters.** Claude Agent SDK, OpenAI Agents, LangChain, etc. These wrap `BrokerHandler` with framework conventions. Each is a separate package.
- **Token refresh.** Automatic session token renewal before expiry. v0 requires the harness to obtain a new token and create a new handler.
- **Multiplexed connections.** One handler per session. Multi-session scenarios use multiple handler instances.
- **Binary frame support.** All frames are JSON. Binary framing (MessagePack, protobuf) deferred to match the broker's Phase 2 timeline.
- **Connection pooling.** Single WebSocket per handler. Pooling is a framework adapter concern.
- **Offline queue.** Queuing requests while disconnected for replay on reconnect. v0 rejects requests immediately when not connected.
- **Typed content helpers.** Content-type-specific builders (e.g., `sendReply()`, `sendReadReceipt()`). v0 supports text and custom content types. Helpers come with framework adapters.
- **Event filtering on the client.** Server-side view filtering is the source of truth. Client-side filtering adds no value in v0.

## Testing Strategy

### What to Test

1. **Connection lifecycle** -- State transitions through `disconnected` -> `connecting` -> `authenticating` -> `connected` -> `closed`. Each transition fires `onStateChange`.
2. **Auth handshake** -- Sends `AuthFrame` on WebSocket open. Parses `AuthenticatedFrame` to populate `session`. Handles `AuthErrorFrame` by transitioning to `closed`.
3. **Event stream** -- `SequencedFrame` events are unwrapped and delivered to the `events` async iterable in order. Stream completes on disconnect.
4. **Request/response** -- `sendMessage` sends a `HarnessRequest` with a `requestId` and resolves when the matching `RequestResponse` arrives. Multiple concurrent requests resolve independently.
5. **Request timeout** -- Pending request rejects with `TimeoutError` after `requestTimeoutMs`.
6. **Automatic reconnection** -- Transport drop triggers reconnection with exponential backoff. Sends `lastSeenSeq` on reconnect. Replayed events appear on the event stream.
7. **Non-retryable close codes** -- Close code 4001/4004 transitions directly to `closed` without reconnection attempts.
8. **Backpressure** -- `BackpressureFrame` emits an error via `onError`. Does not terminate the connection.
9. **Heartbeat monitoring** -- Missing heartbeats trigger reconnection. Received heartbeats reset the dead timer.
10. **Session info** -- `session` property returns view, grant, and expiry from the `AuthenticatedFrame`. Returns `null` before authentication.
11. **Disconnected rejection** -- Request methods return `err()` when state is not `connected`.

### How to Test

**Unit tests**: Use a mock WebSocket server (Bun's `Bun.serve()` with WebSocket support on a random port). The mock server simulates the broker's wire protocol -- accepting auth, sending events, responding to requests. This validates the handler's protocol logic without a real broker.

**State machine tests**: Verify every valid state transition and that invalid transitions (e.g., `sendMessage` in `connecting` state) produce the correct error.

### Key Test Scenarios

```typescript
// --- Connection lifecycle ---

const { handler, server } = createTestHandler();
expect(handler.state).toBe("disconnected");

const result = await handler.connect();
expect(result.ok).toBe(true);
expect(handler.state).toBe("connected");
expect(handler.session).not.toBeNull();
expect(handler.session!.view).toBeDefined();

await handler.disconnect();
expect(handler.state).toBe("closed");

// --- State change callbacks ---

const states: HandlerState[] = [];
handler.onStateChange((s) => states.push(s));
await handler.connect();
expect(states).toEqual(["connecting", "authenticating", "connected"]);

// --- Auth failure ---

const { handler: badHandler, server: badServer } = createTestHandler({
  serverBehavior: "reject-auth",
});
const result2 = await badHandler.connect();
expect(result2.ok).toBe(false);
expect(result2.error).toBeInstanceOf(AuthError);
expect(badHandler.state).toBe("closed");

// --- Event stream ---

const { handler, server, emitEvent } = createTestHandler();
await handler.connect();

emitEvent({ type: "message", groupId: "g1", content: { text: "hello" } });
emitEvent({ type: "message", groupId: "g1", content: { text: "world" } });

const events: BrokerEvent[] = [];
for await (const event of take(handler.events, 2)) {
  events.push(event);
}
expect(events).toHaveLength(2);
expect(events[0].type).toBe("message");

// --- Request/response ---

const { handler, server } = createTestHandler();
await handler.connect();

const result = await handler.sendMessage("g1", { type: "text", text: "hello" });
expect(result.ok).toBe(true);
expect(result.value.messageId).toBeDefined();
expect(result.value.groupId).toBe("g1");

// --- Concurrent requests ---

const [r1, r2] = await Promise.all([
  handler.sendMessage("g1", { type: "text", text: "one" }),
  handler.sendMessage("g2", { type: "text", text: "two" }),
]);
expect(r1.ok).toBe(true);
expect(r2.ok).toBe(true);
expect(r1.value.groupId).toBe("g1");
expect(r2.value.groupId).toBe("g2");

// --- Request timeout ---

const { handler } = createTestHandler({
  config: { requestTimeoutMs: 100 },
  serverBehavior: "no-response",
});
await handler.connect();

const result = await handler.sendMessage("g1", { type: "text", text: "lost" });
expect(result.ok).toBe(false);
expect(result.error.category).toBe("timeout");

// --- Reconnection ---

const { handler, server, dropConnection } = createTestHandler({
  config: { reconnect: { enabled: true, baseDelayMs: 50, maxDelayMs: 200 } },
});
await handler.connect();

const stateChanges: HandlerState[] = [];
handler.onStateChange((s) => stateChanges.push(s));

dropConnection();
await waitForState(handler, "connected"); // auto-reconnects

expect(stateChanges).toContain("reconnecting");
expect(stateChanges).toContain("connected");

// --- Non-retryable close code ---

const { handler, server, closeWith } = createTestHandler({
  config: { reconnect: { enabled: true } },
});
await handler.connect();

closeWith(4004, "session revoked");
await waitForState(handler, "closed");
expect(handler.state).toBe("closed"); // no reconnection

// --- Reconnection with replay ---

const { handler, server, emitEvent, dropConnection } = createTestHandler();
await handler.connect();

emitEvent({ type: "message", groupId: "g1", content: { text: "before" } });
const events: BrokerEvent[] = [];
for await (const event of take(handler.events, 1)) {
  events.push(event);
}

dropConnection();
// Server will replay "before" (seq 1) since handler sends lastSeenSeq: 1
// and add new event at seq 2
emitEvent({ type: "message", groupId: "g1", content: { text: "after" } });
await waitForState(handler, "connected");

for await (const event of take(handler.events, 1)) {
  events.push(event);
}
expect(events[1].content.text).toBe("after");

// --- Disconnected rejection ---

const handler = createBrokerHandler({ url, token });
const result = await handler.sendMessage("g1", { type: "text", text: "nope" });
expect(result.ok).toBe(false);
expect(result.error.category).toBe("validation");

// --- Backpressure ---

const { handler, server, sendBackpressure } = createTestHandler();
await handler.connect();

const errors: BrokerError[] = [];
handler.onError((e) => errors.push(e));

sendBackpressure({ buffered: 200, limit: 256 });
expect(errors).toHaveLength(1);
expect(handler.state).toBe("connected"); // still connected
```

### Test Utilities

```typescript
/** Create a BrokerHandler with a mock broker server on a random port. */
function createTestHandler(
  options?: {
    config?: Partial<BrokerHandlerConfig>;
    serverBehavior?: "normal" | "reject-auth" | "no-response" | "slow-auth";
  },
): {
  handler: BrokerHandler;
  server: MockBrokerServer;
  emitEvent: (event: BrokerEvent) => void;
  dropConnection: () => void;
  closeWith: (code: number, reason: string) => void;
  sendBackpressure: (frame: { buffered: number; limit: number }) => void;
  cleanup: () => Promise<void>;
};

/** Wait for a handler to reach a specific state. */
function waitForState(
  handler: BrokerHandler,
  state: HandlerState,
  timeoutMs?: number,
): Promise<void>;

/** Take N items from an async iterable. */
async function* take<T>(
  iterable: AsyncIterable<T>,
  count: number,
): AsyncIterable<T>;

/** Mock broker server that implements the WS protocol from spec 08. */
interface MockBrokerServer {
  readonly port: number;
  readonly connections: number;
  stop(): Promise<void>;
}
```

## File Layout

```
packages/handler/
  package.json
  tsconfig.json
  src/
    index.ts                    # Re-exports: createBrokerHandler, types
    config.ts                   # BrokerHandlerConfigSchema
    handler.ts                  # createBrokerHandler(), BrokerHandler implementation
    connection.ts               # WebSocket lifecycle, auth handshake, frame routing
    event-stream.ts             # AsyncIterable<BrokerEvent> backed by async queue
    request-tracker.ts          # PendingRequest map, requestId correlation, timeout
    reconnection.ts             # Exponential backoff, attempt tracking, retry logic
    heartbeat-monitor.ts        # Broker heartbeat tracking, dead connection detection
    types.ts                    # HandlerState, SessionInfo, MessageContent,
                                # MessageSent, ReactionSent, Conversation, ConversationInfo
    __tests__/
      handler.test.ts           # Connection lifecycle, state transitions
      event-stream.test.ts      # Async iterable behavior, ordering, termination
      request-tracker.test.ts   # Correlation, concurrent requests, timeout
      reconnection.test.ts      # Backoff math, attempt tracking, non-retryable codes
      heartbeat-monitor.test.ts # Timer reset, dead detection
      integration.test.ts       # Full connect -> events -> request -> disconnect
      mock-server.ts            # MockBrokerServer implementing spec 08 wire protocol
```

Each source file targets under 150 LOC. The `handler.ts` orchestrates but delegates to `connection.ts`, `event-stream.ts`, `request-tracker.ts`, `reconnection.ts`, and `heartbeat-monitor.ts` for distinct concerns.

### Package Configuration

```jsonc
{
  "name": "@xmtp-broker/handler",
  "version": "0.0.0",
  "private": true,
  "type": "module",
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
    "test": "bun test"
  },
  "dependencies": {
    "@xmtp-broker/contracts": "workspace:*",
    "@xmtp-broker/schemas": "workspace:*",
    "better-result": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "typescript": "catalog:"
  }
}
```
