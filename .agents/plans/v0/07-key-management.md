# 07-key-management

**Package:** `@xmtp-broker/keys`
**Spec version:** 0.1.0

## Overview

The key management package implements the three-tier key hierarchy that underpins the broker's security model. It provides hardware-backed signing through macOS Secure Enclave, encrypted secret storage (vault), and the `SignerProvider` interface consumed by `@xmtp-broker/core`.

The fundamental design principle: the broker can **invoke** signing operations without being able to **extract** the signing key. The Secure Enclave generates and holds the root key -- it is non-exportable by hardware design. Operational keys and session keys are derived from root-protected material, each with progressively weaker access policies that enable autonomous broker operation for routine tasks while gating privilege escalation behind biometric authentication.

The package bridges two cryptographic worlds. The Secure Enclave supports P-256 (secp256r1) exclusively. XMTP uses Ed25519 for inbox identity signatures. The bridge strategy: the enclave-backed P-256 root key protects an encrypted vault containing the Ed25519 operational key material. The enclave key never signs XMTP messages directly -- it authorizes access to the software keys that do. This gives us hardware-backed access control without fighting the enclave's algorithm constraints.

On platforms without Secure Enclave (Intel Macs, Linux), the package degrades to software key storage with Keychain or file-based encryption, and the attestation `trustTier` reflects the actual security posture.

## Dependencies

**Imports:**
- `@xmtp-broker/contracts` -- `SignerProvider`, `AttestationSigner` (canonical interface definitions)
- `@xmtp-broker/schemas` -- `TrustTier`, error classes (`InternalError`, `ValidationError`, `AuthError`, `NotFoundError`)
- `better-result` -- `Result` type
- `zod` -- config validation

**Imported by:**
- `@xmtp-broker/core` -- consumes `SignerProvider` for XMTP client creation
- `@xmtp-broker/sessions` -- requests session key issuance
- `@xmtp-broker/attestations` -- consumes `AttestationSigner` for signing attestations

## Public Interfaces

> **Note:** The `SignerProvider` and `AttestationSigner` interfaces are canonically defined in `@xmtp-broker/contracts`. This package implements both. The duplicate `SignerProvider` definition previously in this spec now references the contracts package as the source of truth.

### Configuration

```typescript
const KeyPolicySchema = z.enum([
  "biometric",
  "passcode",
  "open",
]).describe("Access control policy for a key tier");

type KeyPolicy = z.infer<typeof KeyPolicySchema>;

const PlatformCapability = z.enum([
  "secure-enclave",
  "keychain-software",
  "tpm",
  "software-vault",
]).describe("Actual hardware security capability detected");

type PlatformCapability = z.infer<typeof PlatformCapability>;

const KeyManagerConfigSchema = z.object({
  dataDir: z.string()
    .describe("Base directory for key storage"),
  rootKeyPolicy: KeyPolicySchema.default("biometric")
    .describe("Access policy for root key operations"),
  operationalKeyPolicy: KeyPolicySchema.default("open")
    .describe("Access policy for routine operations"),
  sessionKeyTtlSeconds: z.number().int().positive().default(3600)
    .describe("Default TTL for session keys"),
}).describe("Key manager configuration");

type KeyManagerConfig = z.infer<typeof KeyManagerConfigSchema>;
```

### Three-Tier Key Hierarchy

```typescript
interface RootKeyHandle {
  /** Opaque reference to the enclave key. Never contains raw key bytes. */
  readonly keyRef: string;
  /** P-256 public key, uncompressed hex (0x04...). */
  readonly publicKey: string;
  /** Access policy enforced by hardware. */
  readonly policy: KeyPolicy;
  /** Platform capability backing this key. */
  readonly platform: PlatformCapability;
  readonly createdAt: string;
}

interface OperationalKey {
  /** Unique identifier for this operational key. */
  readonly keyId: string;
  /** The agent identity this key belongs to. */
  readonly identityId: string;
  /** Group ID if per-group identity, null if shared. */
  readonly groupId: string | null;
  /** Ed25519 public key, hex-encoded. */
  readonly publicKey: string;
  /** SHA-256 fingerprint of the public key, hex-encoded. */
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly rotatedAt: string | null;
}

interface SessionKey {
  /** Unique identifier for this session key. */
  readonly keyId: string;
  /** Session ID this key is bound to. */
  readonly sessionId: string;
  /** SHA-256 fingerprint of the public key. */
  readonly fingerprint: string;
  /** When this key expires (matches session TTL). */
  readonly expiresAt: string;
  readonly createdAt: string;
}
```

