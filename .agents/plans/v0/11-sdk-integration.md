# 11-sdk-integration

**Package:** `@xmtp-broker/core`
**Spec version:** 0.1.0

## Overview

The SDK integration wires `@xmtp/node-sdk` into the broker core as the production implementation of the `XmtpClient` and `XmtpClientFactory` interfaces defined in `xmtp-client-factory.ts`. Until now, the core has operated entirely against these abstract interfaces -- unit tests use mock implementations, and no real XMTP network calls exist anywhere in the codebase. This spec fills that gap.

Three components make up the integration:

1. **`SdkClientFactory`** -- implements `XmtpClientFactory` by calling `Client.create()` from `@xmtp/node-sdk`, wiring in the broker's `SignerProviderLike` as the SDK's `Signer`.
2. **`SdkClient`** -- implements `XmtpClient` by wrapping a live `@xmtp/node-sdk` `Client` instance, translating SDK types into the broker's abstract types and SDK errors into `Result` values.
3. **`createXmtpSigner`** -- a signer adapter that bridges the broker's `SignerProviderLike` interface to the XMTP SDK's `Signer` interface, handling the type-level mismatch between `Result`-returning methods and exception-throwing ones.

The existing `SqliteIdentityStore` (already in `identity-store.ts`) persists the `inboxId` returned by `Client.create()`. The SDK handles its own installation key persistence internally via the database file at `dbPath` — the broker just needs to provide the same `dbPath` and `dbEncryptionKey` (from the vault) on each restart. No new persistence interface is needed.

The integration lives in a new `packages/core/src/sdk/` directory to keep SDK-coupled code isolated from the abstract interfaces. The rest of the core imports only from `xmtp-client-factory.ts` and never touches SDK types directly.

## Dependencies

**Imports:**
- `@xmtp/node-sdk` -- `Client`, `Signer`, `Conversations`, `Group`, `DecodedMessage`, `GroupPermissionsOptions` (production SDK)
- `@xmtp-broker/schemas` -- `BrokerError`, `InternalError`, `NotFoundError`, `TimeoutError`
- `@xmtp-broker/contracts` -- `SignerProvider` (for type reference only)
- `better-result` -- `Result`, `Result.ok`, `Result.err`
- `bun:sqlite` -- `Database` (for identity store extension)

**Imported by:**
- `@xmtp-broker/core` internal -- `broker-core.ts` passes `SdkClientFactory` as the production factory
- Nothing external -- this is an internal implementation detail of `@xmtp-broker/core`

## Public Interfaces

### Signer Adapter

```typescript
import type { Signer } from "@xmtp/node-sdk";
import type { SignerProviderLike } from "../xmtp-client-factory.js";

/**
 * Bridge the broker's SignerProviderLike to the XMTP SDK's Signer interface.
 *
 * The SDK Signer uses exceptions for errors; the broker uses Result types.
 * This adapter unwraps Results and throws on failure, which is correct
 * because the SDK catches these exceptions internally during client creation.
 */
function createXmtpSigner(
  provider: SignerProviderLike,
): Signer;
```

The SDK `Signer` interface (as of `@xmtp/node-sdk` v1.x) expects:

```typescript
// From @xmtp/node-sdk (reference, not owned by broker)
interface Signer {
  getIdentifier(): Identifier;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

interface Identifier {
  identifier: string;
  identifierKind: IdentifierKind;
}
```

The adapter:
1. Calls `provider.getPublicKey()` to derive the identifier (hex-encoded public key).
2. Calls `provider.sign(message)` for `signMessage`, unwrapping the `Result` and throwing on error.
3. Uses `IdentifierKind.Ethereum` for the identifier kind, as XMTP associates Ed25519 keys via Ethereum-style addressing.

### SdkClient

