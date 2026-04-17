# libxmtp Trait Boundaries and Internal Structure

Factual inventory of existing trait abstractions and module organization.

## Existing trait boundaries

| Trait | Defined in | Purpose |
|---|---|---|
| `XmtpSharedContext` | `xmtp_mls/context.rs` | Central DI container. Associated types for `Db`, `ApiClient`, `MlsStorage`, `ContextReference`. Methods: `db()`, `api()`, `sync_api()`, `scw_verifier()`, `mls_provider()`, `identity()`, `mls_storage()`, `worker_events()`, `local_events()`, `mls_commit_lock()`, `mutexes()`. |
| `XmtpApi` | `xmtp_proto` | Network API surface. Message publish, subscribe, query. Implemented by `xmtp_api_d14n` and `xmtp_api_grpc`. |
| `XmtpDb` | `xmtp_db/traits.rs` | Storage access. Combined trait of 20+ sub-traits. Implemented by `EncryptedMessageStore`. |
| `XmtpMlsStorageProvider` | `xmtp_db` | OpenMLS `StorageProvider` implementation for SQLite. Implemented by `SqlKeyStore`. |
| `SmartContractSignatureVerifier` | `xmtp_id` | SCW signature verification. Has remote and local implementations. |
| `Worker` | `xmtp_mls/worker.rs` | Background task interface. Implemented by SyncWorker, KeyPackagesCleaner, DisappearingMessages, PendingSelfRemove, CommitLogWorker, TaskWorker. |
| `ContentCodec` | `xmtp_content_types` | Encode/decode for a content type. 17 built-in implementations. |
| `DbQuery` | `xmtp_db` | Composite query trait (groups, messages, intents, consent, etc.). 20+ sub-traits. |
| `XmtpQuery` | `xmtp_db` | Paginated query abstraction. |
| `CursorStore` | `xmtp_mls` | Cursor persistence for sync position tracking. Implemented by `SqliteCursorStore`. |

## xmtp_mls internal modules by category

**MLS protocol operations:**
- `groups/mls_sync.rs` (~5K lines, 181KB) — intent publishing, message receiving/decryption, commit validation/application, key package fetching, HMAC computation, welcome wrapping, fork detection, group membership resolution
- `groups/validated_commit.rs` (~1K lines) — commit validation logic
- `groups/welcomes/` (~800 lines) — welcome message processing
- `groups/commit_log.rs` (~400 lines) — commit integrity tracking
- `groups/group_membership.rs` — group membership state tracking
- `groups/mls_ext/` — MLS extensions

**Application logic:**
- `client.rs` (~800 lines) — Client struct, orchestration (create group, create DM, conversations, inbox state, consent)
- `builder.rs` (~690 lines) — ClientBuilder, worker registration
- `groups/mod.rs` (~2K lines) — group creation, metadata, send message
- `groups/intents.rs` (~1.5K lines) — intent data types for group operations
- `groups/group_permissions.rs` (~1.5K lines) — permission policy system
- `groups/members.rs` (~500 lines) — member listing and queries
- `messages/` (~400 lines) — message decoding, enrichment

**Identity:**
- `identity.rs` + `identity/` (~600 lines) — installation identity, key packages, HPKE wrapper keys
- `identity_updates.rs` (~500 lines) — association state management, installation diff tracking

**Infrastructure:**
- `context.rs` (~375 lines) — `XmtpSharedContext` trait, dependency injection
- `subscriptions/` (~1K lines) — streaming subscriptions
- `worker/` (~2K+ lines) — background sync, key rotation, disappearing messages, device sync
- `cursor_store.rs` — sync cursor persistence

## xmtp_db tables (22 total)

**MLS-state tables:**
- `openmls_key_store` — OpenMLS key-value store
- `openmls_key_value` — OpenMLS epoch/tree state
- `key_package_history` — key package rotation tracking

**Application-data tables:**
- `groups` — group metadata, membership state, consent, added_by_inbox_id, welcome_id, rotated_at
- `group_messages` — decoded messages with content, sender, timestamps, delivery_status, content_type, version_major/minor, authority_id
- `group_intents` — pending group operation intents with state machine (ToPublish, Published, Committed, Error)
- `identity_updates` — cached association states
- `consent_records` — per-entity consent (inbox_id, conversation_id, address)
- `user_preferences` — synced HMAC keys
- `wallet_addresses` — known wallet-to-inbox associations
- `association_state` — inbox-to-identity state cache

**Operational tables:**
- `refresh_state` — per-entity sync cursors (conversation topics, welcome topics, consent, key packages)
- `events` — local event log
- `identity` — local installation identity (inbox_id, installation_keys, credential, rowid=1 singleton)
- Plus additional tables for sync coordination, device sync state

## Key structural observations

- `mls_sync.rs` at 181KB / ~5K lines is the largest single file in the codebase
- `XmtpSharedContext` is required by most operations — carries transitive dependency on database, API client, identity, MLS storage, and event channels
- `DbQuery` requires implementing 20+ sub-traits; any code taking a `DbQuery` bound depends on the entire database schema
- `xmtp_mls` directly depends on `xmtp_content_types` for message decoding in `decoded_message.rs` and content-type-specific logic in `groups/mod.rs` (reply references, reaction references, delete message references)
- `Client<Context>` is generic over context — the trait-based DI pattern already enables pluggable implementations
- Platform-specific code is gated by `if_native!` / `if_wasm!` macros in `xmtp_common`
- The intent system in `groups/intents.rs` implements a state machine for pending group changes with retry on epoch conflicts