### SignerProvider (consumed by broker-core)

> Canonical definition: `@xmtp-broker/contracts`. This package implements it via `KeyManager.toSignerProvider()`.

```typescript
// Imported from @xmtp-broker/contracts:
// interface SignerProvider {
//   getSigner(identityId: string): Promise<Result<Signer, InternalError>>;
//   getDbEncryptionKey(identityId: string): Promise<Result<Uint8Array, InternalError>>;
// }
```

### KeyManager

```typescript
interface KeyManager {
  /** Initialize key management: detect platform, create root key if needed. */
  initialize(): Promise<Result<RootKeyHandle, InternalError | AuthError>>;

  /** Get the current platform capability. */
  readonly platform: PlatformCapability;

  /** Get the trust tier based on platform capability. */
  readonly trustTier: TrustTier;

  // -- Operational key management --

  /** Create an operational key for an agent identity. Requires root key. */
  createOperationalKey(
    identityId: string,
    groupId: string | null,
  ): Promise<Result<OperationalKey, InternalError | AuthError>>;

  /** Get the operational key for an identity. */
  getOperationalKey(
    identityId: string,
  ): Result<OperationalKey, NotFoundError>;

  /** Look up operational key by group ID. */
  getOperationalKeyByGroupId(
    groupId: string,
  ): Result<OperationalKey, NotFoundError>;

  /** Rotate an operational key. Requires root key authorization. */
  rotateOperationalKey(
    identityId: string,
  ): Promise<Result<OperationalKey, InternalError | AuthError>>;

  /** List all operational keys. */
  listOperationalKeys(): readonly OperationalKey[];

  // -- Session key management --

  /** Issue a session key bound to a session ID. */
  issueSessionKey(
    sessionId: string,
    ttlSeconds: number,
  ): Promise<Result<SessionKey, InternalError>>;

  /** Zeroize a session key (on session revocation/expiry). */
  revokeSessionKey(
    keyId: string,
  ): Result<void, NotFoundError>;

  // -- Signing operations --

  /** Sign data with an operational key (Ed25519). */
  signWithOperationalKey(
    identityId: string,
    data: Uint8Array,
  ): Promise<Result<Uint8Array, InternalError | NotFoundError>>;

  /** Sign data with a session key. */
  signWithSessionKey(
    keyId: string,
    data: Uint8Array,
  ): Promise<Result<Uint8Array, InternalError | NotFoundError>>;

  // -- Vault --

  /** Store a secret in the encrypted vault. */
  vaultSet(
    name: string,
    value: Uint8Array,
  ): Promise<Result<void, InternalError>>;

  /** Retrieve a secret from the vault. */
  vaultGet(
    name: string,
  ): Promise<Result<Uint8Array, NotFoundError | InternalError>>;

  /** Remove a secret from the vault. */
  vaultDelete(name: string): Promise<Result<void, NotFoundError>>;

  /** List vault secret names (not values). */
  vaultList(): readonly string[];

  // -- SignerProvider factory --

  /** Create a SignerProvider for broker-core consumption. */
  toSignerProvider(): SignerProvider;
}

function createKeyManager(
  config: KeyManagerConfig,
): Promise<Result<KeyManager, InternalError>>;
```

### AttestationSigner Adapter

```typescript
import type { AttestationSigner, SignedAttestation } from
  "@xmtp-broker/contracts";

/** Creates an AttestationSigner backed by the key manager. */
function createAttestationSigner(
  keyManager: KeyManager,
  identityId: string,
): AttestationSigner;
```

