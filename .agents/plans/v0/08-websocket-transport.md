# 08-websocket-transport

**Package:** `@xmtp-broker/ws`
**Spec version:** 0.1.0

## Overview

The WebSocket transport is the Phase 1 harness-facing interface for xmtp-broker. It translates the transport-agnostic handler contract into a persistent, bidirectional connection between agent harnesses and the broker. A harness connects, authenticates with a session token, and then receives a filtered event stream and sends scoped requests over a single WebSocket connection.

The transport is a thin adapter. It owns connection lifecycle, wire protocol framing, auth handshake, sequence numbering, backpressure, and reconnection support. It does not own policy decisions, session state, or XMTP client operations -- those are delegated to the runtime tier packages (`@xmtp-broker/sessions`, `@xmtp-broker/policy`, `@xmtp-broker/core`) via their handler interfaces.

Built on `Bun.serve()` native WebSocket support, the transport uses per-connection state via `ws.data` typing, a connection registry for event broadcasting, and structured JSON frames with a `type` discriminator. No binary frames in v0. No HTTP-level auth -- authentication happens in-band as the first frame after upgrade.

## Dependencies

**Imports:**
- `@xmtp-broker/contracts` -- `BrokerCore`, `CoreContext`, `SessionManager`, `SessionRecord`, `AttestationManager`, `RawEvent`, `RevealStateStore` (canonical interface definitions; this package consumes these interfaces, does not implement them)
- `@xmtp-broker/schemas` -- `BrokerEvent`, `HarnessRequest`, `RequestResponse`, `SessionToken`, `ViewConfig`, `GrantConfig`, error classes (`AuthError`, `SessionExpiredError`, `ValidationError`)
- `@xmtp-broker/sessions` -- `SessionManager` implementation
- `@xmtp-broker/policy` -- `projectMessage`, grant validation functions, `RevealStateStore` implementation
- `@xmtp-broker/core` -- `BrokerCore` implementation
- `@xmtp-broker/attestations` -- `AttestationManager` implementation
- `better-result` -- `Result`, `ok`, `err`
- `zod` -- frame validation at the wire boundary

**Imported by:** Nothing -- this is the top of the dependency graph.

## Public Interfaces

### Server Configuration

```typescript
const WsServerConfigSchema = z.object({
  port: z.number().int().positive().default(8393)
    .describe("Port to listen on"),
  host: z.string().default("127.0.0.1")
    .describe("Host to bind to"),
  heartbeatIntervalMs: z.number().int().positive().default(30_000)
    .describe("Interval between heartbeat frames in milliseconds"),
  missedHeartbeatsBeforeDead: z.number().int().positive().default(3)
    .describe("Consecutive missed heartbeats before connection is considered dead"),
  authTimeoutMs: z.number().int().positive().default(5_000)
    .describe("Time allowed for auth handshake after connect"),
  replayBufferSize: z.number().int().positive().default(1_000)
    .describe("Max events buffered per connection for reconnection replay"),
  sendBufferSoftLimit: z.number().int().positive().default(64)
    .describe("Send buffer depth that triggers backpressure warning"),
  sendBufferHardLimit: z.number().int().positive().default(256)
    .describe("Send buffer depth that triggers forced disconnect"),
  drainTimeoutMs: z.number().int().positive().default(5_000)
    .describe("Time to wait for in-flight responses during graceful shutdown"),
  maxFrameSizeBytes: z.number().int().positive().default(1_048_576)
    .describe("Maximum accepted frame size (1 MiB default)"),
}).describe("WebSocket server configuration");

type WsServerConfig = z.infer<typeof WsServerConfigSchema>;
```

### Connection State

```typescript
/** Per-connection state stored in ws.data. */
interface ConnectionState {
  readonly connectionId: string;
  phase: ConnectionPhase;
  sessionRecord: SessionRecord | null;
  lastSeenSeq: number;
  nextSeq: number;
  sendBufferDepth: number;
  backpressureNotified: boolean;
  authTimer: Timer | null;
  heartbeatTimer: Timer | null;
  replayBuffer: CircularBuffer<SequencedFrame>;
  inFlightRequests: Map<string, { timer: Timer; sentAt: number }>;
}

type ConnectionPhase =
  | "authenticating"
  | "active"
  | "draining"
  | "closed";
```

### Wire Frame Schemas

