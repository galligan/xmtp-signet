# 12-admin-keys

**Package:** `@xmtp-broker/keys`
**Spec version:** 0.1.0

## Overview

Admin keys provide a separate authentication path for broker administration, distinct from the inbox key hierarchy that handles XMTP messaging. The separation enforces a critical security boundary: an operator who can start the daemon, issue sessions, revoke grants, and rotate keys cannot read messages or impersonate agents. Think of it like a database administrator who manages permissions and backups but cannot see application data.

The admin key is an Ed25519 key pair stored in the existing vault alongside (but separate from) operational keys. It is created during `identity init` as a peer to the inbox key hierarchy, not a child of it. Admin authentication uses short-lived JWTs signed by the admin private key. The daemon validates these JWTs on its Unix socket admin interface.

The admin key JWT is the sole authentication mechanism in v0. Peer credential auth (Unix socket UID matching) is deferred to post-v0 as a convenience optimization.

```
Root Key (hardware-bound or encrypted at rest)
  +-- Operational Key (Ed25519, per-identity or per-group)
  +-- Session Key (ephemeral, in-memory)

Admin Key (Ed25519, in vault)  <-- THIS SPEC
  +-- Daemon lifecycle commands
  +-- Session/grant management
  +-- Key rotation triggers
  +-- State inspection
```

## Dependencies

**Imports:**
- `@xmtp-broker/schemas` -- `BrokerError`, `InternalError`, `AuthError`, `ValidationError`, `NotFoundError`
- `better-result` -- `Result`
- `zod` -- JWT payload validation

**Internal imports (same package):**
- `./vault.js` -- `Vault` (encrypted storage for admin key material)
- `./crypto-keys.js` -- Ed25519 key generation and signing primitives
- `./config.js` -- `KeyManagerConfig` (for data directory)

**Imported by:**
- `@xmtp-broker/keys` -- `KeyManager` exposes admin key operations alongside inbox key operations
- Future `@xmtp-broker/daemon` -- validates admin JWTs on the Unix socket
- Future `@xmtp-broker/cli` -- generates admin JWTs for CLI-to-daemon requests

## Public Interfaces

### Admin Key Record

```typescript
/** An Ed25519 admin key pair managed by the vault. */
interface AdminKeyRecord {
  /** Unique key identifier (vault storage key). */
  readonly keyId: string;
  /** Ed25519 public key, hex-encoded. */
  readonly publicKey: string;
  /** SHA-256 fingerprint of the public key, hex-encoded. */
  readonly fingerprint: string;
  /** When this admin key was created. */
  readonly createdAt: string;
  /** When this key was rotated (null if never). */
  readonly rotatedAt: string | null;
}
```

### Admin JWT Payload

```typescript
const AdminJwtPayloadSchema = z.object({
  /** JWT issuer: the admin key fingerprint. */
  iss: z.string()
    .describe("Admin key fingerprint"),
  /** JWT subject: fixed to 'admin'. */
  sub: z.literal("admin")
    .describe("Subject claim"),
  /** JWT issued-at: Unix timestamp in seconds. */
  iat: z.number().int().positive()
    .describe("Issued-at timestamp"),
  /** JWT expiration: Unix timestamp in seconds. */
  exp: z.number().int().positive()
    .describe("Expiration timestamp"),
  /** Random nonce to prevent replay. */
  jti: z.string()
    .describe("JWT ID (random nonce, hex-encoded, 16 bytes)"),
}).describe("Admin JWT payload claims");

type AdminJwtPayload = z.infer<typeof AdminJwtPayloadSchema>;
```

### Admin Auth Context

```typescript
/**
 * Authentication context attached to admin-authenticated requests.
 * Handlers that require admin auth receive this in their context.
 */
interface AdminAuthContext {
  /** How the admin was authenticated. */
  readonly authMethod: AdminAuthMethod;
  /** Admin key fingerprint. */
  readonly adminFingerprint: string;
  /** When the auth token expires. */
  readonly expiresAt: string;
}

type AdminAuthMethod = "jwt";
```

### Admin Key Manager