## Zod Schemas

Key management config schemas are defined above (`KeyManagerConfigSchema`, `KeyPolicySchema`). The `TrustTier` schema is imported from `@xmtp-broker/schemas`.

Runtime key records (`RootKeyHandle`, `OperationalKey`, `SessionKey`) are plain TypeScript interfaces, not Zod schemas, because they are internal to the runtime tier.

## Behaviors

### Platform Detection and Initialization

```
initialize()
    |
    +--> Detect platform capability
    |    |
    |    +--> macOS + Apple Silicon: "secure-enclave"
    |    +--> macOS + Intel: "keychain-software"
    |    +--> Linux + TPM: "tpm" (deferred, maps to software-vault in v0)
    |    +--> Linux (no TPM): "software-vault"
    |
    +--> Check for existing root key in storage
    |    |
    |    +--> Found: load handle, return
    |    +--> Not found: create new root key
    |
    +--> Create root key (may trigger biometric prompt)
    |
    +--> Initialize vault with root key
    |
    +--> Return RootKeyHandle
```

### Trust Tier Mapping

| Platform | TrustTier |
|----------|-----------|
| `secure-enclave` | `source-verified` |
| `keychain-software` | `source-verified` (degraded label in logs) |
| `tpm` | `source-verified` |
| `software-vault` | `unverified` |

### Secure Enclave FFI: Swift CLI Subprocess

The recommended approach for Bun/TypeScript to call into macOS Secure Enclave is a **Swift CLI subprocess**. The broker ships a small Swift binary (`broker-signer`) that exposes Secure Enclave operations via JSON-over-stdio, following the same architectural pattern as keypo-cli.

**Why subprocess over native addon:**
- Secure Enclave requires Apple's CryptoKit framework, which is only accessible from Swift/Objective-C. A native addon (napi-rs, Bun FFI) would need to wrap Objective-C bridging into C, adding fragile build complexity.
- The subprocess model is proven: keypo-cli uses it in production. The latency overhead (~5-15ms per call) is acceptable because root key operations are infrequent (initialization, rotation, privilege escalation).
- The subprocess boundary provides natural process isolation -- a crash in the signer does not bring down the broker.
- Build tooling stays simple: `swift build` for the signer, `bun build` for the broker, no cross-language linking.

**Protocol:** The broker spawns `broker-signer <command> [args]` and reads JSON from stdout. Commands:

| Command | Purpose | Triggers biometric |
|---------|---------|-------------------|
| `create --policy <policy>` | Generate root P-256 key in enclave | If policy is biometric |
| `sign --key-ref <ref> --data <hex>` | Sign with enclave key | Per key policy |
| `encrypt --public-key <hex> --data <hex>` | ECIES encrypt for vault | No |
| `decrypt --key-ref <ref> --data <json>` | ECIES decrypt from vault | Per key policy |
| `info` | Platform detection, enclave availability | No |
| `delete --key-ref <ref>` | Remove enclave key | No |

### P-256 to Ed25519 Bridge

The Secure Enclave only supports P-256. XMTP requires Ed25519 (for `@xmtp/node-sdk` Signer interface). The bridge:

```
Root Key (P-256, in Secure Enclave)
    |
    | protects (ECIES encrypt/decrypt)
    v
Encrypted Vault (on disk)
    |
    | contains
    v
Ed25519 Operational Key Material (software, in vault)
    |
    | used for
    v
XMTP Signer (Ed25519 signatures)
```

1. When `createOperationalKey()` is called, the key manager generates Ed25519 key material in memory using `@noble/ed25519` or equivalent.
2. The private key bytes are encrypted via the Swift subprocess (`encrypt` command) using the root key's P-256 public key for ECIES.
3. The encrypted blob is stored on disk in the vault file.
4. When `signWithOperationalKey()` is called, the encrypted key is decrypted via the Swift subprocess (`decrypt` command), the Ed25519 signature is computed in-process, and the plaintext key is zeroized immediately.
5. For the `SignerProvider.getSigner()` interface, the key manager returns a `Signer` that internally calls through this decrypt-sign-zeroize flow.