```typescript
/** Auth frame sent by harness as first message. */
const AuthFrame = z.object({
  type: z.literal("auth"),
  token: z.string().describe("Session bearer token"),
  lastSeenSeq: z.number().int().nonnegative().nullable()
    .describe("Last sequence number seen, null for fresh connection"),
}).describe("Authentication frame from harness");

type AuthFrame = z.infer<typeof AuthFrame>;

/** Authenticated confirmation from broker. */
const AuthenticatedFrame = z.object({
  type: z.literal("authenticated"),
  connectionId: z.string().describe("Broker-assigned connection identifier"),
  session: SessionToken.describe("Session info"),
  view: ViewConfig.describe("Active view configuration"),
  grant: GrantConfig.describe("Active grant configuration"),
  resumedFromSeq: z.number().int().nonnegative().nullable()
    .describe("Sequence number resume started from, null if fresh"),
}).describe("Authentication success response from broker");

type AuthenticatedFrame = z.infer<typeof AuthenticatedFrame>;

/** Auth error from broker, sent before close. */
const AuthErrorFrame = z.object({
  type: z.literal("auth_error"),
  code: z.number().int().describe("Error code"),
  message: z.string().describe("Human-readable error description"),
}).describe("Authentication failure response from broker");

type AuthErrorFrame = z.infer<typeof AuthErrorFrame>;

/** Backpressure warning from broker. */
const BackpressureFrame = z.object({
  type: z.literal("backpressure"),
  buffered: z.number().int().describe("Current buffer depth"),
  limit: z.number().int().describe("Hard limit before disconnect"),
}).describe("Backpressure warning from broker");

type BackpressureFrame = z.infer<typeof BackpressureFrame>;
```

### Sequenced Event Envelope

Every broker-to-harness event is wrapped in a sequenced envelope:

```typescript
const SequencedFrame = z.object({
  seq: z.number().int().positive()
    .describe("Monotonically increasing sequence number, scoped to connection"),
  event: BrokerEvent.describe("The event payload"),
}).describe("Sequenced event envelope for replay support");

type SequencedFrame = z.infer<typeof SequencedFrame>;
```

### Harness Request Envelope

Harness-to-broker messages carry the `HarnessRequest` shape defined in 02-schemas. The `requestId` field on each request type provides correlation. No additional envelope is needed.

### Response Envelope

Broker-to-harness responses use the `RequestResponse` shape from 02-schemas, discriminated on `ok: true | false` with the matching `requestId`.

### WsServer

```typescript
interface WsServerDeps {
  readonly core: BrokerCore;
  readonly sessionManager: SessionManager;
  readonly attestationManager: AttestationManager;
}

interface WsServer {
  /** Start listening for connections. */
  start(): Promise<Result<{ port: number }, InternalError>>;

  /** Graceful shutdown: drain connections, wait for in-flight, close. */
  stop(): Promise<Result<void, InternalError>>;

  /** Current server state. */
  readonly state: WsServerState;

  /** Number of active connections. */
  readonly connectionCount: number;
}

type WsServerState = "idle" | "listening" | "draining" | "stopped";

function createWsServer(
  config: WsServerConfig,
  deps: WsServerDeps,
): WsServer;
```

## Zod Schemas

All event and request schemas are imported from `@xmtp-broker/schemas` (see 02-schemas.md). This package adds:

- `WsServerConfigSchema` -- server configuration
- `AuthFrame` -- harness auth handshake
- `AuthenticatedFrame` -- broker auth confirmation
- `AuthErrorFrame` -- broker auth rejection
- `BackpressureFrame` -- backpressure signal
- `SequencedFrame` -- sequenced event envelope

## Behaviors

### Connection Lifecycle State Machine

```
  Client connects (HTTP upgrade)
         |
         v
  ┌────────────────┐   auth timeout    ┌────────┐
  │ authenticating  │ ──────────────>   │ closed │
  └────────┬───────┘                   └────────┘
           | auth frame received
           v
  ┌────────────────┐   session revoked / error
  │    active      │ ────────────────────────────> ┌────────┐
  └────────┬───────┘                               │ closed │
           | server shutdown / session expired      └────────┘
           v
  ┌────────────────┐   drain timeout
  │   draining     │ ──────────────> ┌────────┐
  └────────────────┘                 │ closed │
                                     └────────┘
```

**authenticating**: Connection accepted, waiting for auth frame. A timer fires after `authTimeoutMs` -- if no valid auth frame arrives, the broker sends an `AuthErrorFrame` with message "auth timeout" and closes the connection.

