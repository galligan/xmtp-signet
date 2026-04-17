---
name: libxmtp-dev
description: >
  Understand and navigate the libxmtp Rust codebase — the core XMTP protocol
  library that implements MLS-based messaging. Use this skill when analyzing
  libxmtp's architecture, understanding how it maps to the JS/mobile/WASM SDKs,
  identifying modularization opportunities, or tracing how a specific feature
  flows through the crate structure. Reference material lives in
  .reference/libxmtp/ (shallow clone).
---

# Working with libxmtp

> libxmtp is a Rust workspace implementing the XMTP messaging protocol using
> MLS (Messaging Layer Security). It produces bindings for mobile (Android/iOS
> via uniffi), WebAssembly, and Node.js (via napi).

## Reference location

The libxmtp source lives at `.reference/libxmtp/` as a read-only shallow clone.
**Do not modify files in this directory.**

## Architecture

```text
┌──────────────────────────────────────────────────────────────────┐
│                      LANGUAGE BINDINGS                           │
│  bindings/mobile (uniffi)  │  bindings/wasm  │  bindings/node    │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                ┌──────────────▼──────────────┐
                │      xmtp_mls (Client)      │
                │  Groups, messages, sync     │
                └──────────────┬──────────────┘
        ┌──────────┬───────────┼───────────┬──────────┐
        ▼          ▼           ▼           ▼          ▼
   xmtp_api   xmtp_db     xmtp_id    xmtp_proto  xmtp_cryptography
   (traits)   (storage)   (identity) (protobuf)  (crypto ops)
        │
        ├─► xmtp_api_grpc (gRPC implementation)
        └─► xmtp_api_d14n (decentralized API)
```

## Crate inventory

| Crate | Lines | Role |
|---|---|---|
| `xmtp_mls` | ~55K | **The core.** Client, groups, messages, sync, subscriptions, intents, identity, workers. This is the monolith that does most of the work. |
| `xmtp_db` | ~25K | Storage layer. Diesel ORM over encrypted SQLite (SQLCipher). Migrations, encrypted store, OpenMLS key store provider. |
| `xmtp_proto` | ~67K | Protobuf definitions (mostly generated). Wire format for all XMTP protocol messages. |
| `xmtp_api_d14n` | ~15K | Decentralized API client. Connects to the XMTP d14n network (Broadcast Network + App Chain). |
| `xmtp_id` | ~6.5K | Identity management. Inbox ID generation, key packages, associations (wallet ↔ inbox), SCW verification. |
| `xmtp_content_types` | ~3K | Content type codecs. Text, reaction, reply, read-receipt, attachments, group-updated, etc. |
| `xmtp_common` | ~3K | Shared utilities. Test macros, retry logic, time helpers, feature-gated platform abstractions. |
| `xmtp_mls_common` | ~2.5K | Shared MLS types. Content types, group membership, permissions, metadata policies. |
| `xmtp_api` | ~1.7K | API trait definitions. `XmtpApi` trait that `xmtp_api_grpc` and `xmtp_api_d14n` implement. |
| `xmtp_api_grpc` | ~1.9K | Legacy gRPC API client implementation. |
| `xmtp_cryptography` | ~1K | Crypto operations. Signature recovery, ECDSA utils. |
| `xmtp_archive` | ~1K | Archive/backup functionality for device sync. |
| `xmtp_configuration` | ~400 | Configuration and feature flags. |

## Bindings

| Target | Lines | Notes |
|---|---|---|
| `bindings/mobile` | ~16K | uniffi-based. Generates Swift and Kotlin bindings. |
| `bindings/node` | ~6.3K | napi-rs based. Generates `@xmtp/node-bindings` npm package. |
| `bindings/wasm` | ~6.3K | wasm-bindgen based. Generates `@xmtp/wasm-bindings`. |

## Key patterns

- **`Client<Context>`** — generic client parameterized by context (allows different API/DB combinations)
- **`ClientBuilder`** — fluent builder for client construction with identity, API, and storage config
- **`XmtpMlsLocalContext`** — centralizes dependencies (API, storage, identity, locks, events)
- **Trait abstractions** — `XmtpApi`, `XmtpDb`, `InboxOwner` enable pluggable implementations
- **Platform macros** — `if_native!` / `if_wasm!` for platform-specific code paths
- **Intent system** — state machine for pending group changes with retry on epoch conflicts

## Key modules in xmtp_mls

- `client.rs` — the Client struct, creation, registration
- `builder.rs` — ClientBuilder for fluent construction
- `context.rs` — XmtpMlsLocalContext (dependency container)
- `groups/` — group creation, membership, metadata, permissions, message sending/receiving
- `identity/` — identity management, inbox state
- `messages/` — message persistence, querying
- `subscriptions/` — network subscriptions, streaming
- `worker/` — background sync workers
- `intents.rs` — intent state machine for group operations
- `mls_store.rs` — MLS credential and key package store

## Key modules in xmtp_db

- `encrypted_store/` — Diesel-based encrypted SQLite store
- `sql_key_store/` — OpenMLS `StorageProvider` implementation backed by SQLite
- `traits.rs` — storage trait definitions

## Navigating the code

When tracing a feature:
1. Start in `bindings/node/src/` to see the public API surface
2. Follow into `crates/xmtp_mls/src/client.rs` or the relevant module
3. Storage operations route through `crates/xmtp_db/`
4. Network operations use traits from `crates/xmtp_api/`
5. Identity operations live in `crates/xmtp_id/`

## Relationship to the unified stack vision

The existing codebase (xmtp-signet) consumes libxmtp through `@xmtp/node-sdk`
(JS wrapper) → `@xmtp/node-bindings` (napi) → libxmtp. The `XmtpClient`
interface in `packages/core/src/xmtp-client-factory.ts` is the abstraction
boundary.

The modularization exercise maps libxmtp crates to proposed stack layers:

| libxmtp crate | Stack layer |
|---|---|
| `xmtp_mls` (MLS core) | Layer 4: MLS Processing |
| `xmtp_db` | Layer 6: Application Layer (message/conversation storage) |
| `xmtp_id` | Layer 6: Application Layer (participant awareness) |
| `xmtp_content_types` | Layer 6: Application Layer (codecs) |
| `xmtp_api` / `xmtp_api_d14n` | Layer 1-2: Gateway / Envelope Store |
| `xmtp_cryptography` | Layer 5: Key Custody |
| `xmtp_mls_common` | Shared types across layers |