```typescript
interface AdminKeyManager {
  /**
   * Create a new admin key pair and store it in the vault.
   * Returns error if an admin key already exists (use rotate instead).
   */
  create(): Promise<Result<AdminKeyRecord, InternalError>>;

  /**
   * Get the current admin key record.
   * Returns NotFoundError if no admin key has been created.
   */
  get(): Promise<Result<AdminKeyRecord, NotFoundError | InternalError>>;

  /**
   * Check whether an admin key exists without loading full record.
   */
  exists(): boolean;

  /**
   * Rotate the admin key: generate a new key pair, replace in vault.
   * The old key immediately becomes invalid for JWT verification.
   */
  rotate(): Promise<Result<AdminKeyRecord, InternalError | NotFoundError>>;

  /**
   * Sign an admin JWT with the current admin key.
   * The JWT has a short TTL (default: 2 minutes).
   */
  signJwt(
    options?: AdminJwtOptions,
  ): Promise<Result<string, InternalError | NotFoundError>>;

  /**
   * Verify an admin JWT. Checks signature, expiration, and claims.
   * Returns the validated payload on success.
   */
  verifyJwt(
    token: string,
  ): Promise<Result<AdminJwtPayload, AuthError | ValidationError>>;

  /**
   * Export the admin public key for out-of-band distribution.
   * Returns the hex-encoded Ed25519 public key.
   */
  exportPublicKey(): Promise<Result<string, NotFoundError | InternalError>>;
}

interface AdminJwtOptions {
  /** JWT TTL in seconds. Default: 120 (2 minutes). */
  readonly ttlSeconds?: number;
}

function createAdminKeyManager(
  vault: Vault,
): AdminKeyManager;
```

### KeyManager Integration

The existing `KeyManager` interface (from `key-manager.ts`) is extended with admin key operations:

```typescript
// Added to the existing KeyManager interface:
interface KeyManager {
  // ... existing methods ...

  /** Access admin key operations. */
  readonly admin: AdminKeyManager;
}
```

The `admin` property is a namespace that groups admin key operations separately from inbox key operations. This keeps the admin/inbox boundary visible in the API surface.

## Zod Schemas

### JWT Payload Schema

```typescript
const AdminJwtPayloadSchema = z.object({
  iss: z.string().describe("Admin key fingerprint"),
  sub: z.literal("admin").describe("Subject claim"),
  iat: z.number().int().positive().describe("Issued-at timestamp"),
  exp: z.number().int().positive().describe("Expiration timestamp"),
  jti: z.string().describe("JWT ID (random nonce, hex-encoded, 16 bytes)"),
}).describe("Admin JWT payload claims");
```

### Admin Key Config Schema

```typescript
const AdminJwtConfigSchema = z.object({
  defaultTtlSeconds: z.number().int().positive().default(120)
    .describe("Default JWT TTL in seconds (2 minutes)"),
  maxTtlSeconds: z.number().int().positive().default(3600)
    .describe("Maximum JWT TTL in seconds (1 hour)"),
  clockSkewSeconds: z.number().int().nonnegative().default(30)
    .describe("Allowed clock skew for JWT verification"),
}).describe("Admin JWT configuration");

type AdminJwtConfig = z.infer<typeof AdminJwtConfigSchema>;
```

## Behaviors

### Admin Key Creation (During `identity init`)

```
identity init
    |
    +--> KeyManager.initialize() (existing -- creates root key)
    |
    +--> KeyManager.createOperationalKey() (existing -- creates inbox key)
    |
    +--> KeyManager.admin.create() (NEW)
    |       |
    |       +--> Generate Ed25519 key pair
    |       |       (using existing crypto-keys.ts primitives)
    |       |
    |       +--> Compute fingerprint = SHA-256(publicKey)
    |       |
    |       +--> Store private key in vault as "admin-key:private"
    |       |
    |       +--> Store public key in vault as "admin-key:public"
    |       |
    |       +--> Store metadata in vault as "admin-key:meta"
    |       |       (JSON: keyId, fingerprint, createdAt, rotatedAt)
    |       |
    |       +--> Return AdminKeyRecord
    |
    +--> Print admin key fingerprint to stdout
         (operator records this for verification)
```