### Biometric Gating Rules

**Root key operations (biometric/passcode required):**

| Operation | Why |
|-----------|-----|
| Initial inbox creation | Creates a new identity anchor |
| Privilege escalation (material grant change) | Crosses security boundary |
| Key rotation | Changes signing material |
| New operational key creation | Authorizes new agent identity |
| Grant escalation beyond current scope | Maps to session materiality |
| Vault secret access (first access per session) | Unlocks encrypted material |

**Operational key operations (no biometric):**

| Operation | Why |
|-----------|-----|
| Message signing | Routine, high-frequency |
| Attestation publishing | Routine, tied to session lifecycle |
| Session key issuance | Bounded by existing grants |
| Heartbeat signing | Background liveness |

**Session key operations (harness-scoped):**

| Operation | Why |
|-----------|-----|
| Request signing within grant scope | Session-bounded |
| Heartbeat from harness | Liveness only |

This maps directly to the materiality boundary from 05-sessions.md: non-material operations use operational keys; material changes require root key authorization (biometric).

### Encrypted Vault

The vault stores secrets encrypted at rest using ECIES with the root key:

```
Vault File: {dataDir}/vault.json
{
  "version": 1,
  "rootKeyRef": "<base64 opaque SE key reference>",
  "rootPublicKey": "<hex P-256 public key>",
  "secrets": {
    "op-key:<identityId>": { <EncryptedBlob> },
    "db-key:<identityId>": { <EncryptedBlob> },
    "api-cred:openai": { <EncryptedBlob> },
    ...
  }
}
```

**EncryptedBlob** follows the ECIES pattern from keypo-cli:
- `ephemeralPublicKey`: P-256 public key used for ECDH (hex)
- `nonce`: 12 bytes (base64)
- `ciphertext`: AES-256-GCM encrypted data (base64)
- `tag`: 16 bytes GCM auth tag (base64)
- `createdAt`, `updatedAt`: ISO 8601 timestamps

**What goes in the vault:**
- Ed25519 operational key material (per identity)
- Database encryption keys (32 bytes per identity)
- API credentials for inference providers
- Webhook tokens
- Configuration secrets

**What never goes in the vault:**
- Root key material (lives in Secure Enclave, non-exportable)
- Session keys (ephemeral, in-memory only)
- Plaintext of any secret (only ciphertext on disk)

### Key Rotation

**Machine migration** (new hardware):

```
New Machine
    |
    +--> User enrolls biometrics
    |
    +--> Broker creates new root key in new enclave
    |
    +--> User transfers encrypted vault file to new machine
    |    (vault is useless without the old root key)
    |
    +--> Broker generates new operational keys under new root
    |
    +--> Broker performs XMTP installation rotation
    |    (inbox persists, signing key material rotates)
    |
    +--> Broker publishes updated attestation
    |
    +--> Old machine's root key is abandoned (non-exportable,
    |    hardware-bound, automatically inaccessible)
```

No seed phrases. No recovery keys. Identity continuity is through XMTP's installation management, not key portability.

**Periodic operational key rotation:**

```
rotateOperationalKey(identityId)
    |
    +--> Requires root key authorization (biometric)
    |
    +--> Generate new Ed25519 key pair
    |
    +--> Encrypt new private key to vault
    |
    +--> Update operational key record (new publicKey, fingerprint)
    |
    +--> Mark old key as rotated (rotatedAt = now)
    |
    +--> Existing sessions continue with current session keys
    |    (they don't use operational key directly)
    |
    +--> New sessions use the new operational key
    |
    +--> Trigger attestation update (material change)
```

### Per-Group Identity Key Management

Each group identity (from `@xmtp-broker/core` per-group mode) gets:
- Its own Ed25519 operational key stored in the vault as `op-key:<identityId>`
- Its own database encryption key stored as `db-key:<identityId>`
- Both protected by the single root key