```typescript
import type { XmtpClient, XmtpGroupInfo, XmtpDecodedMessage, XmtpGroupEvent, MessageStream, GroupStream } from "../xmtp-client-factory.js";

/**
 * Production XmtpClient backed by a live @xmtp/node-sdk Client.
 *
 * Wraps every SDK call in try/catch, converting exceptions to Result errors.
 * The underlying SDK Client must already be created and registered before
 * constructing SdkClient.
 */
interface SdkClientOptions {
  /** The live SDK Client instance. */
  readonly client: import("@xmtp/node-sdk").Client;
  /** Timeout for sync operations in milliseconds. */
  readonly syncTimeoutMs: number;
}

function createSdkClient(options: SdkClientOptions): XmtpClient;
```

### SdkClientFactory

```typescript
import type { XmtpClientFactory, XmtpClientCreateOptions, XmtpClient, SignerProviderLike } from "../xmtp-client-factory.js";

/**
 * Production factory that creates XmtpClient instances via @xmtp/node-sdk.
 *
 * Each call to create():
 * 1. Builds a Signer from the provided SignerProviderLike.
 * 2. Calls Client.create() with the signer, dbPath, dbEncryptionKey, and env.
 * 3. Wraps the resulting Client in an SdkClient adapter.
 */
function createSdkClientFactory(): XmtpClientFactory;
```

### Identity Data Store (Extension)

The existing `SqliteIdentityStore` needs no interface changes. However, the SDK requires that identity-related data (specifically the account address derived during `Client.create()`) be available across restarts. The `inboxId` field already captures this -- the SDK sets it during first registration, and the store persists it via `setInboxId()`.

No new interface is needed. The integration simply calls `setInboxId()` after successful `Client.create()`.

### Per-Group Identity Orchestration

When per-group identity is enabled (default-on per spec 03), creating or joining a group is an atomic operation that creates a new identity for that group. The flow is:

1. `BrokerCore` receives a "create group" or "join group" request.
2. `BrokerCore` calls `ClientRegistry.createClient(groupId)`.
3. `ClientRegistry` generates a new identity ID and calls `SdkClientFactory.create()` with fresh `XmtpClientCreateOptions` (new `identityId`, new `dbPath`, new `dbEncryptionKey` from the vault).
4. The factory creates a new `@xmtp/node-sdk` `Client` with its own inbox — this is the identity that joins/creates the group.
5. `ClientRegistry` registers the new `SdkClient` and maps it to the `groupId`.

There is no "add the broker's primary identity first, then create another." The new identity is the one that joins the group from the start. `SdkClientFactory.create()` is called once per group identity — it does not know about per-group vs shared identity; that orchestration is `ClientRegistry`'s concern.

## Zod Schemas

No new Zod schemas. The `XmtpClientCreateOptions` and related types are plain TypeScript interfaces defined in `xmtp-client-factory.ts`. The SDK version is pinned in `package.json`, not in a schema.

The `XmtpEnvSchema` from `config.ts` maps directly to the SDK's `XmtpEnvironment` enum:

| Broker `XmtpEnv` | SDK Environment |
|-------------------|-----------------|
| `"local"` | `"local"` |
| `"dev"` | `"dev"` |
| `"production"` | `"production"` |

## Behaviors

### Client Creation Flow

```
createSdkClientFactory().create(options, signerProvider)
    |
    +--> createXmtpSigner(signerProvider)
    |       |
    |       +--> provider.getPublicKey() -> hex identifier
    |       +--> Returns Signer { getIdentifier(), signMessage() }
    |
    +--> Client.create(signer, {
    |      dbPath: options.dbPath,
    |      dbEncryptionKey: options.dbEncryptionKey,
    |      env: options.env,
    |      appVersion: options.appVersion,
    |    })
    |
    +--> If Client.create() throws:
    |      Return Result.err(InternalError)
    |
    +--> createSdkClient({ client, syncTimeoutMs: 30_000 })
    |
    +--> Return Result.ok(sdkClient)
```

`Client.create()` is idempotent: if a database already exists at `dbPath`, it reuses the existing registration rather than creating a new one. This is critical for restart recovery -- the broker calls `create()` on every startup, and the SDK handles the "already registered" case transparently.