The admin key is created alongside the inbox key hierarchy but is not derived from it. The root key protects both the admin key and operational keys through the vault's encryption, but the admin key has no cryptographic relationship to the inbox keys.

### JWT Generation

```
admin.signJwt({ ttlSeconds: 300 })
    |
    +--> Load admin private key from vault ("admin-key:private")
    |
    +--> Load admin key fingerprint from vault ("admin-key:meta")
    |
    +--> Build payload:
    |      {
    |        iss: fingerprint,
    |        sub: "admin",
    |        iat: Math.floor(Date.now() / 1000),
    |        exp: iat + ttlSeconds,
    |        jti: randomHex(16),
    |      }
    |
    +--> Encode header: { alg: "EdDSA", typ: "JWT" }
    |
    +--> Encode: base64url(header) + "." + base64url(payload)
    |
    +--> Sign with Ed25519 private key
    |
    +--> Return: header.payload.signature (compact JWT)
```

The JWT format is a minimal three-part compact JWT with EdDSA (Ed25519) signatures. No external JWT library is used -- the implementation is ~60 LOC using `crypto.subtle` for signing and base64url encoding. This avoids adding a dependency for a straightforward operation.

### JWT Verification

```
admin.verifyJwt(token)
    |
    +--> Split token into [header, payload, signature]
    |
    +--> Decode header, verify alg === "EdDSA"
    |
    +--> Decode payload, validate against AdminJwtPayloadSchema
    |
    +--> Check sub === "admin"
    |
    +--> Check exp > now - clockSkewSeconds
    |      If expired: return AuthError("admin token expired")
    |
    +--> Check iat <= now + clockSkewSeconds
    |      If future: return ValidationError("token issued in future")
    |
    +--> Load admin public key from vault ("admin-key:public")
    |
    +--> Verify Ed25519 signature over header.payload
    |      If invalid: return AuthError("invalid admin token signature")
    |
    +--> Check iss matches stored fingerprint
    |      If mismatch: return AuthError("admin key fingerprint mismatch")
    |
    +--> Return AdminJwtPayload
```

### Admin Key Rotation

```
admin.rotate()
    |
    +--> Load existing admin key metadata from vault
    |      If not found: return NotFoundError
    |
    +--> Generate new Ed25519 key pair
    |
    +--> Compute new fingerprint
    |
    +--> Replace vault entries:
    |      "admin-key:private" -> new private key
    |      "admin-key:public" -> new public key
    |      "admin-key:meta" -> updated metadata with rotatedAt
    |
    +--> Return new AdminKeyRecord
    |
    Note: All outstanding JWTs signed with the old key immediately
    become invalid because verifyJwt() checks the fingerprint
    against the current stored key. This is intentional -- rotation
    is a security operation that should invalidate all existing tokens.
```

### Admin Auth Flow (CLI -> Daemon)

```
CLI (operator)                     Daemon (Unix socket)
    |                                    |
    |  1. Load admin key from vault     |
    |  2. admin.signJwt()               |
    |                                    |
    |--- Connect to admin.sock --------->|
    |--- Send: { auth: "<jwt>" } ------->|
    |                                    |  3. admin.verifyJwt(jwt)
    |                                    |
    |<-- { ok: true, auth: ctx } --------|  4. Attach AdminAuthContext
    |                                    |
    |--- Send: { command: "..." } ------>|  5. Handler checks ctx.admin
    |<-- { result: ... } <---------------|
    |                                    |
```

The daemon requires a valid admin JWT in every request. The CLI generates a fresh JWT for each command using the admin private key from the vault.

### Vault Storage Layout

Admin key material is stored alongside inbox key material in the same vault, differentiated by key prefix:

```
Vault contents:
  "admin-key:private"   -> Ed25519 private key (32 bytes)
  "admin-key:public"    -> Ed25519 public key (32 bytes)
  "admin-key:meta"      -> JSON metadata (AdminKeyRecord fields)
  "op-key:<identityId>" -> Ed25519 operational private key
  "db-key:<identityId>" -> AES-256 database encryption key
  ...
```

The `admin-key:` prefix namespace ensures admin keys never collide with inbox key entries. All entries are encrypted at rest by the vault's AES-GCM encryption using the vault key.