**active**: Authenticated. Events flow broker-to-harness; requests flow harness-to-broker. The connection remains active until session expiry, explicit revocation, server shutdown, or transport failure.

**draining**: The broker has initiated disconnect (shutdown, session revoked, etc.). In-flight responses are completed. No new events are sent except the terminal event (e.g., `session.expired`). After `drainTimeoutMs`, the connection closes regardless.

**closed**: Terminal. Connection resources are released.

### Auth Handshake

```
  Harness                              Broker
    |                                    |
    |--- WebSocket upgrade ------------->|
    |                                    |  start auth timer
    |--- auth { token, lastSeenSeq } --->|
    |                                    |  validate token via SessionManager
    |                                    |
    |<-- authenticated { ... } ----------|  (success)
    |    OR                              |
    |<-- auth_error { ... } -------------|  (failure, then close)
    |                                    |
    |<-- [replayed events if resuming] --|
    |                                    |
    |<-- heartbeat ----------------------|  (periodic)
    |--- send_message { requestId } ---->|
    |<-- response { requestId, ok } -----|
```

1. Harness opens a WebSocket connection to `ws://{host}:{port}/v1/agent`.
2. Broker accepts the upgrade and transitions to `authenticating`. Starts `authTimeoutMs` timer.
3. Harness sends an `AuthFrame` with its session bearer token and optional `lastSeenSeq`.
4. Broker validates the token via `sessionManager.getSessionByToken(token)`.
5. On success:
   - Cancels auth timer.
   - Registers connection in the connection registry.
   - Transitions to `active`.
   - Sends `AuthenticatedFrame` with session info, view, and grant.
   - If `lastSeenSeq` is non-null, replays buffered events (see Reconnection).
   - Starts heartbeat timer.
   - Subscribes to `BrokerCore` raw events for this session's view scope.
6. On failure:
   - Sends `AuthErrorFrame` with the error code and message.
   - Closes the WebSocket with code 4001 (auth failed).

### Request/Response Flow

1. Harness sends a `HarnessRequest` JSON frame (parsed and validated against the `HarnessRequest` discriminated union).
2. Broker extracts `requestId` and `type`.
3. Broker validates the request against the session's active grant (via policy engine functions).
4. If grant check fails: sends `RequestResponse` with `ok: false` and the error.
5. If grant check succeeds:
   - For `send_message` / `send_reply`: if `draftOnly`, emits `action.confirmation_required` event and holds the message. Otherwise, sends via `CoreContext.sendMessage()`.
   - For `send_reaction`: sends via `CoreContext.sendMessage()` with reaction content type.
   - For `reveal_content`: delegates to `RevealStateStore`, replays affected messages.
   - For `heartbeat`: records via `sessionManager.recordHeartbeat()`.
   - For `confirm_action`: releases or discards the held action.
   - For `update_view`: checks materiality. Non-material: applies in-place. Material: sends `session.reauthorization_required` event and transitions to draining.
6. Sends `RequestResponse` with `ok: true` and result data.

Request timeout: if the handler does not respond within 30 seconds, the broker sends `RequestResponse` with `ok: false`, category `timeout`, and cleans up. The `inFlightRequests` map tracks pending requests for this purpose.

### Event Broadcasting

When the `BrokerCore` emits a `RawEvent`:

1. The transport routes it through `projectMessage()` for each active connection's view config.
2. If the projection result is `emit`, the transport wraps the `MessageEvent` in a `SequencedFrame`.
3. The frame is serialized to JSON and sent on the connection.
4. The frame is appended to the connection's replay buffer.

Non-message events (`session.expired`, `heartbeat`, `attestation.updated`, etc.) are sent directly to relevant connections without projection.

### Sequence Numbers

- Every broker-to-harness frame gets a monotonically increasing `seq` number.
- Sequence numbers are scoped to the connection, starting at 1.
- `ConnectionState.nextSeq` tracks the next number to assign.
- The harness tracks `lastSeenSeq` for reconnection.
- Sequence numbers are assigned at send time, not at event creation time.

### Reconnection and Replay

Reconnection is client-side responsibility. The broker provides replay support:

1. Harness reconnects and sends `AuthFrame` with `lastSeenSeq: N`.
2. Broker validates the token. If the session is still active:
   - Scans the connection's replay buffer for events with `seq > N`.
   - If all events since N are in the buffer: replays them in order, then resumes live.
   - If the buffer has been overwritten (client too far behind): sends a special `broker.recovery.complete` event signaling the harness should do a full state resync. No replay is attempted.