The root key authorizes creation of new group identities via `createOperationalKey()`.

```
Root Key (1, in Secure Enclave)
    |
    +--> Operational Key for Group A (Ed25519, in vault)
    +--> Operational Key for Group B (Ed25519, in vault)
    +--> Operational Key for Group C (Ed25519, in vault)
    +--> DB Key for Group A (AES-256, in vault)
    +--> DB Key for Group B (AES-256, in vault)
    +--> DB Key for Group C (AES-256, in vault)
```

### Coordinating Agent Pattern

```
Human Owner (biometric)
    |
    +--> Root Key (Secure Enclave)
         |
         +--> Coordinating Agent
         |    (operational key, broad view/grant)
         |    |
         |    +--> Task Agent A
         |    |    (operational key, scoped grant)
         |    |
         |    +--> Task Agent B
         |         (operational key, scoped grant)
         |
         +--> createOperationalKey() requires root key
              (biometric prompt for each new agent)
```

The coordinating agent can request new task agents, but each creation requires root key authorization. Task agents operate autonomously within their grants. Escalation beyond granted scope bubbles up through the session materiality boundary, ultimately requiring biometric confirmation.

### Platform Degradation

```
detectPlatform()
    |
    +--> Check SecureEnclave.isAvailable (via broker-signer info)
    |    |
    |    +--> true: PlatformCapability = "secure-enclave"
    |    |         Root key in enclave, full hardware protection.
    |    |
    |    +--> false (macOS): PlatformCapability = "keychain-software"
    |    |         Root key in Keychain, software-protected.
    |    |         Biometric policy maps to Keychain ACL.
    |    |         Log warning: "Running without Secure Enclave.
    |    |         Key material is software-protected."
    |    |
    |    +--> false (Linux): PlatformCapability = "software-vault"
    |              Root key is Ed25519, encrypted with passphrase.
    |              No hardware protection.
    |              Log warning: "No hardware key storage. Keys are
    |              software-protected only."
    |
    +--> Set trustTier based on platform
    |
    +--> Attestation includes actual platform in metadata
```

All three paths implement the same `KeyManager` interface. The `SignerProvider` returned by `toSignerProvider()` behaves identically regardless of platform. The difference is only in the security guarantees, reflected in `trustTier` and logged at startup.

### Session Key Lifecycle

```
issueSessionKey(sessionId, ttlSeconds)
    |
    +--> Generate Ed25519 key pair in memory
    |
    +--> Compute fingerprint = SHA-256(publicKey)
    |
    +--> Store in ephemeral in-memory map
    |    (never written to disk or vault)
    |
    +--> Return SessionKey record
    |
    ... session active ...
    |
revokeSessionKey(keyId)
    |
    +--> Zeroize private key bytes
    |
    +--> Remove from in-memory map
```

Session keys are never persisted. Broker restart invalidates all session keys, which is correct -- sessions are also in-memory (per 05-sessions.md).

## Error Cases

| Scenario | Error | Category |
|----------|-------|----------|
| Secure Enclave unavailable on expected platform | `InternalError` | internal |
| Biometric authentication cancelled | `AuthError` | auth |
| Biometric authentication failed | `AuthError` | auth |
| Swift subprocess crashed or timed out | `InternalError` | internal |
| Vault file corrupted (HMAC mismatch) | `InternalError` | internal |
| Operational key not found for identity | `NotFoundError` | not_found |
| Session key not found (expired/revoked) | `NotFoundError` | not_found |
| Vault secret not found | `NotFoundError` | not_found |
| Config validation fails | `ValidationError` | validation |
| Key rotation without root authorization | `AuthError` | auth |

The Swift subprocess has a 30-second timeout. If biometric is pending, the OS controls the prompt -- the broker waits. If the subprocess crashes, `InternalError` with the stderr output in `context`.

## Open Questions Resolved