### JWT Format Details

The admin JWT is a standard compact JWT with minimal claims:

**Header:**
```json
{ "alg": "EdDSA", "typ": "JWT" }
```

**Payload:**
```json
{
  "iss": "a1b2c3d4e5f6...",
  "sub": "admin",
  "iat": 1741900800,
  "exp": 1741901100,
  "jti": "f0e1d2c3b4a59687"
}
```

**Signature:** Ed25519 over `base64url(header).base64url(payload)`.

The JWT is intentionally minimal:
- No `aud` claim -- the only audience is the local daemon.
- No `scope` or `permissions` claims -- all admin JWTs carry full admin privileges. Scoped admin access is deferred.
- Short default TTL (2 minutes) limits the blast radius of a leaked token.
- The `jti` nonce prevents replay if combined with a nonce cache (nonce tracking is deferred; the short TTL provides sufficient protection for v0).

### Base64url Implementation

The JWT implementation uses Web Crypto-compatible base64url encoding:

```typescript
function base64urlEncode(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
```

No external base64 library. These are ~5 LOC each and avoid a dependency for a trivial operation.

## Error Cases

| Scenario | Error | Category |
|----------|-------|----------|
| `create()` when admin key already exists | `InternalError` | internal |
| `get()` when no admin key exists | `NotFoundError` | not_found |
| `rotate()` when no admin key exists | `NotFoundError` | not_found |
| `signJwt()` when no admin key exists | `NotFoundError` | not_found |
| `signJwt()` with TTL exceeding max | `ValidationError` | validation |
| `verifyJwt()` with expired token | `AuthError` | auth |
| `verifyJwt()` with invalid signature | `AuthError` | auth |
| `verifyJwt()` with wrong fingerprint (rotated key) | `AuthError` | auth |
| `verifyJwt()` with malformed JWT (not 3 parts) | `ValidationError` | validation |
| `verifyJwt()` with invalid payload schema | `ValidationError` | validation |
| `verifyJwt()` with future `iat` (clock skew exceeded) | `ValidationError` | validation |
| Vault read/write failure during key operations | `InternalError` | internal |

## Open Questions Resolved

**Q: Should admin auth use JWTs or a simpler challenge-response protocol?**
**A:** JWTs. They are self-contained (the daemon can verify without state lookup), have standardized expiration semantics, and the EdDSA algorithm aligns with the existing Ed25519 key infrastructure. A challenge-response protocol would require the daemon to maintain state between the challenge and response steps, adding complexity. The JWT's `jti` nonce provides replay protection without server-side state.

**Q: Does Bun's Unix socket support expose peer credentials?**
**A:** Deferred. Bun's `Bun.listen({ unix })` does not natively expose peer credentials. A `bun:ffi` approach is possible but adds platform-specific native code complexity. v0 uses admin key JWT as the sole auth mechanism. Peer credential auth is a post-v0 convenience optimization.

**Q: Should the admin key be derived from the root key or independent?**
**A:** Independent. The admin key has no cryptographic relationship to the inbox key hierarchy. It is stored in the same vault (encrypted by the same vault key), but it is a standalone Ed25519 key pair. Derivation from the root key would create a dependency path where compromising the root key also compromises admin auth, violating the separation principle. Independence means the admin key can be rotated without affecting inbox keys, and vice versa.

**Q: What is the admin JWT TTL?**
**A:** Default 2 minutes, maximum 1 hour, configurable via `AdminJwtOptions.ttlSeconds`. Short TTLs limit exposure from leaked tokens. The CLI generates a fresh JWT for each command, so short TTLs impose no usability burden. The maximum prevents accidentally issuing long-lived tokens.

**Q: Should admin JWTs include scope/permission claims?**
**A:** Not in v0. All admin JWTs carry full admin privileges. Scoped admin access (e.g., "can list sessions but not revoke") is a post-v0 concern that requires defining an admin permission model. For v0, the admin is a single operator with full control.

**Q: How does peer credential auth interact with admin key rotation?**
**A:** Deferred. Peer credential auth is not implemented in v0. When added post-v0, it will bypass the admin key entirely (checking OS-level UIDs) so rotation will not affect it.

