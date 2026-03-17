# 05-sessions

**Package:** `@xmtp-broker/sessions`
**Spec version:** 0.1.0

## Overview

The sessions package manages ephemeral authorization contexts between agent harnesses and the broker. A session is the mechanism by which a harness receives its active view and grant -- it binds a specific agent to a set of groups with a defined visibility mode and action permissions for a limited time.

Sessions are opaque bearer tokens validated entirely broker-side. The broker maintains a session store mapping tokens to session records that track state, policy binding, and expiry. This avoids the complexity of JWTs (key distribution, revocation lists, clock skew) while keeping the security model simple: possession of a valid token grants exactly the permissions the broker recorded at issuance.

The session manager enforces the materiality boundary from the PRD. Non-material policy changes (thread scope adjustment, adding a content type, enabling reactions) apply in-place to the active session. Material changes (view mode escalation, egress permission grants, group management capabilities) terminate the session and require the harness to reauthorize under the new policy. This prevents excessive reconnection churn while ensuring privilege escalation always involves a clean authorization step.

Sessions are scoped to agent + groups, not per-thread. Thread filtering is a view concern handled by the policy engine within a session's group scope. This matches the PLAN.md decision and keeps the session model simple.

## Dependencies

**Imports:**
- `@xmtp-broker/contracts` — `SessionRecord`, `MaterialityCheck`, `SessionManager` (canonical interface definitions)
- `@xmtp-broker/schemas` — `SessionConfig`, `SessionToken`, `SessionState`, `SessionRevocationReason`, `ViewConfig`, `GrantConfig`, error classes (`AuthError`, `SessionExpiredError`, `ValidationError`, `NotFoundError`, `InternalError`)
- `better-result` — `Result`, `Ok`, `Err`

**Imported by:**
- `@xmtp-broker/ws` — transport layer creates sessions on harness connect
- `@xmtp-broker/policy` — policy engine checks session validity before enforcing grants
- `@xmtp-broker/attestations` — attestation manager reads session key fingerprint
- `@xmtp-broker/keys` — key manager issues session keys bound to sessions

## Public Interfaces

> **Note:** The following interfaces are canonically defined in `@xmtp-broker/contracts`: `SessionRecord`, `MaterialityCheck`, `SessionManager`. This package implements the `SessionManager` interface from contracts. The `SessionRevocationReason` enum has moved to `@xmtp-broker/schemas`.

### SessionRecord

The broker-side record for an active session. Not exported to harnesses -- they only see `SessionToken`.

```typescript
interface SessionRecord {
  readonly sessionId: string;
  readonly token: string;
  readonly agentInboxId: string;
  readonly view: ViewConfig;
  readonly grant: GrantConfig;
  readonly policyHash: string;
  readonly sessionKeyFingerprint: string;
  readonly state: SessionState;
  readonly heartbeatInterval: number;
  readonly lastHeartbeatAt: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly revocationReason: SessionRevocationReason | null;
}
```

### SessionRevocationReason

```typescript
const SessionRevocationReason = z.enum([
  "expired",
  "policy-change",
  "explicit-revoke",
  "harness-disconnect",
  "heartbeat-timeout",
  "max-sessions-exceeded",
]).describe("Why a session was revoked");

type SessionRevocationReason = z.infer<typeof SessionRevocationReason>;
```

### MaterialityBoundary

Fields whose changes constitute a material escalation.

```typescript
interface MaterialityCheck {
  readonly isMaterial: boolean;
  readonly reason: string | null;
  readonly changedFields: readonly string[];
}
```

### SessionManager