**Q: How should the broker interact with Secure Enclave from Bun/TypeScript?** (PRD: "implement its own purpose-built key management layer")
**A:** Swift CLI subprocess (`broker-signer`) with JSON-over-stdio protocol. Rationale: CryptoKit is only accessible from Swift. The subprocess model is proven by keypo-cli, adds ~10ms latency per call (acceptable for infrequent root key operations), provides process isolation, and keeps build tooling simple. Native addons (napi-rs, Bun FFI) would require fragile Objective-C bridging into C and introduce build-time platform coupling.

**Q: How does P-256 (Secure Enclave) bridge to Ed25519 (XMTP)?** (PRD: "design the bridge")
**A:** The enclave P-256 key protects the vault; the vault holds Ed25519 operational keys. The enclave key never signs XMTP messages directly. This avoids algorithm conversion complexity and leverages the enclave for what it does best: access control and encryption. The Ed25519 keys are standard software keys whose material is encrypted at rest.

**Q: Per-group identity -- how do per-group keys interact with the hierarchy?** (PLAN.md)
**A:** Each group identity gets its own Ed25519 operational key and database encryption key, all stored in the vault under the single root key. The root key is the authority for all group identities. Creating a new group identity requires root key authorization (biometric). This scales linearly with group count but keeps the trust anchor singular.

**Q: What happens on platforms without Secure Enclave?** (PRD: "degrade gracefully with clear labeling")
**A:** The `KeyManager` interface is platform-agnostic. On Intel Macs, Keychain with software keys. On Linux, passphrase-encrypted file storage. The `trustTier` in attestations reflects the actual security posture (`source-verified` vs `unverified`). The broker logs a warning at startup.

## Deferred

- **TPM integration on Linux**: v0 maps Linux to `software-vault`. Real TPM support (via `tpm2-tss` or similar) is post-v0.
- **Hosted/TEE key management**: TEE-backed keys for hosted brokers are Phase 2. The `PlatformCapability` enum includes the extension point.
- **Key escrow or social recovery**: No recovery mechanism in v0. Machine migration requires creating new keys and rotating XMTP installations.
- **Hardware Security Module (HSM) support**: Enterprise key storage is post-v0.
- **Operational key caching**: v0 decrypts from vault on every sign operation. An in-memory cache with TTL is a performance optimization for post-v0.
- **Multi-root-key support**: v0 uses a single root key. Support for multiple root keys (e.g., backup enclave key) is deferred.
- **broker-signer binary distribution**: v0 assumes the Swift binary is built locally. Prebuilt binary distribution (Homebrew, embedded in npm package) is deferred.

## Testing Strategy

### What to Test

1. **Platform detection** -- Mock subprocess responses for `info` command. Verify correct `PlatformCapability` and `trustTier` mapping.
2. **Operational key lifecycle** -- Create, retrieve by identity ID, retrieve by group ID, rotate, list.
3. **Session key lifecycle** -- Issue, sign, revoke, verify zeroization.
4. **SignerProvider contract** -- `getSigner()` returns a valid XMTP `Signer`. `getDbEncryptionKey()` returns 32 bytes.
5. **Vault CRUD** -- Set, get, delete, list secrets. Verify encrypted-at-rest (read raw file, confirm not plaintext).
6. **Biometric gating** -- Operations that require root key return `AuthError` when biometric is unavailable/cancelled (mocked).
7. **Key rotation** -- New key replaces old, attestation trigger signaled, existing sessions unaffected.
8. **Platform degradation** -- Software fallback produces correct `trustTier` and logs warnings.
9. **Subprocess error handling** -- Timeout, crash, invalid JSON all produce `InternalError`.
10. **AttestationSigner adapter** -- Produces valid `SignedAttestation` with correct `signerKeyRef`.

### How to Test

**Unit tests** (most tests): Mock the Swift subprocess with a test double that returns canned JSON responses. All key operations except actual Secure Enclave interaction are testable without hardware. The vault can be tested with a software-only encryption backend.

