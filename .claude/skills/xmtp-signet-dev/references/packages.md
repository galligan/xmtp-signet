# Package API Reference

Per-package exports, dependencies, and extension points.

## Foundation Tier

### @xmtp/signet-schemas

The single source of truth for all types. Every type in the system is derived
from a Zod schema in this package.

**Exports:**
- Content types: `TextPayload`, `ReactionPayload`, `ReplyPayload`, `ReadReceiptPayload`, `GroupUpdatedPayload`, `BASELINE_CONTENT_TYPES`, `CONTENT_TYPE_SCHEMAS`
- Views: `ViewMode`, `ContentTypeAllowlist`, `ThreadScope`, `ViewConfig`
- Grants: `MessagingGrant`, `GroupManagementGrant`, `ToolScope`, `ToolGrant`, `EgressGrant`, `GrantConfig`
- Attestations: `InferenceMode`, `ContentEgressScope`, `RetentionAtProvider`, `HostingMode`, `TrustTier`, `RevocationRules`, `AttestationSchema`, `Attestation`
- Sessions: `SessionConfig`, `SessionToken`, `SessionState`
- Reveal: `RevealScope`, `RevealRequest`, `RevealGrant`, `RevealState`
- Revocation: `AgentRevocationReason`, `SessionRevocationReason`, `RevocationAttestation`
- Events: `MessageEvent`, `AttestationEvent`, `SessionStartedEvent`, `SessionExpiredEvent`, `SignetEvent` (union), and others
- Requests: `SendMessageRequest`, `SendReactionRequest`, `UpdateViewRequest`, and others
- Responses: `RequestSuccess`, `RequestFailure`, `RequestResponse`
- Action results: `ActionResultMetaSchema`, `ActionErrorSchema`, `PaginationSchema`, `ActionResultSchema`, `ActionErrorResultSchema` (and inferred types)
- Errors: `ErrorCategory`, `ErrorCategoryMetaSchema`, `ErrorCategoryMeta`, `ERROR_CATEGORY_META`, `errorCategoryMeta`, `SignetError` (union), `AnySignetError`, `matchError`, `ValidationError`, `AttestationError`, `NotFoundError`, `PermissionError`, `GrantDeniedError`, `AuthError`, `SessionExpiredError`, `InternalError`, `TimeoutError`, `CancelledError`, `NetworkError`

**Dependencies:** `zod`, `better-result`

**Extending:** Add new schemas here first. Export both the schema (for runtime validation) and the inferred type (for compile-time safety).

### @xmtp/signet-contracts

Service interfaces, action system, and wire format schemas that define boundaries between packages.

**Exports:**
- Core types: `CoreState`, `CoreContext`, `GroupInfo`, `RawMessage`, `RawEvent`
- Session types: `SessionRecord`, `MaterialityCheck`
- Policy types: `PolicyDelta`, `GrantError`
- Attestation types: `SignedAttestation`, `SignedAttestationEnvelope`, `SignedRevocationEnvelope`, `MessageProvenanceMetadata`
- Handler types: `HandlerContext` (with `requestId`, `signal`, optional `adminAuth`, `sessionId`), `Handler`, `AdminAuthContext`
- Action system: `ActionSpec`, `CliSurface`, `McpSurface`, `CliOption`, `ActionRegistry`, `createActionRegistry`, `ActionResult`, `toActionResult`
- Service interfaces: `SignetCore`, `SessionManager`, `AttestationManager`
- Provider interfaces: `SignerProvider`, `AttestationSigner`, `AttestationPublisher`, `RevealStateStore`

**Dependencies:** `@xmtp/signet-schemas`

**Extending:** When a new service needs to be consumed across packages, define its interface here. Runtime packages implement these contracts. New signet operations should be defined as `ActionSpec` and registered with `createActionRegistry`.

## Runtime Tier

### @xmtp/signet-core

The XMTP client abstraction layer. Defines the `XmtpClient` interface for client lifecycle management. `@xmtp/node-sdk` is now wired as a real dependency.

**Exports:**
- Config: `SignetCoreConfigSchema`, `XmtpEnvSchema`, `IdentityModeSchema`
- Implementation: `SignetCoreImpl`, `SignetCoreContext`
- Identity: `SqliteIdentityStore`, `AgentIdentity`
- Registry: `ClientRegistry`, `ManagedClient`
- Events: `CoreEventEmitter`, `RawMessageEvent`, `RawGroupJoinedEvent`, etc.
- XMTP abstraction: `XmtpClient`, `XmtpClientFactory`, `XmtpClientCreateOptions`, `XmtpGroupInfo`, `XmtpDecodedMessage`, `MessageStream`, `GroupStream`, `SignerProviderLike`
- SDK integration: `createSdkClientFactory`, `createSdkClient`, `createXmtpSigner`, `wrapSdkCall`, `wrapMessageStream`, `wrapGroupStream`, `toGroupInfo`, `toDecodedMessage`