### Signer Adapter Flow

```
SDK calls signer.signMessage(message)
    |
    +--> adapter calls provider.sign(message)
    |
    +--> Result.isOk?
    |      Yes: return signature bytes
    |      No:  throw new Error(result.error.message)
    |
SDK catches the error and surfaces it through its own error handling
```

The adapter converts `Result` semantics to exception semantics at the SDK boundary. This is the one place in the codebase where throwing is acceptable -- the SDK expects it.

### SdkClient Method Mapping

Each `XmtpClient` method maps to one or more SDK calls:

| XmtpClient Method | SDK Call(s) | Notes |
|-------------------|-------------|-------|
| `sendMessage(groupId, content)` | `client.conversations.getConversationById(groupId).send(content)` | Returns the message ID from the SDK |
| `syncAll()` | `client.conversations.sync()` then `client.conversations.syncAllConversations()` | Two-step: sync conversation list, then sync each conversation's messages |
| `syncGroup(groupId)` | `client.conversations.getConversationById(groupId).sync()` | Single group sync |
| `getGroupInfo(groupId)` | `client.conversations.getConversationById(groupId)` + `.members()` | Combines metadata and membership |
| `listGroups()` | `client.conversations.list()` | Filters to group conversations only |
| `addMembers(groupId, inboxIds)` | `conversation.addMembers(inboxIds)` | SDK handles MLS key package exchange |
| `removeMembers(groupId, inboxIds)` | `conversation.removeMembers(inboxIds)` | SDK handles MLS commit |
| `streamAllMessages()` | `client.conversations.streamAllMessages()` | Returns wrapped async iterable |
| `streamGroups()` | `client.conversations.stream()` | Streams new conversation events |

### Error Translation

All SDK exceptions are caught and translated to broker error types:

```typescript
function wrapSdkCall<T>(
  fn: () => Promise<T>,
  context: string,
): Promise<Result<T, BrokerError>> {
  try {
    const result = await fn();
    return Result.ok(result);
  } catch (error) {
    return Result.err(
      InternalError.create(`SDK error: ${context}`, {
        cause: String(error),
      }),
    );
  }
}
```

Specific SDK error patterns are mapped where possible:

| SDK Error Pattern | Broker Error | Category |
|-------------------|-------------|----------|
| Conversation not found | `NotFoundError` | not_found |
| Network timeout | `TimeoutError` | timeout |
| MLS protocol error | `InternalError` | internal |
| Signer failure | `InternalError` | internal |
| Database corruption | `InternalError` | internal |
| All other exceptions | `InternalError` | internal |

### Stream Wrapping

The SDK streams (`streamAllMessages`, `stream`) return async iterables that emit decoded messages. The `SdkClient` wraps these into `MessageStream` and `GroupStream` types with abort capability:

```typescript
function wrapMessageStream(
  sdkStream: AsyncGenerator<DecodedMessage>,
): MessageStream {
  const abortController = new AbortController();

  const messages: AsyncIterable<XmtpDecodedMessage> = {
    async *[Symbol.asyncIterator]() {
      for await (const msg of sdkStream) {
        if (abortController.signal.aborted) break;
        yield {
          messageId: msg.id,
          groupId: msg.conversationId,
          senderInboxId: msg.senderInboxId,
          contentType: msg.contentType?.typeId ?? "unknown",
          content: msg.content,
          sentAt: new Date(msg.sentAtNs / 1_000_000n).toISOString(),
        };
      }
    },
  };

  return {
    messages,
    abort: () => {
      abortController.abort();
      sdkStream.return(undefined);
    },
  };
}
```

The `abort()` function both signals the wrapper to stop iterating and calls `return()` on the underlying SDK generator to release network resources.

### Group Info Mapping

```typescript
function toGroupInfo(conversation: Conversation): XmtpGroupInfo {
  return {
    groupId: conversation.id,
    name: conversation.name ?? "",
    description: conversation.description ?? "",
    memberInboxIds: conversation.members.map(m => m.inboxId),
    createdAt: new Date(conversation.createdAtNs / 1_000_000n).toISOString(),
  };
}
```