3. The `AuthenticatedFrame` includes `resumedFromSeq` indicating where replay started, or `null` if fresh.

**Buffer implementation**: A `CircularBuffer<SequencedFrame>` with capacity `replayBufferSize` (default 1000). Oldest entries are overwritten when full.

**Session continuity**: The replay buffer is keyed by session ID, not connection ID. If a harness disconnects and reconnects with the same session token, it gets the same buffer. The buffer is cleared when the session is revoked or expired.

### Heartbeat

Two layers of liveness checking:

**Application heartbeat** (broker to harness):
- Broker sends a `HeartbeatEvent` wrapped in a `SequencedFrame` at `heartbeatIntervalMs` intervals.
- The harness should treat `missedHeartbeatsBeforeDead` consecutive missed heartbeats as connection dead and reconnect.
- Heartbeats carry the `sessionId` so multi-connection harnesses can track per-session liveness.

**Transport ping/pong** (WebSocket protocol level):
- `Bun.serve()` handles WebSocket ping/pong automatically.
- This provides transport-level liveness detection independent of application heartbeats.

**Harness heartbeat** (harness to broker):
- The harness sends `HeartbeatRequest` frames to keep its session alive.
- The broker records these via `sessionManager.recordHeartbeat()`.
- Missing harness heartbeats trigger session revocation via the session manager's sweep.

### Backpressure

The broker tracks per-connection send buffer depth:

1. Each `ws.send()` call increments `sendBufferDepth`. The `drain` event on Bun's WebSocket handler decrements it.
2. When `sendBufferDepth >= sendBufferSoftLimit`: broker sends a `BackpressureFrame` and sets `backpressureNotified = true`.
3. When buffer drops below soft limit: broker clears `backpressureNotified`. No explicit "backpressure cleared" frame -- the harness infers relief from continued event flow.
4. When `sendBufferDepth >= sendBufferHardLimit`: broker closes the connection with code 4008 (backpressure exceeded). The harness should reconnect with a slower request rate.

### Graceful Shutdown

```
  stop() called
      |
      v
  Set state = "draining"
      |
      v
  Stop accepting new connections
      |
      v
  For each active connection:
      |-- Send session.expired event (reason: "broker_shutdown")
      |-- Transition connection to "draining"
      |
      v
  Wait for in-flight responses (up to drainTimeoutMs)
      |
      v
  Close all connections with code 1001 (going away)
      |
      v
  Set state = "stopped"
```

### Bun.serve() Integration

```typescript
const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/v1/agent") {
      const upgraded = server.upgrade(req, {
        data: createConnectionState(),
      });
      if (!upgraded) {
        return new Response("Upgrade failed", { status: 400 });
      }
      return undefined;
    }
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) { /* start auth timer */ },
    message(ws, message) { /* route to auth or request handler */ },
    close(ws, code, reason) { /* cleanup connection state */ },
    drain(ws) { /* decrement sendBufferDepth */ },
    maxPayloadLength: config.maxFrameSizeBytes,
    idleTimeout: 0, // managed by application heartbeat
  },
});
```

The `ws.data` field is typed as `ConnectionState`, giving type-safe access to per-connection state in all handler callbacks.

### Event Ordering

