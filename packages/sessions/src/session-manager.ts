/**
 * Session manager implementation.
 *
 * Manages the lifecycle of agent sessions: creation, lookup,
 * renewal, revocation, heartbeat processing, and expiry sweeps.
 * Uses an in-memory Map store for v0.
 */

import { Result } from "better-result";
import type {
  SessionConfig,
  SessionRevocationReason,
  ViewConfig,
  GrantConfig,
} from "@xmtp/signet-schemas";
import {
  AuthError,
  SessionExpiredError,
  NotFoundError,
  InternalError,
  ValidationError,
} from "@xmtp/signet-schemas";
import type {
  MaterialityCheck,
  RevealStateStore,
} from "@xmtp/signet-contracts";
import { createRevealStateStore } from "@xmtp/signet-policy";
import { generateToken, generateSessionId } from "./token.js";
import { computePolicyHash } from "./policy-hash.js";
import { checkMateriality as checkMaterialityImpl } from "./materiality.js";

/** Configuration for the session manager. */
export interface SessionManagerConfig {
  readonly defaultTtlSeconds: number;
  readonly maxConcurrentPerAgent: number;
  readonly tokenByteLength: number;
  readonly renewalWindowSeconds: number;
  readonly heartbeatGracePeriod: number;
}

const DEFAULT_CONFIG: SessionManagerConfig = {
  defaultTtlSeconds: 3600,
  maxConcurrentPerAgent: 3,
  tokenByteLength: 32,
  renewalWindowSeconds: 300,
  heartbeatGracePeriod: 3,
};

/** Internal session record with all signet-side fields. */
export interface InternalSessionRecord {
  readonly sessionId: string;
  readonly token: string;
  readonly agentInboxId: string;
  readonly view: ViewConfig;
  readonly grant: GrantConfig;
  readonly policyHash: string;
  readonly sessionKeyFingerprint: string;
  readonly state: "active" | "expired" | "revoked" | "reauthorization-required";
  readonly heartbeatInterval: number;
  readonly lastHeartbeat: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly ttlMs: number;
  readonly revokedAt: string | null;
  readonly revocationReason: SessionRevocationReason | null;
}

/** Extended session manager interface (superset of contract). */
export interface InternalSessionManager {
  createSession(
    config: SessionConfig,
    sessionKeyFingerprint: string,
    options?: { sessionId?: string },
  ): Promise<Result<InternalSessionRecord, ValidationError | InternalError>>;
  getSessionByToken(
    token: string,
  ): Result<InternalSessionRecord, SessionExpiredError | NotFoundError>;
  getSessionById(
    sessionId: string,
  ): Result<InternalSessionRecord, NotFoundError>;
  getActiveSessions(agentInboxId: string): readonly InternalSessionRecord[];
  listSessions(agentInboxId?: string): readonly InternalSessionRecord[];
  recordHeartbeat(
    sessionId: string,
  ): Result<void, SessionExpiredError | NotFoundError>;
  renewSession(
    sessionId: string,
  ): Promise<
    Result<
      InternalSessionRecord,
      SessionExpiredError | NotFoundError | AuthError
    >
  >;
  updateSessionPolicy(
    sessionId: string,
    view: ViewConfig,
    grant: GrantConfig,
  ): Result<InternalSessionRecord, SessionExpiredError | NotFoundError>;
  revokeSession(
    sessionId: string,
    reason: SessionRevocationReason,
  ): Result<InternalSessionRecord, NotFoundError>;
  revokeAllSessions(
    agentInboxId: string,
    reason: SessionRevocationReason,
  ): readonly InternalSessionRecord[];
  lookupByToken(
    token: string,
  ): Result<InternalSessionRecord, SessionExpiredError | NotFoundError>;
  checkMateriality(
    sessionId: string,
    newView: ViewConfig,
    newGrant: GrantConfig,
  ): Result<MaterialityCheck, NotFoundError>;
  getRevealState(sessionId: string): Result<RevealStateStore, NotFoundError>;
  setSessionState(
    sessionId: string,
    state: InternalSessionRecord["state"],
  ): Result<InternalSessionRecord, NotFoundError>;
  sweepExpired(): readonly InternalSessionRecord[];
  /** Check if a session's heartbeat has exceeded interval + grace period. */
  isHeartbeatStale(sessionId: string): Result<boolean, NotFoundError>;
}