```typescript
interface SessionManagerConfig {
  readonly defaultTtlSeconds: number;       // default: 3600
  readonly maxConcurrentPerAgent: number;    // default: 3
  readonly tokenByteLength: number;          // default: 32
  readonly renewalWindowSeconds: number;     // default: 300 (5 min before expiry)
  readonly heartbeatGracePeriod: number;     // default: 3 (missed beats before timeout)
}

interface SessionManager {
  /** Create a new session for an agent with the given config. */
  createSession(
    config: SessionConfig,
    sessionKeyFingerprint: string,
  ): Promise<Result<SessionRecord, ValidationError | InternalError>>;

  /** Look up a session by its bearer token. */
  getSessionByToken(
    token: string,
  ): Result<SessionRecord, SessionExpiredError | NotFoundError>;

  /** Look up a session by its ID. */
  getSessionById(
    sessionId: string,
  ): Result<SessionRecord, NotFoundError>;

  /** List active sessions for an agent. */
  getActiveSessions(
    agentInboxId: string,
  ): readonly SessionRecord[];

  /** Record a heartbeat for a session. */
  recordHeartbeat(
    sessionId: string,
  ): Result<void, SessionExpiredError | NotFoundError>;

  /** Renew a session before it expires. Returns a new session record. */
  renewSession(
    sessionId: string,
  ): Promise<Result<SessionRecord, SessionExpiredError | NotFoundError | AuthError>>;

  /** Apply a non-material policy update to an active session. */
  updateSessionPolicy(
    sessionId: string,
    view: ViewConfig,
    grant: GrantConfig,
  ): Result<SessionRecord, SessionExpiredError | NotFoundError>;

  /** Revoke a session immediately. */
  revokeSession(
    sessionId: string,
    reason: SessionRevocationReason,
  ): Result<SessionRecord, NotFoundError>;

  /** Revoke all sessions for an agent. */
  revokeAllSessions(
    agentInboxId: string,
    reason: SessionRevocationReason,
  ): readonly SessionRecord[];

  /** Check whether a policy change is material relative to the current session. */
  checkMateriality(
    sessionId: string,
    newView: ViewConfig,
    newGrant: GrantConfig,
  ): Result<MaterialityCheck, NotFoundError>;

  /** Run expiry sweep. Called periodically by the broker. */
  sweepExpired(): readonly SessionRecord[];
}
```

### Factory

```typescript
function createSessionManager(
  config?: Partial<SessionManagerConfig>,
): SessionManager;
```

## Zod Schemas

Session schemas are defined in `@xmtp-broker/schemas` (see 02-schemas.md):
- `SessionConfig` — input for creating a session
- `SessionToken` — the token shape returned to the harness
- `SessionState` — `"active" | "expired" | "revoked" | "reauthorization-required"`

This package adds one schema:
- `SessionRevocationReason` — defined above

## Behaviors

### Session Creation Flow

```
Harness connects
    |
    v
Transport calls createSession(config, keyFingerprint)
    |
    +--> Validate config via SessionConfig.parse()
    |
    +--> Check concurrent session count for agent
    |    |
    |    +--> If at max: revoke oldest session (reason: max-sessions-exceeded)
    |
    +--> Check for dedup: same agent + same view + same grant
    |    |
    |    +--> If match found and active: return existing session
    |
    +--> Generate token: 32 random bytes, base64url-encoded
    |
    +--> Generate sessionId: "ses_" + 16 random bytes, hex-encoded
    |
    +--> Compute policyHash: Bun.hash(canonicalize(view + grant))
    |
    +--> Create SessionRecord with state = "active"
    |
    +--> Store: token -> record, sessionId -> record, agent -> [sessions]
    |
    +--> Return SessionRecord
```

The transport layer converts the `SessionRecord` to a `SessionToken` (the harness-visible subset) and emits a `session.started` event.

### Token Format

- **32 bytes** of cryptographically random data via `crypto.getRandomValues()`
- Encoded as **base64url** (no padding) for transport safety
- Total encoded length: 43 characters
- Prefix: none (opaque to the harness)
- The token is a lookup key, not a self-contained credential

### Session ID Format