## Deferred

- **Nonce tracking for replay prevention.** v0 relies on short JWT TTLs (2 minutes) for replay protection. A server-side nonce cache (tracking `jti` values to reject reuse) is a post-v0 hardening measure.
- **Scoped admin permissions.** All admin JWTs carry full admin privileges. Fine-grained admin scopes (e.g., read-only inspection vs. session revocation) require an admin permission model that is not designed in v0.
- **Remote admin authentication.** v0 admin auth works over local Unix sockets only. TLS-wrapped TCP sockets for remote administration are a separate transport concern, deferred to when the daemon transport spec is written.
- **Admin key backup and recovery.** If the admin key is lost (vault corrupted, machine destroyed), there is no recovery path in v0. A new admin key must be created, which is acceptable because admin keys do not protect message history or XMTP identity -- they only gate broker administration.
- **Multi-admin support.** v0 supports a single admin key. Multiple admin keys (for team administration) require a permission model and key revocation list, both deferred.
- **Admin audit log persistence.** Admin operations should be logged for accountability. The audit trail format and persistence mechanism are deferred. v0 logs admin operations to stdout/stderr.
- **Peer credential auth (LOCAL_PEERCRED / SO_PEERCRED).** Zero-config local auth via Unix socket UID matching. Requires platform-specific FFI (Bun does not expose peer credentials natively). Deferred as a convenience optimization -- admin key JWT is the required auth mechanism.
- **Windows peer credential support.** N/A while peer credentials are deferred.

## Testing Strategy

### What to Test

1. **Admin key lifecycle** -- Create, get, exists, rotate. Verify vault storage. Verify rotate invalidates old key.
2. **JWT generation** -- Generated JWTs have correct header, valid payload, verifiable signature.
3. **JWT verification** -- Valid tokens pass. Expired tokens fail with `AuthError`. Bad signatures fail. Malformed tokens fail with `ValidationError`. Wrong fingerprint (post-rotation) fails.
4. **Clock skew tolerance** -- Tokens within `clockSkewSeconds` of expiration still verify. Tokens beyond tolerance fail.
5. **Nonce uniqueness** -- Each `signJwt()` call produces a unique `jti`.
6. **TTL enforcement** -- TTL exceeding `maxTtlSeconds` is rejected.
7. **KeyManager integration** -- `manager.admin.create()`, `manager.admin.signJwt()`, `manager.admin.verifyJwt()` work through the KeyManager facade.
9. **Vault isolation** -- Admin key entries use the `admin-key:` prefix and do not collide with inbox key entries.
10. **Base64url encoding** -- Round-trip encoding/decoding preserves data. Edge cases: empty data, data with all byte values.

### How to Test

**Unit tests** (majority): The `AdminKeyManager` takes a `Vault` dependency, which is easily tested using the existing in-memory vault (`:memory:` data dir). JWT generation and verification are pure cryptographic operations testable without any external dependencies.

**Peer credential tests**: Mock the FFI layer. The `PeerCredentialVerifier` is tested by injecting a mock `getsockopt` implementation that returns canned `xucred`/`ucred` structures. Platform detection is tested by mocking the FFI initialization path.

### Key Test Scenarios