/** Hooks for session-manager side effects. */
export interface SessionManagerOptions {
  /** Called when a session's policy/state is mutated (for cache invalidation). */
  readonly onSessionMutated?: (sessionId: string) => void;
  /** Called when a session is revoked. Receives the full record for seal publishing. */
  readonly onSessionRevoked?: (session: InternalSessionRecord) => void;
}

/** Create a new session manager with the given configuration. */
export function createSessionManager(
  overrides?: Partial<SessionManagerConfig>,
  options?: SessionManagerOptions,
): InternalSessionManager {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  const onMutated = options?.onSessionMutated;

  // In-memory stores
  const byId = new Map<string, InternalSessionRecord>();
  const byToken = new Map<string, string>(); // token -> sessionId
  const byAgent = new Map<string, Set<string>>(); // agentInboxId -> sessionIds
  const revealStates = new Map<string, RevealStateStore>(); // sessionId -> store

  function now(): string {
    return new Date().toISOString();
  }

  function upsertRecord(record: InternalSessionRecord): void {
    byId.set(record.sessionId, record);
    byToken.set(record.token, record.sessionId);
    let agentSessions = byAgent.get(record.agentInboxId);
    if (!agentSessions) {
      agentSessions = new Set();
      byAgent.set(record.agentInboxId, agentSessions);
    }
    agentSessions.add(record.sessionId);
  }

  function mutateRecord(
    sessionId: string,
    updates: Partial<InternalSessionRecord>,
  ): Result<InternalSessionRecord, InternalError> {
    const existing = byId.get(sessionId);
    if (!existing) {
      return Result.err(
        InternalError.create(`Session ${sessionId} not found in store`),
      );
    }
    const updated: InternalSessionRecord = {
      sessionId: updates.sessionId ?? existing.sessionId,
      token: updates.token ?? existing.token,
      agentInboxId: updates.agentInboxId ?? existing.agentInboxId,
      view: updates.view ?? existing.view,
      grant: updates.grant ?? existing.grant,
      policyHash: updates.policyHash ?? existing.policyHash,
      sessionKeyFingerprint:
        updates.sessionKeyFingerprint ?? existing.sessionKeyFingerprint,
      state: updates.state ?? existing.state,
      heartbeatInterval:
        updates.heartbeatInterval ?? existing.heartbeatInterval,
      lastHeartbeat: updates.lastHeartbeat ?? existing.lastHeartbeat,
      issuedAt: updates.issuedAt ?? existing.issuedAt,
      expiresAt: updates.expiresAt ?? existing.expiresAt,
      ttlMs: updates.ttlMs ?? existing.ttlMs,
      revokedAt:
        updates.revokedAt !== undefined
          ? updates.revokedAt
          : existing.revokedAt,
      revocationReason:
        updates.revocationReason !== undefined
          ? updates.revocationReason
          : existing.revocationReason,
    };
    byId.set(sessionId, updated);

    // Only fire onMutated for policy-relevant changes, not routine
    // updates like heartbeat timestamps that don't affect authorization.
    const policyChanged =
      updates.view !== undefined ||
      updates.grant !== undefined ||
      updates.state !== undefined ||
      updates.revokedAt !== undefined ||
      updates.policyHash !== undefined;
    if (policyChanged) {
      onMutated?.(sessionId);
    }

    return Result.ok(updated);
  }

  function getActiveForAgent(agentInboxId: string): InternalSessionRecord[] {
    const ids = byAgent.get(agentInboxId);
    if (!ids) return [];
    const active: InternalSessionRecord[] = [];
    for (const id of ids) {
      const record = byId.get(id);
      if (record?.state === "active") {
        active.push(record);
      }
    }
    return active;
  }

  function cleanupRevealState(sessionId: string): void {
    const store = revealStates.get(sessionId);
    if (store) {
      store.restore({ activeReveals: [] });
    }
  }

  function revokeRecord(
    sessionId: string,
    reason: SessionRevocationReason,
  ): Result<InternalSessionRecord, InternalError> {
    cleanupRevealState(sessionId);
    const result = mutateRecord(sessionId, {
      state: "revoked",
      revokedAt: now(),
      revocationReason: reason,
    });
    if (result.isOk()) {
      options?.onSessionRevoked?.(result.value);
    }
    return result;
  }

  const manager: InternalSessionManager = {
    async createSession(sessionConfig, sessionKeyFingerprint, options) {
      const policyHash = computePolicyHash(
        sessionConfig.view,
        sessionConfig.grant,
      );

      const activeSessions = getActiveForAgent(sessionConfig.agentInboxId);

      // Concurrent session limit: revoke oldest if at max (check before dedup)
      if (activeSessions.length >= config.maxConcurrentPerAgent) {
        const sorted = [...activeSessions].sort(
          (a, b) =>
            new Date(a.issuedAt).getTime() - new Date(b.issuedAt).getTime(),
        );
        const oldest = sorted[0];
        if (oldest) {
          // "policy-violation" is the closest valid SessionRevocationReason
          // for max-sessions eviction (no dedicated enum value exists)
          const revokeResult = revokeRecord(
            oldest.sessionId,
            "policy-violation",
          );
          if (!revokeResult.isOk()) {
            return Result.err(revokeResult.error);
          }
        }
      }

      // Dedup check: same agent + same policy hash (after eviction)
      const currentActive = getActiveForAgent(sessionConfig.agentInboxId);
      const existing = currentActive.find((s) => s.policyHash === policyHash);
      if (existing) {
        return Result.ok(existing);
      }

      const currentTime = now();
      const ttl = sessionConfig.ttlSeconds ?? config.defaultTtlSeconds;
      const ttlMs = ttl * 1000;
      const expiresAt = new Date(Date.now() + ttlMs).toISOString();

      const record: InternalSessionRecord = {
        sessionId: options?.sessionId ?? generateSessionId(),
        token: generateToken(config.tokenByteLength),
        agentInboxId: sessionConfig.agentInboxId,
        view: sessionConfig.view,
        grant: sessionConfig.grant,
        policyHash,
        sessionKeyFingerprint,
        state: "active",
        heartbeatInterval: sessionConfig.heartbeatInterval ?? 30,
        lastHeartbeat: currentTime,
        issuedAt: currentTime,
        expiresAt,
        ttlMs,
        revokedAt: null,
        revocationReason: null,
      };

      upsertRecord(record);
      return Result.ok(record);
    },

    getSessionByToken(token) {
      const sessionId = byToken.get(token);
      if (!sessionId) {
        return Result.err(NotFoundError.create("session", token));
      }
      const record = byId.get(sessionId);
      if (!record) {
        return Result.err(NotFoundError.create("session", token));
      }
      if (Date.now() >= new Date(record.expiresAt).getTime()) {
        const expireResult = mutateRecord(sessionId, { state: "expired" });
        if (!expireResult.isOk()) {
          return Result.err(SessionExpiredError.create(sessionId));
        }
        return Result.err(SessionExpiredError.create(sessionId));
      }
      if (record.state !== "active") {
        return Result.err(SessionExpiredError.create(sessionId));
      }
      return Result.ok(record);
    },

    lookupByToken(token) {
      return manager.getSessionByToken(token);
    },

    getSessionById(sessionId) {
      const record = byId.get(sessionId);
      if (!record) {
        return Result.err(NotFoundError.create("session", sessionId));
      }
      return Result.ok(record);
    },

    getActiveSessions(agentInboxId) {
      return getActiveForAgent(agentInboxId);
    },

    listSessions(agentInboxId) {
      if (agentInboxId !== undefined) {
        return getActiveForAgent(agentInboxId);
      }
      const active: InternalSessionRecord[] = [];
      for (const record of byId.values()) {
        if (record.state === "active") {
          active.push(record);
        }
      }
      return active;
    },

    recordHeartbeat(sessionId) {
      const record = byId.get(sessionId);
      if (!record) {
        return Result.err(NotFoundError.create("session", sessionId));
      }
      if (record.state !== "active") {
        return Result.err(SessionExpiredError.create(sessionId));
      }
      const heartbeatResult = mutateRecord(sessionId, {
        lastHeartbeat: now(),
      });
      if (!heartbeatResult.isOk()) {
        return Result.err(NotFoundError.create("session", sessionId));
      }
      return Result.ok(undefined);
    },

    async renewSession(sessionId) {
      const record = byId.get(sessionId);
      if (!record) {
        return Result.err(NotFoundError.create("session", sessionId));
      }
      if (record.state !== "active") {
        return Result.err(SessionExpiredError.create(sessionId));
      }
      // Check renewal window
      const expiresAt = new Date(record.expiresAt).getTime();
      const remaining = (expiresAt - Date.now()) / 1000;
      if (remaining > config.renewalWindowSeconds) {
        return Result.err(
          AuthError.create("Not in renewal window", {
            sessionId,
            remainingSeconds: remaining,
            renewalWindowSeconds: config.renewalWindowSeconds,
          }),
        );
      }
      // Renew: reset expiry using stored TTL (avoids compounding)
      const newExpiresAt = new Date(Date.now() + record.ttlMs).toISOString();
      const renewResult = mutateRecord(sessionId, { expiresAt: newExpiresAt });
      if (!renewResult.isOk()) {
        return Result.err(NotFoundError.create("session", sessionId));
      }
      return Result.ok(renewResult.value);
    },

    updateSessionPolicy(sessionId, view, grant) {
      const record = byId.get(sessionId);
      if (!record) {
        return Result.err(NotFoundError.create("session", sessionId));
      }
      if (record.state !== "active") {
        return Result.err(SessionExpiredError.create(sessionId));
      }
      const policyHash = computePolicyHash(view, grant);
      const updateResult = mutateRecord(sessionId, {
        view,
        grant,
        policyHash,
      });
      if (!updateResult.isOk()) {
        return Result.err(NotFoundError.create("session", sessionId));
      }
      return Result.ok(updateResult.value);
    },

    revokeSession(sessionId, reason) {
      const record = byId.get(sessionId);
      if (!record) {
        return Result.err(NotFoundError.create("session", sessionId));
      }
      const revokeResult = revokeRecord(sessionId, reason);
      if (!revokeResult.isOk()) {
        return Result.err(NotFoundError.create("session", sessionId));
      }
      return Result.ok(revokeResult.value);
    },

    revokeAllSessions(agentInboxId, reason) {
      const activeSessions = getActiveForAgent(agentInboxId);
      const revoked: InternalSessionRecord[] = [];
      for (const session of activeSessions) {
        const revokeResult = revokeRecord(session.sessionId, reason);
        if (revokeResult.isOk()) {
          revoked.push(revokeResult.value);
        }
      }
      return revoked;
    },

    getRevealState(sessionId) {
      const record = byId.get(sessionId);
      if (!record) {
        return Result.err(NotFoundError.create("session", sessionId));
      }
      let store = revealStates.get(sessionId);
      if (!store) {
        store = createRevealStateStore();
        revealStates.set(sessionId, store);
      }
      return Result.ok(store);
    },

    setSessionState(sessionId, state) {
      const record = byId.get(sessionId);
      if (!record) {
        return Result.err(NotFoundError.create("session", sessionId));
      }
      const updateResult = mutateRecord(sessionId, { state });
      if (!updateResult.isOk()) {
        return Result.err(NotFoundError.create("session", sessionId));
      }
      return Result.ok(updateResult.value);
    },

    checkMateriality(sessionId, newView, newGrant) {
      const record = byId.get(sessionId);
      if (!record) {
        return Result.err(NotFoundError.create("session", sessionId));
      }
      const result = checkMaterialityImpl(
        record.view,
        record.grant,
        newView,
        newGrant,
      );
      return Result.ok(result);
    },

    isHeartbeatStale(sessionId: string): Result<boolean, NotFoundError> {
      const record = byId.get(sessionId);
      if (!record) {
        return Result.err(NotFoundError.create("Session", sessionId));
      }
      if (record.state !== "active") {
        return Result.ok(false);
      }
      const lastHb = new Date(record.lastHeartbeat).getTime();
      const deadline =
        lastHb +
        record.heartbeatInterval * 1000 +
        config.heartbeatGracePeriod * 1000;
      return Result.ok(Date.now() >= deadline);
    },

    sweepExpired() {
      const swept: InternalSessionRecord[] = [];
      const currentTime = Date.now();
      for (const record of byId.values()) {
        if (record.state !== "active") continue;

        // TTL expiry: transition to "expired" (distinct from revocation)
        const expiresAt = new Date(record.expiresAt).getTime();
        if (currentTime >= expiresAt) {
          cleanupRevealState(record.sessionId);
          const expireResult = mutateRecord(record.sessionId, {
            state: "expired",
          });
          if (expireResult.isOk()) {
            swept.push(expireResult.value);
          }
          continue;
        }

        // Heartbeat timeout: revoke if heartbeat overdue
        const lastHb = new Date(record.lastHeartbeat).getTime();
        const heartbeatDeadline =
          lastHb +
          record.heartbeatInterval * 1000 +
          config.heartbeatGracePeriod * 1000;
        if (currentTime >= heartbeatDeadline) {
          const revokeResult = revokeRecord(
            record.sessionId,
            "heartbeat-timeout",
          );
          if (revokeResult.isOk()) {
            swept.push(revokeResult.value);
          }
        }
      }
      return swept;
    },
  };

  return manager;
}