The `memberInboxIds` field requires an additional `.members()` call on the conversation. For `listGroups()`, member lists are fetched lazily only when requested by `getGroupInfo()` to avoid N+1 queries during listing.

### SDK Version Pinning

The `@xmtp/node-sdk` dependency is pinned to an exact version in `packages/core/package.json`:

```json
{
  "dependencies": {
    "@xmtp/node-sdk": "6.0.0"
  }
}
```

Pinning prevents surprise breaking changes from the SDK, which is actively evolving. Upgrades are explicit and tested.

### Database Path Convention

The SDK requires a file path for its SQLite database. The broker uses the convention established in 03-broker-core:

```
{dataDir}/db/{env}/{identityId}.db3
```

The `SdkClientFactory` receives this as `options.dbPath`. The factory does not create directories -- the caller (`broker-core.ts`) ensures the directory exists before calling `create()`.

### Reconnection Strategy

The SDK manages its own network connection internally. When the underlying gRPC connection drops, the SDK reconnects automatically. The broker's stream wrappers handle the case where the SDK's async generator terminates unexpectedly:

1. The `SdkClient` stream wrapper catches generator termination.
2. It does not attempt reconnection -- that is `broker-core.ts`'s responsibility (see 03-broker-core, Stream Reconnection).
3. It signals termination by ending the async iterable normally.
4. `broker-core.ts` detects the stream end, calls `syncAll()`, and restarts the stream.

### Thread Safety

`bun:sqlite` is not thread-safe, but Bun runs JavaScript single-threaded. All SDK calls are async but execute on the main thread. No mutex or locking is needed. The SDK's internal FFI calls to `libxmtp` are thread-safe on their side.

## Error Cases

| Scenario | Error | Category | Recovery |
|----------|-------|----------|----------|
| SDK `Client.create()` fails | `InternalError` | internal | Check key material and network |
| Signer `getPublicKey()` returns error | `InternalError` | internal | Key manager issue |
| Signer `sign()` returns error | `InternalError` | internal | Key manager issue |
| Conversation not found by ID | `NotFoundError` | not_found | Sync and retry |
| `syncAll()` times out | `TimeoutError` | timeout | Retry (retryable) |
| Stream generator throws | `InternalError` | internal | Restart stream |
| SDK database corruption | `InternalError` | internal | Delete DB, re-register |
| Network unreachable during create | `InternalError` | internal | Retry with backoff |
| MLS key package exhaustion | `InternalError` | internal | SDK handles key package rotation |
| `dbEncryptionKey` wrong length | `InternalError` | internal | Fix key derivation |

## Open Questions Resolved

**Q: Should the SDK integration live in `packages/core` or a separate package?**
**A:** In `packages/core` under a `src/sdk/` subdirectory. The SDK integration is an internal implementation detail of the core -- no other package should import it directly. A separate package would add workspace complexity without benefit, since the only consumer is `broker-core.ts`. The `xmtp-client-factory.ts` interface remains the public boundary; the `sdk/` directory is the private implementation.

**Q: How does the broker's `SignerProviderLike` map to the SDK's `Signer`?**
**A:** A thin adapter (`createXmtpSigner`) converts between the two. The broker's `SignerProviderLike` returns `Result` types; the SDK's `Signer` throws exceptions. The adapter unwraps Results and throws on error. This is acceptable because the SDK catches these exceptions internally during `Client.create()` and surfaces them through its own error handling. The adapter also maps the broker's raw Ed25519 public key bytes to the SDK's `Identifier` type.

**Q: How are SDK version updates managed?**
**A:** Exact version pinning in `package.json`. The SDK is actively evolving and has had breaking changes between minor versions. Pinning prevents surprise breakage. Upgrades are a deliberate action: update the pin, run the integration tests, fix any breakage, commit. The integration tests (see Testing Strategy) specifically validate that the adapter layer correctly handles the pinned version's API surface.