**Dependencies:** `@xmtp/signet-contracts`, `@xmtp/signet-schemas`, `@xmtp/node-sdk`

**Extending:** To support new XMTP features, extend `XmtpClient` interface and update `SignetCoreImpl`. SDK integration lives in `src/sdk/`.

### @xmtp/signet-keys

Key hierarchy with encrypted vault. Three tiers (root, operational, session) plus admin keys.

**Exports:**
- Config: `KeyPolicySchema`, `PlatformCapabilitySchema`, `KeyManagerConfigSchema`
- Types: `RootKeyHandle`, `OperationalKey`, `SessionKey`
- Platform: `detectPlatform`, `platformToTrustTier`
- Manager: `createKeyManager` (central orchestrator, `KeyManager` has `.admin` property)
- Vault: `createVault`
- Signers: `createSignerProvider`, `createAttestationSigner`
- Sub-managers: `createOperationalKeyManager`, `createSessionKeyManager`
- Admin keys: `createAdminKeyManager`, `AdminKeyManager`, `AdminKeyRecord`, `AdminAuthContext`, `AdminAuthMethod`, `AdminJwtOptions`
- JWT: `AdminJwtConfigSchema`, `AdminJwtPayloadSchema`, `base64urlEncode`, `base64urlDecode`
- Root key: `initializeRootKey`, `signWithRootKey`
- Crypto: P-256/Ed25519 key gen, signing, verification, import/export, `fingerprint`, `toHex`

**Dependencies:** `@xmtp/signet-contracts`, `@xmtp/signet-schemas`

### @xmtp/signet-sessions

Session lifecycle and token management.

**Exports:**
- Token: `generateToken`, `generateSessionId`
- Policy: `computePolicyHash`
- Materiality: `checkMateriality`, `DetailedMaterialityCheck`
- Manager: `createSessionManager`, `SessionManagerConfig`

**Dependencies:** `@xmtp/signet-contracts`, `@xmtp/signet-schemas`

### @xmtp/signet-seals

Seal lifecycle — build, sign, encode, publish, delta computation.

**Exports:**
- ID: `generateAttestationId`
- Serialization: `canonicalize`
- Content types: `ATTESTATION_CONTENT_TYPE_ID`, `REVOCATION_CONTENT_TYPE_ID`, encode/decode functions
- Grant mapping: `grantConfigToOps`, `grantConfigToToolScopes`
- Builder: `buildAttestation`, `AttestationInput`, `AttestationBuildResult`
- Delta: `computeInputDelta`
- Manager: `createAttestationManager`

**Dependencies:** `@xmtp/signet-contracts`, `@xmtp/signet-schemas`, `@xmtp/signet-policy`

### @xmtp/signet-policy

View projection pipeline and grant enforcement.

**Exports:**
- Pipeline: `projectMessage`, `isInScope`, `isContentTypeAllowed`, `resolveVisibility`, `projectContent`
- Allowlist: `resolveEffectiveAllowlist`, `validateViewMode`
- Grant validation: `validateSendMessage`, `validateSendReply`, `validateSendReaction`, `validateGroupManagement`, `validateToolUse`, `validateEgress`, `checkGroupInScope`
- Reveal state: `createRevealStateStore`
- Materiality: `isMaterialChange`, `requiresReauthorization`

**Dependencies:** `@xmtp/signet-contracts`, `@xmtp/signet-schemas`

**Extending:** Add new grant validators in `src/grant/`. Add new pipeline stages in `src/pipeline/`.

### @xmtp/signet-verifier

6-check verification service for signet trust anchoring.

**Exports:**
- Schemas: `CheckVerdict`, `VerificationCheck`, `VerificationRequestSchema`, `VerificationStatementSchema`, `VerifierSelfAttestationSchema`
- Config: `VerifierConfigSchema`, `DEFAULT_STATEMENT_TTL_SECONDS`
- Content types: `VERIFICATION_REQUEST_CONTENT_TYPE_ID`, `VERIFICATION_STATEMENT_CONTENT_TYPE_ID`
- Checks: source available, build provenance, release signing, attestation signature, attestation chain, schema compliance
- Service: `createVerifierService`
- Utilities: `createRateLimiter`, `canonicalizeStatement`