```typescript
// Admin key creation
const vault = await createTestVault();
const admin = createAdminKeyManager(vault);
const keyResult = await admin.create();
expect(Result.isOk(keyResult)).toBe(true);
expect(keyResult.value.publicKey).toHaveLength(64); // 32 bytes hex
expect(keyResult.value.fingerprint).toHaveLength(64); // SHA-256 hex

// Duplicate creation fails
const dupResult = await admin.create();
expect(Result.isError(dupResult)).toBe(true);
expect(dupResult.error._tag).toBe("InternalError");

// JWT round-trip
const jwt = await admin.signJwt();
expect(Result.isOk(jwt)).toBe(true);
const parts = jwt.value.split(".");
expect(parts).toHaveLength(3);

const verified = await admin.verifyJwt(jwt.value);
expect(Result.isOk(verified)).toBe(true);
expect(verified.value.sub).toBe("admin");
expect(verified.value.iss).toBe(keyResult.value.fingerprint);

// Expired JWT fails
const expiredJwt = await admin.signJwt({ ttlSeconds: -1 });
// Force an already-expired token by manipulating time:
const pastJwt = await signJwtWithExpiration(admin, Date.now() / 1000 - 600);
const expResult = await admin.verifyJwt(pastJwt);
expect(Result.isError(expResult)).toBe(true);
expect(expResult.error._tag).toBe("AuthError");

// Bad signature fails
const tampered = jwt.value.slice(0, -4) + "AAAA";
const badSigResult = await admin.verifyJwt(tampered);
expect(Result.isError(badSigResult)).toBe(true);
expect(badSigResult.error._tag).toBe("AuthError");

// Rotation invalidates old JWTs
const oldJwt = jwt.value;
const rotateResult = await admin.rotate();
expect(Result.isOk(rotateResult)).toBe(true);
expect(rotateResult.value.fingerprint).not.toBe(keyResult.value.fingerprint);

const oldJwtVerify = await admin.verifyJwt(oldJwt);
expect(Result.isError(oldJwtVerify)).toBe(true);
expect(oldJwtVerify.error._tag).toBe("AuthError");

// New JWT works after rotation
const newJwt = await admin.signJwt();
const newVerify = await admin.verifyJwt(newJwt.value);
expect(Result.isOk(newVerify)).toBe(true);

// Malformed JWT
const malformed = await admin.verifyJwt("not.a.valid.jwt.token");
expect(Result.isError(malformed)).toBe(true);
expect(malformed.error._tag).toBe("ValidationError");

// TTL exceeding max
const tooLongResult = await admin.signJwt({ ttlSeconds: 7200 });
expect(Result.isError(tooLongResult)).toBe(true);
expect(tooLongResult.error._tag).toBe("ValidationError");

// Nonce uniqueness
const jwt1 = await admin.signJwt();
const jwt2 = await admin.signJwt();
const payload1 = decodeJwtPayload(jwt1.value);
const payload2 = decodeJwtPayload(jwt2.value);
expect(payload1.jti).not.toBe(payload2.jti);

// Vault isolation
const vaultKeys = vault.list();
const adminKeys = vaultKeys.filter((k) => k.startsWith("admin-key:"));
const opKeys = vaultKeys.filter((k) => k.startsWith("op-key:"));
expect(adminKeys.length).toBeGreaterThan(0);
// Admin and inbox keys coexist without collision
```

### Test Utilities

```typescript
/** Create an in-memory vault for testing. */
async function createTestVault(): Promise<Vault>;

/** Create an AdminKeyManager with a test vault. */
async function createTestAdminKeyManager(): Promise<{
  admin: AdminKeyManager;
  vault: Vault;
}>;

/** Decode a JWT payload without verification (for test assertions). */
function decodeJwtPayload(token: string): AdminJwtPayload;

/** Sign a JWT with a specific expiration timestamp (for expiry testing). */
async function signJwtWithExpiration(
  admin: AdminKeyManager,
  expUnixSeconds: number,
): Promise<string>;

```

## File Layout

```
packages/keys/
  src/
    admin-key.ts                  # AdminKeyManager, createAdminKeyManager()
                                  # AdminKeyRecord, AdminJwtPayload schema,
                                  # AdminAuthContext, AdminJwtOptions
    jwt.ts                        # JWT encode/decode/sign/verify helpers
                                  # base64url encode/decode
                                  # AdminJwtConfigSchema
    key-manager.ts                # (MODIFIED) Add `admin` property to KeyManager
    __tests__/
      admin-key.test.ts           # Admin key lifecycle, vault storage, rotation
      jwt.test.ts                 # JWT generation, verification, expiry, tampering
      admin-integration.test.ts   # KeyManager.admin.* through the facade
```

Each new source file targets under 150 LOC. `admin-key.ts` is the largest at approximately 130 LOC, containing the `AdminKeyManager` implementation. `jwt.ts` holds the pure JWT encode/decode/sign/verify functions (~100 LOC). The existing `key-manager.ts` grows by approximately 15 LOC to wire in the `admin` property.