- Prefix: `ses_`
- 16 random bytes, hex-encoded
- Total length: 36 characters (`ses_` + 32 hex chars)
- Used for internal references, logging, and attestation binding

### State Machine

```
                  ┌──────────────────────────────┐
                  │                              │
                  v                              │
    ┌─────────────────────┐                      │
    │       active        │──── renewSession ─────┘
    └─────────────────────┘     (resets TTL, same state)
        │         │        │
        │         │        │
   TTL expires  revoke  material policy change
        │         │        │
        v         v        v
    ┌────────┐ ┌────────┐ ┌──────────────────────────┐
    │expired │ │revoked │ │reauthorization-required   │
    └────────┘ └────────┘ └──────────────────────────┘
```

All three terminal states are final. A session never transitions back to `active`. Renewal creates a continuation of the same session (same ID, reset TTL), not a new session.

### Materiality Rules

The broker determines whether a policy change is material by comparing the old and new view/grant configurations. A change is **material** if any of the following boundaries are crossed:

**Material changes (require new session):**

| Field | Material when... |
|-------|-----------------|
| `view.mode` | Escalation toward more access: `redacted` -> any, `summary-only` -> `thread-only`/`full`, `reveal-only` -> `full`, `thread-only` -> `full` |
| `grant.messaging.send` | `false` -> `true` |
| `grant.messaging.draftOnly` | `true` -> `false` (removes guardrail) |
| `grant.groupManagement.*` | Any `false` -> `true` |
| `grant.egress.*` | Any `false` -> `true` |
| `grant.tools.scopes` | New tool added, or `allowed: false` -> `true` |

**Non-material changes (apply in-place):**

| Field | Non-material when... |
|-------|---------------------|
| `view.threadScopes` | Adding or removing thread scopes within existing groups |
| `view.contentTypes` | Adding content types to allowlist |
| `grant.messaging.react` | `false` -> `true` |
| `grant.messaging.reply` | `false` -> `true` |
| Any field | Reducing permissions (always non-material) |

**Implementation:** Compare old and new policy via `checkMateriality()`. The function walks each materiality-sensitive field and returns a `MaterialityCheck` with the list of changed fields and whether any crossed a material boundary.

The `policyHash` is computed as `Bun.hash(JSON.stringify(sortedCanonical(view, grant)))` using a deterministic key-sorting canonicalization. Two sessions with the same `policyHash` have identical effective policies.

### Session Deduplication

When `createSession` is called for an agent that already has an active session with the same `policyHash`, the existing session is returned instead of creating a new one. This prevents redundant sessions when a harness reconnects without policy changes.

Dedup only matches on `agentInboxId` + `policyHash`. Different views or grants always produce different sessions.

### Renewal

A harness can request renewal when the session is within the renewal window (default: 5 minutes before expiry). Renewal resets the TTL on the existing session record. It does not create a new token or session ID.

```
renewSession(sessionId)
    |
    +--> Find session by ID
    |
    +--> Check state == "active"
    |
    +--> Check within renewal window (expiresAt - now <= renewalWindowSeconds)
    |    |
    |    +--> If not in window: return AuthError("not in renewal window")
    |
    +--> Reset expiresAt = now + ttlSeconds
    |
    +--> Return updated SessionRecord
```

Renewal does not produce an attestation (non-material operation).

### Concurrent Sessions

An agent may have up to `maxConcurrentPerAgent` active sessions (default: 3). This accommodates:
- Reconnection before old session expires
- Multiple transport connections (WebSocket + MCP)
- Rolling deployment of harness code

When the limit is exceeded, the oldest active session is revoked with reason `max-sessions-exceeded`. The harness receives a `session.expired` event on the old connection before disconnect.

### Heartbeat Processing

The broker tracks heartbeats per session. If `heartbeatGracePeriod` consecutive heartbeats are missed (each expected at `heartbeatInterval` seconds), the session is revoked with reason `heartbeat-timeout`.