**Integration tests** (few, require macOS + Apple Silicon): End-to-end tests that spawn the real `broker-signer` binary and interact with the Secure Enclave. These use `open` policy keys (no biometric prompt) and are gated by CI platform detection.

### Key Test Scenarios

```typescript
// Platform detection
const manager = await createKeyManager({ dataDir: tmpDir });
expect(manager.platform).toBe("secure-enclave"); // or mocked

// Operational key creation and signing
const opKey = await manager.createOperationalKey("id-1", "group-a");
expect(opKey.ok).toBe(true);
const sig = await manager.signWithOperationalKey(
  "id-1",
  new Uint8Array([1, 2, 3]),
);
expect(sig.ok).toBe(true);

// Session key lifecycle
const sessKey = await manager.issueSessionKey("ses_abc", 3600);
expect(sessKey.ok).toBe(true);
const revoke = manager.revokeSessionKey(sessKey.value.keyId);
expect(revoke.ok).toBe(true);
// Signing after revoke fails
const sig2 = await manager.signWithSessionKey(
  sessKey.value.keyId,
  new Uint8Array([1]),
);
expect(sig2.ok).toBe(false);

// SignerProvider contract
const provider = manager.toSignerProvider();
const signer = await provider.getSigner("id-1");
expect(signer.ok).toBe(true);
const dbKey = await provider.getDbEncryptionKey("id-1");
expect(dbKey.ok).toBe(true);
expect(dbKey.value).toHaveLength(32);

// Vault operations
await manager.vaultSet("api-key", encoder.encode("sk-test"));
const val = await manager.vaultGet("api-key");
expect(decoder.decode(val.value)).toBe("sk-test");

// Biometric cancellation
mockSubprocess.nextResponse = { error: "authentication cancelled" };
const result = await manager.createOperationalKey("id-2", null);
expect(result.ok).toBe(false);
expect(result.error._tag).toBe("AuthError");
```

### Test Utilities

```typescript
/** Create a KeyManager with a mock subprocess backend. */
function createTestKeyManager(
  overrides?: Partial<KeyManagerConfig>,
): Promise<{ manager: KeyManager; subprocess: MockSubprocess }>;

/** Mock subprocess that returns canned JSON responses. */
interface MockSubprocess {
  nextResponse: unknown;
  calls: readonly { command: string; args: readonly string[] }[];
}

/** Create a software-only KeyManager (no enclave). */
function createSoftwareKeyManager(
  config: KeyManagerConfig,
): Promise<KeyManager>;
```

## File Layout

```
packages/keys/
  package.json
  tsconfig.json
  src/
    index.ts                    # Re-exports public API
    config.ts                   # KeyManagerConfigSchema, KeyPolicySchema, PlatformCapability
    key-manager.ts              # KeyManager interface and createKeyManager factory
    signer-provider.ts          # SignerProvider implementation (toSignerProvider)
    attestation-signer.ts       # createAttestationSigner adapter
    root-key.ts                 # RootKeyHandle, root key initialization
    operational-key.ts          # OperationalKey, create/rotate/lookup
    session-key.ts              # SessionKey, issue/revoke, in-memory store
    vault.ts                    # Encrypted vault read/write, ECIES via subprocess
    platform.ts                 # Platform detection, trust tier mapping
    subprocess.ts               # Swift CLI subprocess spawning, JSON parsing
    __tests__/
      key-manager.test.ts       # Full lifecycle tests
      signer-provider.test.ts   # SignerProvider contract tests
      operational-key.test.ts   # Operational key CRUD + rotation
      session-key.test.ts       # Session key lifecycle + zeroization
      vault.test.ts             # Vault CRUD + encryption verification
      platform.test.ts          # Platform detection + degradation
      subprocess.test.ts        # Subprocess protocol, error handling
      fixtures.ts               # Test utilities, mock subprocess
```

Each source file targets under 200 LOC. The `key-manager.ts` file orchestrates the tiers but delegates to `root-key.ts`, `operational-key.ts`, `session-key.ts`, and `vault.ts` for actual logic.
