# Phase 1 Integration Test Plan

**Purpose:** Validate that all Phase 1 packages compose correctly before building Phase 2 on top.
**Location:** `packages/integration/` (new workspace package, test-only, not published)
**Runner:** `bun:test`

## Test Boundary

These tests wire up real Phase 1 package implementations with **mocked XMTP** (no network calls). The mock boundary is the `XmtpClientFactory` and `XmtpClient` interfaces — everything above those interfaces uses real code.

```
Real code:
  schemas, contracts, policy, sessions, attestations, keys, ws

Mocked:
  XmtpClient (no real XMTP network)
  Secure Enclave (use software-vault platform)
```

## Test Suites

### 1. Full Happy Path (`happy-path.test.ts`)

End-to-end flow with all packages wired together:

1. Create a `KeyManager` (software-vault mode)
2. Initialize identity (root key → operational key)
3. Create a `BrokerCore` with mock `XmtpClientFactory`
4. Initialize the broker (creates XMTP client)
5. Create a `SessionManager`
6. Issue a session with a view (full mode) and grant (send + react)
7. Create a `WsServer` with all deps
8. Start the server
9. Connect a WebSocket client, send auth frame with session token
10. Verify `AuthenticatedFrame` received with correct view/grant
11. Emit a mock raw message event from the XMTP client
12. Verify the message arrives as a `SequencedFrame` on the WebSocket
13. Send a `send_message` request from the client
14. Verify the request succeeds (grant allows it)
15. Disconnect, reconnect with `lastSeenSeq`, verify replay
16. Stop server, verify graceful shutdown

### 2. Policy Enforcement (`policy-enforcement.test.ts`)

Verify view filtering and grant checking across packages:

- **View modes:** Full → all messages pass. Redacted → content stripped. Reveal-only → only revealed messages pass. Thread-only → only thread messages pass.
- **Content type allowlist:** Messages with allowed content types pass. Disallowed types are held.
- **Grant enforcement:** Send allowed → succeeds. Send denied → `PermissionError`. React allowed → succeeds. Group management denied → `PermissionError`.
- **Material change detection:** View mode change → triggers `session.reauthorization_required`. Grant expansion → triggers reauth. Session rotation within same scope → silent.

### 3. Attestation Lifecycle (`attestation-lifecycle.test.ts`)

Full attestation flow through real packages:

- Issue attestation for agent in group → signed with operational key
- Verify attestation signature with public key
- Verify attestation chain: first attestation has `previousAttestationId: null`
- Refresh attestation → new attestation chains to previous
- Revoke attestation → signed revocation envelope
- Query current attestation → returns latest
- Query after revocation → returns null

### 4. Session Lifecycle (`session-lifecycle.test.ts`)

Session management through real SessionManager:

- Issue session → returns token, session record has correct view/grant/expiry
- Lookup session by ID → matches issued record
- Heartbeat → session stays active
- Expire session (advance time past TTL) → `isActive` returns false
- Revoke session → immediate invalidation
- Attempt action with revoked session → `AuthError`
- Session with material view change → reauth required

### 5. Key Hierarchy (`key-hierarchy.test.ts`)

Key management through real KeyManager (software-vault):

- Initialize → root key created, operational key derived
- Sign data with operational key → signature verifies with public key
- Create session key → ephemeral, in-memory
- Admin key create → stored in vault with `admin-key:` prefix
- Admin JWT sign → verifies with admin public key
- Admin key rotate → old JWTs fail verification
- Vault isolation → admin keys and inbox keys don't collide
- Platform detection → reports `software-vault` on non-SE platforms

### 6. WebSocket Edge Cases (`ws-edge-cases.test.ts`)

Transport-level behaviors with real WsServer:

- Auth timeout → connection closed with 4002
- Invalid token → closed with 4001
- Expired session → closed with 4003
- Malformed frame → closed with 4009 or error response
- Backpressure soft limit → warning frame sent
- Backpressure hard limit → connection closed with 4008
- Heartbeat sent at configured interval
- Replay buffer: N events buffered, reconnect replays correctly
- Replay buffer overflow: too-far-behind triggers `broker.recovery.complete`
- Graceful shutdown: drain sends terminal events, waits for in-flight

### 7. Cross-Package Contract Verification (`contract-verification.test.ts`)

Verify that implementations match their contract interfaces:

- `BrokerCore` implementation satisfies `BrokerCore` interface from contracts
- `SessionManager` implementation satisfies `SessionManager` interface
- `AttestationManager` implementation satisfies `AttestationManager` interface
- `SignerProvider` implementation satisfies `SignerProvider` interface
- `AttestationSigner` implementation satisfies `AttestationSigner` interface
- All error types from schemas are constructable and have correct categories

## Mock Utilities

```typescript
/** Create a mock XmtpClient with configurable behavior. */
function createMockXmtpClient(options?: {
  inboxId?: string;
  groups?: XmtpGroupInfo[];
}): XmtpClient;

/** Create a mock XmtpClientFactory that returns mock clients. */
function createMockXmtpClientFactory(): {
  factory: XmtpClientFactory;
  emitMessage: (msg: XmtpDecodedMessage) => void;
  emitGroupEvent: (event: XmtpGroupEvent) => void;
};

/** Connect a WebSocket client, complete auth, return typed helpers. */
async function connectTestClient(port: number, token: string): Promise<{
  ws: WebSocket;
  nextEvent: () => Promise<SequencedFrame>;
  sendRequest: (req: HarnessRequest) => Promise<RequestResponse>;
  close: () => Promise<void>;
}>;

/** Create a fully wired broker runtime with all real packages. */
async function createTestRuntime(overrides?: {
  wsPort?: number;
  platform?: PlatformCapability;
}): Promise<{
  runtime: TestRuntime;
  mocks: { emitMessage; emitGroupEvent };
  cleanup: () => Promise<void>;
}>;
```

## File Layout

```
packages/integration/
  package.json
  tsconfig.json
  src/
    __tests__/
      happy-path.test.ts
      policy-enforcement.test.ts
      attestation-lifecycle.test.ts
      session-lifecycle.test.ts
      key-hierarchy.test.ts
      ws-edge-cases.test.ts
      contract-verification.test.ts
    fixtures/
      mock-xmtp-client.ts
      mock-xmtp-factory.ts
      test-runtime.ts
      test-ws-client.ts
```

## Running

```bash
# Run all integration tests
cd packages/integration && bun test

# Run a specific suite
cd packages/integration && bun test src/__tests__/happy-path.test.ts
```

## Success Criteria

All 7 suites pass. If any suite fails, it indicates an interface mismatch or behavioral inconsistency between Phase 1 packages that must be fixed before Phase 2 implementation begins.