```
recordHeartbeat(sessionId)
    |
    +--> Find session, check state == "active"
    |
    +--> Update lastHeartbeatAt = now
    |
    +--> Return Ok(void)
```

The `sweepExpired()` method checks both TTL expiry and heartbeat timeout in a single pass.

### Session Key Binding

Each session is bound to exactly one session key, identified by `sessionKeyFingerprint`. The key is issued by `@xmtp-broker/keys` and passed to `createSession`. The fingerprint is:
- Stored in the session record
- Included in any attestation issued during the session
- Used to verify that requests come from the session they claim

Session keys are ephemeral. They cannot perform operational-key or root-key operations. When a session is revoked or expires, the corresponding key material should be zeroized by the key manager.

### Revocation

Revocation is immediate and broker-initiated. The flow:

```
revokeSession(sessionId, reason)
    |
    +--> Find session by ID
    |
    +--> Set state = "revoked"
    |
    +--> Set revokedAt = now
    |
    +--> Set revocationReason = reason
    |
    +--> Return updated SessionRecord
```

The transport layer is responsible for:
1. Emitting a `session.expired` event to the harness with the reason
2. Closing the connection after a brief drain period

The session manager does not manage connections -- it only manages state.

### In-Place Policy Updates

When the broker determines a policy change is non-material, it calls `updateSessionPolicy()`:

```
updateSessionPolicy(sessionId, newView, newGrant)
    |
    +--> Find session, check state == "active"
    |
    +--> Recompute policyHash
    |
    +--> Update view, grant, policyHash on the record
    |
    +--> Return updated SessionRecord
```

The transport layer then emits `view.updated` and/or `grant.updated` events to the harness.

## Error Cases

| Scenario | Error | Category |
|----------|-------|----------|
| Invalid `SessionConfig` input | `ValidationError` | validation |
| Token not found in store | `NotFoundError` | not_found |
| Session ID not found | `NotFoundError` | not_found |
| Token maps to expired session | `SessionExpiredError` | auth |
| Token maps to revoked session | `SessionExpiredError` | auth |
| Renewal requested outside window | `AuthError` | auth |
| Renewal on non-active session | `SessionExpiredError` | auth |
| Token generation failure | `InternalError` | internal |

All errors are returned as `Result` values. No exceptions thrown.

## Open Questions Resolved

**Q: Per-thread session scoping?** (PRD Open Questions)
**A:** Sessions scope to agent + groups, not individual threads. Thread filtering is a view concern applied by the policy engine within a session's group scope. Rationale: thread scope changes are frequent and non-material; making them session-level would cause excessive session churn. This aligns with the PLAN.md decision.

**Q: What triggers session reauthorization vs in-place update?** (PRD: Session and view/grant binding)
**A:** The materiality rules table above defines the exact boundary. The principle: any change that expands what an agent can see (view escalation) or do (grant escalation) is material and requires a new session. Any change that narrows permissions or adjusts non-security-sensitive configuration is non-material and applies in-place. Reply and react grants are non-material because they operate within the existing view scope -- they don't expose new content or create new egress paths.

**Q: Should session rotation produce attestations?** (PRD: Attestation noise and materiality)
**A:** No. Routine session rotation (TTL renewal, reconnection with same policy) is a non-material operation. Only policy changes that cross a materiality boundary produce new attestations. The session manager signals materiality to the attestation manager, which decides whether to publish.

## Deferred

- **Persistent session store**: v0 uses an in-memory `Map`. Durable storage (bun:sqlite) is deferred until broker restart recovery is designed post-v0.
- **Session migration across broker instances**: Requires distributed state. Deferred to hosted/managed broker phase.
- **Session audit log**: Structured logging of session lifecycle events. Useful but not required for v0 correctness.
- **Rate limiting on session creation**: Deferred until transport layer matures and abuse patterns are understood.
- **Session key cryptographic operations**: This spec defines the binding (fingerprint stored, key issued by keys package). Actual crypto is in 07-key-management.

