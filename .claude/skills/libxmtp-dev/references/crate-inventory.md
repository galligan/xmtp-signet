# libxmtp Crate Inventory

Source: `.reference/libxmtp/`

## Crates by size and role

| Crate | Lines | Category | Role |
|---|---|---|---|
| `xmtp_proto` | ~67K | Foundation | Protobuf definitions (mostly generated). Defines `XmtpApi`, `XmtpMlsClient`, `XmtpIdentityClient`, `XmtpMlsStreams` traits. |
| `xmtp_mls` | ~55K | Core | The monolith. Client, groups, messages, sync, subscriptions, intents, identity, workers. |
| `xmtp_db` | ~25K | Storage | Diesel ORM over encrypted SQLite (SQLCipher). 22 tables. OpenMLS `StorageProvider` impl. |
| `xmtp_api_d14n` | ~15K | Transport | Decentralized API client (Broadcast Network + App Chain). |
| `xmtp_id` | ~6.5K | Identity | Inbox ID generation, associations (wallet ↔ inbox), key packages, SCW verification. |
| `xmtp_content_types` | ~3K | Content | 17 content type codecs. |
| `xmtp_common` | ~3K | Foundation | Retry, streams, logging, macros, time, platform abstractions. |
| `xmtp_mls_common` | ~2.5K | Foundation | Shared MLS types: metadata, permissions, TLS collections. |
| `xmtp_macro` | ~2.2K | Build | Proc macros for error codes, logging. |
| `xmtp_api_grpc` | ~1.9K | Transport | Legacy gRPC API client. |
| `xmtp_api` | ~1.7K | Transport | API trait definitions + wrapper types. |
| `xmtp_archive` | ~1K | Application | Archive export/import for device sync. |
| `xmtp_cryptography` | ~1K | Foundation | Ed25519 credentials, ECDSA utils, hashing. |
| `xmtp_configuration` | ~400 | Foundation | Constants, timing, feature flags, environment configs. |

## Bindings

| Target | Lines | Technology |
|---|---|---|
| `bindings/mobile` | ~16K | uniffi (generates Swift + Kotlin) |
| `bindings/node` | ~6.3K | napi-rs (generates `@xmtp/node-bindings`) |
| `bindings/wasm` | ~6.3K | wasm-bindgen (generates `@xmtp/wasm-bindings`) |

## SDKs (in-repo)

- `sdks/android/` — Android SDK
- `sdks/ios/` — iOS SDK (Swift, uses Package.swift at repo root)

## xmtp_mls internal modules

The core crate's internal structure:

| Module | Lines (approx) | Category |
|---|---|---|
| `groups/mls_sync.rs` | ~5K (181KB) | MLS-protocol + application mixed. Publish intents, process messages, validate commits. THE monolith within the monolith. |
| `groups/mod.rs` | ~2K | Application. Group creation, metadata, send message. |
| `groups/intents.rs` | ~1.5K | Application. Intent data types for group operations. |
| `groups/group_permissions.rs` | ~1.5K | Application. Permission policy system. |
| `groups/validated_commit.rs` | ~1K | MLS-protocol. Commit validation logic. |
| `groups/members.rs` | ~500 | Application. Member listing and queries. |
| `groups/subscriptions.rs` | ~500 | Application. Per-group streaming. |
| `groups/welcomes/` | ~800 | MLS-protocol. Welcome message processing. |
| `groups/commit_log.rs` | ~400 | MLS-protocol. Commit integrity tracking. |
| `messages/` | ~400 | Application. Message decoding, enrichment. |
| `identity.rs` + `identity/` | ~600 | Identity. Installation keys, key packages. |
| `identity_updates.rs` | ~500 | Identity. Association state management. |
| `subscriptions/` | ~1K | Transport. Streaming subscriptions. |
| `worker/` | ~2K+ | Infrastructure. Background sync, key rotation, disappearing messages. |
| `client.rs` | ~800 | Application. Client struct, orchestration. |
| `builder.rs` | ~690 | Application. ClientBuilder, worker registration. |
| `context.rs` | ~375 | Infrastructure. `XmtpSharedContext` trait, DI. |

## xmtp_db tables (22 total)

**MLS-state tables** (must stay with MLS engine):
- `openmls_key_store` — OpenMLS key-value store
- `openmls_key_value` — OpenMLS epoch/tree state
- `key_package_history` — key package rotation tracking

**Application-data tables** (could move to application layer):
- `groups` — group metadata, membership state, consent
- `group_messages` — decoded messages with content, sender, timestamps
- `group_intents` — pending group operation intents
- `identity_updates` — cached association states
- `consent_records` — per-entity consent (inbox, group, address)
- `user_preferences` — synced preferences
- `wallet_addresses` — known wallet associations
- `association_state` — inbox-to-identity mappings
- Plus ~10 more operational tables (cursors, sync state, events, etc.)
