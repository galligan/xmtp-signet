# Key Hierarchy

The signet uses a three-tier key hierarchy inspired by keypo-cli's Secure
Enclave patterns. Each tier has a different lifetime and security posture.

## Tiers

```
Root Key (platform-bound, long-lived)
  └─ Operational Key (daily signing, rotatable)
       └─ Session Key (per-connection, ephemeral)

Admin Key (standalone, peer to root — not derived from it)
```

### Root keys

Bound to platform security hardware when available:

| Platform | Mechanism | Curve |
|----------|-----------|-------|
| macOS | Secure Enclave | P-256 |
| Linux | TPM 2.0 | P-256 |
| Fallback | Software-derived | P-256 |

Root keys never leave the secure boundary. The `initializeRootKey` function
detects platform capabilities and creates the appropriate key handle.

### Operational keys

Derived from the root key. Handle day-to-day signing:
- Attestation signing
- Message provenance metadata
- Key agreement for session establishment

Operational keys can be rotated without changing the root. The
`createOperationalKeyManager` handles rotation, storage, and signing.

### Session keys

Generated per harness connection. Scoped to a single session:
- Encrypt/decrypt session-specific data
- Sign session tokens
- Automatically discarded when the session ends

The `createSessionKeyManager` handles creation and cleanup.

## Encrypted vault

All key material at rest is stored in an encrypted vault managed by
`createVault`. The vault uses the root key to encrypt operational and session
key material before persisting to disk.

## Platform detection

`detectPlatform()` probes the runtime environment and returns a
`PlatformCapability` describing available security features. This feeds into:
- `platformToTrustTier()` — maps capabilities to a `TrustTier` for attestations
- Key generation — chooses hardware-backed or software keys
- Vault encryption — selects appropriate cipher based on platform

## Key manager

`createKeyManager` is the central orchestrator. It initializes the root key,
manages operational and session key lifecycles, and provides the
`SignerProvider` and `AttestationSigner` interfaces that other packages consume.

Packages never interact with raw key material directly — they receive
signing/verification capabilities through the provider interfaces defined in
`@xmtp/signet-contracts`.

## Admin keys

Admin keys are a separate key type for authenticating CLI and admin socket
operations. They are **peers** to the root key, not derived from it.

### Purpose

- Authenticate CLI commands against the signet daemon
- Sign JWTs for admin socket JSON-RPC requests
- Separate management auth from message signing and harness session auth

### JWT flow

1. `createAdminKeyManager` generates or loads an admin key pair
2. CLI signs a JWT with the admin private key (`AdminJwtPayloadSchema`)
3. Admin socket validates the JWT signature before dispatching requests
4. `AdminAuthContext` on `HandlerContext` carries the verified admin identity

### Key types

- `AdminKeyRecord` — stored admin key with metadata
- `AdminJwtPayloadSchema` — JWT payload structure (issuer, expiry, etc.)
- `AdminJwtConfigSchema` — JWT signing config (algorithm, TTL)

### Utilities

`base64urlEncode` / `base64urlDecode` — JWT-safe encoding without padding.

The `KeyManager` exposes admin key management via its `.admin` property
(`AdminKeyManager`).