## Testing Strategy

### What to Test

1. **Session creation** — Valid config produces a session with correct fields. Invalid config returns `ValidationError`.
2. **Token lookup** — Valid token returns session. Unknown token returns `NotFoundError`. Expired/revoked token returns `SessionExpiredError`.
3. **Deduplication** — Same agent + same policy reuses existing session. Different policy creates new session.
4. **Concurrent session limit** — Exceeding max revokes oldest. Under max allows all.
5. **Materiality checks** — Each materiality rule produces correct `MaterialityCheck`. Escalations are material; reductions are not.
6. **Renewal** — Works within window, fails outside window, fails on non-active session.
7. **Revocation** — Sets correct state and reason. Revoked sessions fail subsequent lookups with `SessionExpiredError`.
8. **Heartbeat** — Updates timestamp. Missing heartbeats trigger timeout in sweep.
9. **Sweep** — Expires sessions past TTL. Revokes sessions with missed heartbeats.
10. **In-place policy update** — Updates view/grant/hash on active session. Fails on non-active session.

### Key Test Scenarios

```typescript
// Session creation
const result = await manager.createSession(validConfig, "fp_abc123");
expect(result.ok).toBe(true);
expect(result.value.state).toBe("active");
expect(result.value.token).toHaveLength(43); // base64url of 32 bytes

// Token lookup on expired session
const expired = await manager.createSession(expiredConfig, "fp_xyz");
// ... advance time past TTL ...
manager.sweepExpired();
const lookup = manager.getSessionByToken(expired.value.token);
expect(lookup.ok).toBe(false);
expect(lookup.error._tag).toBe("SessionExpiredError");

// Materiality: view mode escalation is material
const check = manager.checkMateriality(sessionId,
  { ...currentView, mode: "full" },  // was "reveal-only"
  currentGrant,
);
expect(check.value.isMaterial).toBe(true);
expect(check.value.changedFields).toContain("view.mode");

// Materiality: adding thread scope is non-material
const check2 = manager.checkMateriality(sessionId,
  { ...currentView, threadScopes: [...currentView.threadScopes, newScope] },
  currentGrant,
);
expect(check2.value.isMaterial).toBe(false);

// Dedup: same policy reuses session
const s1 = await manager.createSession(config, "fp_1");
const s2 = await manager.createSession(config, "fp_1");
expect(s1.value.sessionId).toBe(s2.value.sessionId);

// Concurrent limit
for (let i = 0; i < 4; i++) {
  await manager.createSession(uniqueConfig(i), `fp_${i}`);
}
const active = manager.getActiveSessions(agentId);
expect(active).toHaveLength(3); // oldest was evicted
```

### Test Utilities

```typescript
/** Create a SessionManager with short TTLs for testing. */
function createTestSessionManager(
  overrides?: Partial<SessionManagerConfig>,
): SessionManager;

/** Create a valid SessionConfig fixture. */
function createTestSessionConfig(
  overrides?: Partial<SessionConfig>,
): SessionConfig;
```

## File Layout

```
packages/sessions/
  package.json
  tsconfig.json
  src/
    index.ts                    # Re-exports public API
    session-manager.ts          # createSessionManager factory and implementation
    session-record.ts           # SessionRecord interface, SessionRevocationReason schema
    materiality.ts              # checkMateriality logic, materiality rules
    policy-hash.ts              # Deterministic policy hashing
    token.ts                    # Token generation (random bytes + base64url)
    __tests__/
      session-manager.test.ts   # Creation, lookup, concurrent limits, sweep
      materiality.test.ts       # All materiality boundary cases
      policy-hash.test.ts       # Deterministic hashing, canonicalization
      token.test.ts             # Token format, uniqueness, length
      fixtures.ts               # Test factories
```

Each source file stays under 200 LOC. The materiality rules are isolated in their own module for clear ownership and independent testing.