- Events within a single group are ordered by XMTP message timestamp (as received from the core's stream).
- Events across groups have no guaranteed ordering relative to each other.
- Heartbeats interleave freely with other events.
- Sequence numbers provide total ordering within a connection regardless of source group.

### Connection Registry

```typescript
interface ConnectionRegistry {
  /** Register a new authenticated connection. */
  add(ws: ServerWebSocket<ConnectionState>): void;

  /** Remove a connection (disconnect or shutdown). */
  remove(connectionId: string): void;

  /** Get all connections for a session. */
  getBySessionId(sessionId: string): readonly ServerWebSocket<ConnectionState>[];

  /** Get all connections for an agent. */
  getByAgentInboxId(agentInboxId: string): readonly ServerWebSocket<ConnectionState>[];

  /** Broadcast a sequenced event to all connections for a session. */
  broadcast(sessionId: string, event: BrokerEvent): void;

  /** Total active connection count. */
  readonly size: number;
}
```

### WebSocket Close Codes

| Code | Meaning | Used when |
|------|---------|-----------|
| 1000 | Normal | Clean client disconnect |
| 1001 | Going away | Server shutdown |
| 4001 | Auth failed | Invalid or expired token |
| 4002 | Auth timeout | No auth frame within timeout |
| 4003 | Session expired | Session TTL exceeded |
| 4004 | Session revoked | Explicit revocation |
| 4005 | Policy change | Material change requires reauth |
| 4008 | Backpressure | Send buffer hard limit exceeded |
| 4009 | Protocol error | Malformed frame or unknown type |

## Error Cases

| Scenario | Error | Close Code | Category |
|----------|-------|------------|----------|
| No auth frame within timeout | `AuthError` | 4002 | auth |
| Invalid token | `AuthError` | 4001 | auth |
| Expired session token | `SessionExpiredError` | 4001 | auth |
| Malformed JSON frame | `ValidationError` | 4009 | validation |
| Unknown request type | `ValidationError` | -- (response only) | validation |
| Request for group not in view | `PermissionError` | -- (response only) | permission |
| Grant denied | `GrantDeniedError` | -- (response only) | permission |
| Handler timeout | `TimeoutError` | -- (response only) | timeout |
| Send buffer overflow | `InternalError` | 4008 | internal |
| Server shutdown during active session | -- | 1001 | -- |

Protocol errors (malformed frames, unknown types) send a `RequestResponse` with `ok: false` if a `requestId` can be extracted. If the frame is completely unparseable, the connection is closed with code 4009.

## Open Questions Resolved

**Q: Should auth happen at HTTP upgrade or in-band?** (Transport design)
**A:** In-band. The first WebSocket frame must be an `AuthFrame`. Rationale: keeps the transport simple -- no custom HTTP headers, no cookie management, no token-in-URL leakage. The 5-second auth timeout prevents unauthenticated connections from lingering.

**Q: How should reconnection replay work?** (PRD: Liveness and Graceful Degradation)
**A:** Per-session circular buffer with configurable size (default 1000 events). The harness sends `lastSeenSeq` on reconnect; the broker replays from that point if still buffered. If the client is too far behind, the broker signals a full resync via `broker.recovery.complete`. Rationale: bounded memory, simple implementation, no persistent replay log needed for v0.

**Q: What is the default heartbeat interval?** (PLAN.md Key Decisions)
**A:** 30 seconds, matching the PLAN.md decision. Three missed heartbeats (90 seconds) signals a dead connection. This balances liveness detection speed with bandwidth overhead.

**Q: How should backpressure be handled?** (Transport design)
**A:** Two-tier: soft limit sends a warning frame (harness should slow down), hard limit disconnects (harness must reconnect). Rationale: the warning frame gives well-behaved harnesses a chance to adapt before forced disconnect.

## Deferred

- **TLS/WSS**: v0 runs on `ws://localhost`. TLS termination is an operational concern for deployment, not a broker concern.
- **Binary frames**: All frames are JSON text. Binary framing (MessagePack, protobuf) is a Phase 2 performance optimization.
- **Connection multiplexing**: One connection per session. Multiplexing multiple sessions over a single connection is deferred.
- **HTTP health endpoint**: A `/health` endpoint for load balancers is useful but not required for local v0.
- **Rate limiting**: Per-connection request rate limiting is deferred. Backpressure provides a coarse safety valve.
- **MCP, CLI, HTTP transports**: Other transport surfaces are Phase 2+. The handler contract ensures adding them is mechanical.
- **Compression**: WebSocket per-message deflate is deferred to Phase 2.

## Testing Strategy

### What to Test

1. **Auth handshake** -- Valid token authenticates. Invalid token rejected with 4001. Timeout fires with 4002.
2. **Frame parsing** -- Valid JSON parsed and routed. Malformed JSON rejected with 4009. Unknown type rejected.
3. **Request/response correlation** -- Responses carry matching `requestId`. Multiple concurrent requests resolve independently.
4. **Sequence numbering** -- Events have monotonically increasing `seq`. Numbering starts at 1. Each connection has independent numbering.
5. **Reconnection replay** -- Resume with `lastSeenSeq` replays buffered events. Too-far-behind triggers full resync signal.
6. **Backpressure** -- Soft limit sends warning. Hard limit disconnects.
7. **Heartbeat** -- Heartbeat frames sent at configured interval. Missing heartbeats trigger session sweep.
8. **Graceful shutdown** -- Drain sends terminal events, waits for in-flight, then closes.
9. **Event broadcasting** -- Raw events projected through view and sent to correct connections.
10. **Grant enforcement** -- Requests validated against session grant before execution.

### How to Test

**Unit tests**: Mock the `BrokerCore`, `SessionManager`, and `AttestationManager`. Test frame parsing, sequence numbering, replay buffer, backpressure logic, and connection state transitions in isolation.

**Integration tests**: Start a real `WsServer` on a random port, connect with a WebSocket client, and exercise the full auth -> request -> response -> disconnect flow. Use mock runtime deps.

### Key Test Scenarios

```typescript
// Auth handshake success
const ws = new WebSocket(`ws://localhost:${port}/v1/agent`);
ws.send(JSON.stringify({ type: "auth", token: validToken, lastSeenSeq: null }));
const frame = JSON.parse(await nextMessage(ws));
expect(frame.type).toBe("authenticated");
expect(frame.session.sessionId).toBeDefined();

// Auth timeout
const ws2 = new WebSocket(`ws://localhost:${port}/v1/agent`);
// send nothing, wait for close
const { code } = await waitForClose(ws2);
expect(code).toBe(4002);

// Request/response
ws.send(JSON.stringify({
  type: "send_message",
  requestId: "req_1",
  groupId: "g1",
  contentType: "xmtp.org/text:1.0",
  content: { text: "hello" },
}));
const resp = JSON.parse(await nextMessage(ws));
expect(resp.ok).toBe(true);
expect(resp.requestId).toBe("req_1");

// Sequence numbers on events
const events = await collectEvents(ws, 3);
expect(events[0].seq).toBe(1);
expect(events[1].seq).toBe(2);
expect(events[2].seq).toBe(3);

// Reconnection replay
ws.close();
const ws3 = new WebSocket(`ws://localhost:${port}/v1/agent`);
ws3.send(JSON.stringify({ type: "auth", token: validToken, lastSeenSeq: 2 }));
const authFrame = JSON.parse(await nextMessage(ws3));
expect(authFrame.resumedFromSeq).toBe(2);
const replayed = JSON.parse(await nextMessage(ws3));
expect(replayed.seq).toBe(3);

// Backpressure
// flood the connection with events faster than it drains
// verify backpressure frame received before disconnect
```

### Test Utilities

```typescript
/** Create a WsServer with all deps mocked and a random port. */
function createTestWsServer(
  overrides?: Partial<WsServerConfig>,
): { server: WsServer; mocks: WsTestMocks; port: number };

interface WsTestMocks {
  core: BrokerCore;
  sessionManager: SessionManager;
  attestationManager: AttestationManager;
  emitRawEvent: (event: RawEvent) => void;
}

/** Connect a WebSocket client and complete auth. */
async function connectAndAuth(
  port: number,
  token: string,
): Promise<WebSocket>;

/** Collect N messages from a WebSocket. */
async function collectMessages(
  ws: WebSocket,
  count: number,
  timeoutMs?: number,
): Promise<unknown[]>;

/** Wait for a WebSocket close event. */
async function waitForClose(
  ws: WebSocket,
  timeoutMs?: number,
): Promise<{ code: number; reason: string }>;
```

## File Layout

```
packages/ws/
  package.json
  tsconfig.json
  src/
    index.ts                    # Re-exports public API
    config.ts                   # WsServerConfigSchema
    server.ts                   # createWsServer(), WsServer implementation
    connection-state.ts         # ConnectionState, ConnectionPhase, createConnectionState()
    connection-registry.ts      # ConnectionRegistry implementation
    frames.ts                   # AuthFrame, AuthenticatedFrame, AuthErrorFrame,
                                # BackpressureFrame, SequencedFrame schemas
    auth-handler.ts             # Auth handshake logic
    request-router.ts           # Parse HarnessRequest, route to handler, send response
    event-broadcaster.ts        # Subscribe to core events, project, sequence, broadcast
    replay-buffer.ts            # CircularBuffer<SequencedFrame> implementation
    backpressure.ts             # Send buffer tracking, soft/hard limit logic
    close-codes.ts              # WebSocket close code constants
    __tests__/
      auth-handler.test.ts
      request-router.test.ts
      event-broadcaster.test.ts
      replay-buffer.test.ts
      backpressure.test.ts
      connection-registry.test.ts
      server.integration.test.ts  # Full lifecycle integration tests
      fixtures.ts                 # Test utilities
```

Each source file targets under 200 LOC. The `server.ts` orchestrates but delegates to `auth-handler.ts`, `request-router.ts`, and `event-broadcaster.ts` for the three main concerns.