**Q: What happens to the `listGroups` method when the SDK's conversation type includes DMs?**
**A:** The SDK returns all conversation types from `conversations.list()`. The `SdkClient` filters to group conversations only (checking `conversation.conversationType === "group"`). DM conversations are excluded because the broker's group-centric model does not use SDK-level DMs -- the verifier (09-verifier) handles its own DM communication independently.

## Deferred

- **Content type codec registration.** v0 uses default content types only. Custom codec registration via the SDK's codec API is Phase 2.
- **Consent management.** The SDK's consent API (allow/block/deny) is not wired into the broker. Group consent is managed by the broker's policy engine, not by the SDK's consent mechanism.
- **Device sync.** `disableDeviceSync` is always `true` for per-group identities. Cross-device sync for shared identities is deferred.
- **SDK event callbacks.** The SDK supports event callbacks beyond streaming (e.g., `onMembershipChange`). These are not wired in v0 -- the broker discovers membership changes through `syncGroup()` and `streamGroups()`.
- **Binary message content.** v0 treats all message content as JSON-serializable. Binary content types (attachments, file transfers) require codec support, which is deferred.
- **Performance optimization.** The current implementation creates one SDK Client per identity. Connection pooling, lazy initialization, and batched sync are performance optimizations for post-v0.

## Testing Strategy

### What to Test

1. **Signer adapter** -- `createXmtpSigner` correctly maps `SignerProviderLike` to `Signer`. Error results throw. Success results return bytes.
2. **Error translation** -- SDK exceptions are caught and converted to appropriate broker error types (`NotFoundError`, `TimeoutError`, `InternalError`).
3. **Stream wrapping** -- SDK async generators are correctly wrapped into `MessageStream`/`GroupStream`. Abort terminates the stream. Message fields are correctly mapped.
4. **Group info mapping** -- SDK conversation metadata maps to `XmtpGroupInfo` with correct field names and types.
5. **Factory creation** -- `SdkClientFactory.create()` calls `Client.create()` with correct options, handles success and failure.
6. **Idempotent creation** -- Creating a client with an existing database reuses registration rather than creating a new identity.
7. **Conversation filtering** -- `listGroups()` excludes non-group conversation types.

### How to Test

**Unit tests** (majority): Mock the `@xmtp/node-sdk` `Client` class. The `SdkClient` and `SdkClientFactory` take SDK types as constructor arguments, making them easy to test with mock objects that simulate SDK behavior.

**Integration tests** (few, require XMTP local node): Use `env: "local"` with the XMTP local development environment. These tests verify end-to-end: create a client, send a message, receive it through a stream. Gated by CI environment detection.

### Key Test Scenarios