**Dependencies:** `@xmtp/signet-contracts`, `@xmtp/signet-schemas`

## Transport Tier

### @xmtp/signet-ws

WebSocket transport built on `Bun.serve()`.

**Exports:**
- Config: `WsServerConfigSchema`
- Close codes: `WS_CLOSE_CODES`
- Frames: `AuthFrame`, `AuthenticatedFrame`, `AuthErrorFrame`, `BackpressureFrame`, `SequencedFrame`, `InboundFrame`
- Connection: `createConnectionState`, `canTransition`, `transition` (state machine: connecting → authenticating → active → draining → closed)
- Registry: `ConnectionRegistry`
- Replay: `CircularBuffer` (for session resumption)
- Backpressure: `BackpressureTracker`
- Auth: `handleAuth`, `TokenLookup`
- Routing: `routeRequest`, `RequestHandler`
- Event broadcasting: `sequenceEvent`
- Server: `createWsServer`

**Dependencies:** `@xmtp/signet-contracts`, `@xmtp/signet-schemas`

### @xmtp/signet-mcp

MCP transport. Converts ActionSpecs to MCP tools with session-scoped auth.

**Exports:**
- Config: `McpServerConfigSchema`, `McpServerConfig`
- Server: `createMcpServer`, `McpServerDeps`, `McpServerInstance`, `McpServerState`
- Tool registration: `actionSpecToMcpTool`, `McpToolRegistration`
- Call handler: `handleCallTool`, `CallToolRequest`
- Output: `formatActionResult`, `McpContentResponse`
- Context: `createHandlerContext`
- Session: `validateSession`, `checkSessionLiveness`

**Dependencies:** `@xmtp/signet-contracts`, `@xmtp/signet-schemas`, `@modelcontextprotocol/sdk`, `zod-to-json-schema`

### @xmtp/signet-cli

Composition root. CLI entry point, daemon lifecycle, admin socket, config loading.

**Exports:**
- CLI entry: `program` (Commander instance with 8 command groups)
- Config: `CliConfigSchema`, `CliConfig`, `AdminServerConfigSchema`, `AdminServerConfig`, `resolvePaths`, `ResolvedPaths`, `loadConfig`
- Daemon: `createDaemonLifecycle`, `DaemonState`, `DaemonLifecycle`, `createPidFile`, `PidFile`, `setupSignalHandlers`, `DaemonStatusSchema`, `DaemonStatus`
- Admin socket: `createAdminServer`, `AdminServer`, `createAdminClient`, `AdminClient`, `createAdminDispatcher`, `AdminDispatcher`
- Protocol: `JsonRpcRequestSchema`, `JsonRpcSuccessSchema`, `JsonRpcErrorSchema`, `AdminAuthFrameSchema`, `JSON_RPC_ERRORS`
- Commands: `createSignetCommands`, `createIdentityCommands`, `createSessionCommands`, `createGrantCommands`, `createAttestationCommands`, `createMessageCommands`, `createConversationCommands`, `createAdminCommands`
- Output: `exitCodeFromCategory`, `createOutputFormatter`, `formatOutput`, `formatNdjsonLine`
- Direct mode: `detectMode`, `CliMode`, `createDirectClient`, `DirectModeConfigSchema`

**Dependencies:** `@xmtp/signet-contracts`, `@xmtp/signet-schemas`, `commander`, `smol-toml`

## Client Tier

### @xmtp/signet-sdk

Harness-facing client SDK. WebSocket wrapper with typed events and Result-based requests.

**Exports:**
- Factory: `createSignetHandler`
- Config: `SignetHandlerConfigSchema`, `SignetHandlerConfig`
- Types: `SignetHandler`, `HandlerState`, `SessionInfo`, `StateChangeCallback`, `ErrorCallback`, `MessageContent`, `MessageSent`, `ReactionSent`, `Conversation`, `ConversationInfo`

**Dependencies:** `@xmtp/signet-schemas`, `better-result`

**Key interface:** `SignetHandler` provides `connect()`, `disconnect()`, `events` (async iterable), `sendMessage()`, `sendReaction()`, `listConversations()`, `getConversationInfo()`, `onStateChange()`, `onError()`. State machine: disconnected -> connecting -> authenticating -> connected -> reconnecting -> closed.

## Test

### @xmtp/signet-integration

Test-only package (private, not published). Cross-package integration tests.

**Test suites:** key-hierarchy, session-lifecycle, contract-verification, policy-enforcement, happy-path, attestation-lifecycle, ws-edge-cases

**Dependencies:** All Phase 1 runtime and transport packages