```typescript
// Signer adapter - success path
const mockProvider: SignerProviderLike = {
  sign: async (data) => Result.ok(new Uint8Array([1, 2, 3])),
  getPublicKey: async () => Result.ok(new Uint8Array(32)),
  getFingerprint: async () => Result.ok("abc123"),
  getDbEncryptionKey: async () => Result.ok(new Uint8Array(32)),
};
const signer = createXmtpSigner(mockProvider);
const sig = await signer.signMessage(new Uint8Array([4, 5, 6]));
expect(sig).toEqual(new Uint8Array([1, 2, 3]));

// Signer adapter - error path throws
const failProvider: SignerProviderLike = {
  sign: async () => Result.err(InternalError.create("key unavailable")),
  getPublicKey: async () => Result.ok(new Uint8Array(32)),
  getFingerprint: async () => Result.ok("abc123"),
  getDbEncryptionKey: async () => Result.ok(new Uint8Array(32)),
};
const failSigner = createXmtpSigner(failProvider);
expect(() => failSigner.signMessage(new Uint8Array([1]))).toThrow(
  "key unavailable",
);

// SdkClient error translation
const mockClient = createMockSdkClient();
mockClient.conversations.getConversationById = () => {
  throw new Error("conversation not found");
};
const sdkClient = createSdkClient({ client: mockClient, syncTimeoutMs: 5000 });
const result = await sdkClient.getGroupInfo("nonexistent");
expect(Result.isError(result)).toBe(true);
expect(result.error._tag).toBe("NotFoundError");

// Stream wrapping and abort
const mockMessages = async function* () {
  yield createMockDecodedMessage({ id: "msg1" });
  yield createMockDecodedMessage({ id: "msg2" });
  yield createMockDecodedMessage({ id: "msg3" });
};
const stream = wrapMessageStream(mockMessages());
const collected: XmtpDecodedMessage[] = [];
for await (const msg of stream.messages) {
  collected.push(msg);
  if (collected.length === 2) stream.abort();
}
expect(collected).toHaveLength(2);
expect(collected[0].messageId).toBe("msg1");

// Factory success
const factory = createSdkClientFactory();
const clientResult = await factory.create(
  {
    identityId: "test-id",
    dbPath: "/tmp/test.db3",
    dbEncryptionKey: new Uint8Array(32),
    env: "local",
    appVersion: "test/0.1.0",
  },
  mockProvider,
);
expect(Result.isOk(clientResult)).toBe(true);
expect(clientResult.value.inboxId).toBeDefined();

// listGroups filters non-group conversations
mockClient.conversations.list = async () => [
  createMockConversation({ type: "group", id: "g1" }),
  createMockConversation({ type: "dm", id: "dm1" }),
  createMockConversation({ type: "group", id: "g2" }),
];
const groups = await sdkClient.listGroups();
expect(Result.isOk(groups)).toBe(true);
expect(groups.value).toHaveLength(2);
```

### Test Utilities

```typescript
/** Create a mock @xmtp/node-sdk Client for unit testing. */
function createMockSdkClient(options?: {
  inboxId?: string;
}): MockSdkClient;

/** Create a mock DecodedMessage from the SDK. */
function createMockDecodedMessage(overrides?: {
  id?: string;
  conversationId?: string;
  senderInboxId?: string;
  content?: unknown;
}): DecodedMessage;

/** Create a mock Conversation from the SDK. */
function createMockConversation(overrides?: {
  type?: "group" | "dm";
  id?: string;
  name?: string;
  members?: Array<{ inboxId: string }>;
}): Conversation;

/** Create a SignerProviderLike that returns fixed values. */
function createTestSignerProvider(overrides?: {
  publicKey?: Uint8Array;
  signResponse?: Uint8Array;
}): SignerProviderLike;
```

## File Layout

```
packages/core/
  src/
    sdk/
      index.ts                    # Re-exports: createSdkClientFactory, createXmtpSigner
      signer-adapter.ts           # createXmtpSigner() -- SignerProviderLike -> SDK Signer
      sdk-client.ts               # createSdkClient() -- wraps SDK Client as XmtpClient
      sdk-client-factory.ts       # createSdkClientFactory() -- XmtpClientFactory impl
      stream-wrappers.ts          # wrapMessageStream(), wrapGroupStream()
      error-mapping.ts            # wrapSdkCall(), SDK error -> broker error translation
      type-mapping.ts             # toGroupInfo(), toDecodedMessage() -- SDK -> broker types
    __tests__/
      sdk-signer-adapter.test.ts  # Signer adapter unit tests
      sdk-client.test.ts          # SdkClient method mapping and error translation
      sdk-client-factory.test.ts  # Factory creation flow
      sdk-stream-wrappers.test.ts # Stream wrapping, abort, field mapping
      sdk-error-mapping.test.ts   # Error translation coverage
      sdk-type-mapping.test.ts    # Type conversion correctness
      sdk-fixtures.ts             # Mock SDK Client, DecodedMessage, Conversation
```

Each source file targets under 150 LOC. The `sdk-client.ts` file is the largest at approximately 120 LOC due to the number of `XmtpClient` methods it implements, but each method is a thin wrapper delegating to `wrapSdkCall()` and type mapping functions.
