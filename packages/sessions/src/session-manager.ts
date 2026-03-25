/**
 * Credential manager implementation.
 *
 * Manages the lifecycle of operator credentials: issuance, lookup,
 * renewal, revocation, heartbeat processing, and expiry sweeps.
 * Uses an in-memory Map store for v1.
 */

import { Result } from "better-result";
import type {
  CredentialConfigType,
  CredentialIssuerType,
  CredentialStatusType,
  ScopeSetType,
  PermissionScopeType,
  CredentialRevocationReason,
} from "@xmtp/signet-schemas";
import {
  AuthError,
  CredentialExpiredError,
  NotFoundError,
  InternalError,
  resolveScopeSet,
} from "@xmtp/signet-schemas";
import type { RevealStateStore } from "@xmtp/signet-contracts";
import { createRevealStateStore } from "@xmtp/signet-policy";
import { generateToken, generateCredentialId } from "./token.js";
import { computePolicyHash } from "./policy-hash.js";
import type { DetailedMaterialityCheck } from "./materiality.js";
import { checkMateriality as checkMaterialityImpl } from "./materiality.js";

/** Configuration for the credential manager. */
export interface CredentialManagerConfig {
  readonly defaultTtlSeconds: number;
  readonly maxConcurrentPerOperator: number;
  readonly tokenByteLength: number;
  readonly renewalWindowSeconds: number;
  readonly heartbeatGracePeriod: number;
}

const DEFAULT_CONFIG: CredentialManagerConfig = {
  defaultTtlSeconds: 3600,
  maxConcurrentPerOperator: 3,
  tokenByteLength: 32,
  renewalWindowSeconds: 300,
  heartbeatGracePeriod: 3,
};

/** Internal credential record with all signet-side fields. */
export interface InternalCredentialRecord {
  readonly credentialId: string;
  readonly token: string;
  readonly operatorId: string;
  readonly chatIds: readonly string[];
  readonly effectiveScopes: ScopeSetType;
  readonly resolvedScopes: ReadonlySet<PermissionScopeType>;
  readonly policyHash: string;
  readonly status: CredentialStatusType;
  readonly heartbeatInterval: number;
  readonly lastHeartbeat: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly issuedBy: CredentialIssuerType;
  readonly ttlMs: number;
  readonly revokedAt: string | null;
  readonly revocationReason: CredentialRevocationReason | null;
}

/** Extended credential manager interface (superset of contract). */
export interface InternalCredentialManager {
  /** Issue a new credential from configuration. */
  issueCredential(
    config: CredentialConfigType,
    options?: {
      credentialId?: string;
      issuedBy?: CredentialIssuerType;
    },
  ): Promise<Result<InternalCredentialRecord, InternalError>>;
  /** Look up a credential by its bearer token. */
  getCredentialByToken(
    token: string,
  ): Result<InternalCredentialRecord, CredentialExpiredError | NotFoundError>;
  /** Look up a credential by its ID. */
  getCredentialById(
    credentialId: string,
  ): Result<InternalCredentialRecord, NotFoundError>;
  /** Get all active credentials for an operator. */
  getActiveCredentials(operatorId: string): readonly InternalCredentialRecord[];
  /** List credentials, optionally filtered by operator. */
  listCredentials(operatorId?: string): readonly InternalCredentialRecord[];
  /** Record a heartbeat for a credential. */
  recordHeartbeat(
    credentialId: string,
  ): Result<void, CredentialExpiredError | NotFoundError>;
  /** Renew an expiring credential. */
  renewCredential(
    credentialId: string,
  ): Promise<
    Result<
      InternalCredentialRecord,
      CredentialExpiredError | NotFoundError | AuthError
    >
  >;
  /** Update a credential's scope policy. */
  updateCredentialScopes(
    credentialId: string,
    scopes: ScopeSetType,
  ): Result<InternalCredentialRecord, CredentialExpiredError | NotFoundError>;
  /** Revoke a credential with a reason. */
  revokeCredential(
    credentialId: string,
    reason: CredentialRevocationReason,
  ): Result<InternalCredentialRecord, NotFoundError>;
  /** Revoke all active credentials for an operator. */
  revokeAllCredentials(
    operatorId: string,
    reason: CredentialRevocationReason,
  ): readonly InternalCredentialRecord[];
  /** Look up a credential by its bearer token. */
  lookupByToken(
    token: string,
  ): Result<InternalCredentialRecord, CredentialExpiredError | NotFoundError>;
  /** Check if a scope change would be material. */
  checkMateriality(
    credentialId: string,
    newScopes: ScopeSetType,
  ): Result<DetailedMaterialityCheck, NotFoundError>;
  /** Get the reveal state store for a credential. */
  getRevealState(credentialId: string): Result<RevealStateStore, NotFoundError>;
  /** Set the status of a credential directly. */
  setCredentialStatus(
    credentialId: string,
    status: CredentialStatusType,
  ): Result<InternalCredentialRecord, NotFoundError>;
  /** Sweep expired and heartbeat-timed-out credentials. */
  sweepExpired(): readonly InternalCredentialRecord[];
  /** Check if a credential's heartbeat has exceeded interval + grace period. */
  isHeartbeatStale(credentialId: string): Result<boolean, NotFoundError>;
}

/** Hooks for credential-manager side effects. */
export interface CredentialManagerOptions {
  /** Called when a credential's policy/status is mutated (for cache invalidation). */
  readonly onCredentialMutated?: (credentialId: string) => void;
  /** Called when a credential is revoked. Receives the full record for seal publishing. */
  readonly onCredentialRevoked?: (credential: InternalCredentialRecord) => void;
}

/** Create a new credential manager with the given configuration. */
export function createCredentialManager(
  overrides?: Partial<CredentialManagerConfig>,
  options?: CredentialManagerOptions,
): InternalCredentialManager {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  const onMutated = options?.onCredentialMutated;

  // In-memory stores
  const byId = new Map<string, InternalCredentialRecord>();
  const byToken = new Map<string, string>(); // token -> credentialId
  const byOperator = new Map<string, Set<string>>(); // operatorId -> credentialIds
  const revealStates = new Map<string, RevealStateStore>();

  function now(): string {
    return new Date().toISOString();
  }

  function upsertRecord(record: InternalCredentialRecord): void {
    byId.set(record.credentialId, record);
    byToken.set(record.token, record.credentialId);
    let operatorCreds = byOperator.get(record.operatorId);
    if (!operatorCreds) {
      operatorCreds = new Set();
      byOperator.set(record.operatorId, operatorCreds);
    }
    operatorCreds.add(record.credentialId);
  }

  function mutateRecord(
    credentialId: string,
    updates: Partial<InternalCredentialRecord>,
  ): Result<InternalCredentialRecord, InternalError> {
    const existing = byId.get(credentialId);
    if (!existing) {
      return Result.err(
        InternalError.create(`Credential ${credentialId} not found in store`),
      );
    }
    const updated: InternalCredentialRecord = {
      credentialId: updates.credentialId ?? existing.credentialId,
      token: updates.token ?? existing.token,
      operatorId: updates.operatorId ?? existing.operatorId,
      chatIds: updates.chatIds ?? existing.chatIds,
      effectiveScopes: updates.effectiveScopes ?? existing.effectiveScopes,
      resolvedScopes: updates.resolvedScopes ?? existing.resolvedScopes,
      policyHash: updates.policyHash ?? existing.policyHash,
      status: updates.status ?? existing.status,
      heartbeatInterval:
        updates.heartbeatInterval ?? existing.heartbeatInterval,
      lastHeartbeat: updates.lastHeartbeat ?? existing.lastHeartbeat,
      issuedAt: updates.issuedAt ?? existing.issuedAt,
      expiresAt: updates.expiresAt ?? existing.expiresAt,
      issuedBy: updates.issuedBy ?? existing.issuedBy,
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
    byId.set(credentialId, updated);

    // Only fire onMutated for policy-relevant changes
    const policyChanged =
      updates.effectiveScopes !== undefined ||
      updates.status !== undefined ||
      updates.revokedAt !== undefined ||
      updates.policyHash !== undefined;
    if (policyChanged) {
      onMutated?.(credentialId);
    }

    return Result.ok(updated);
  }

  function getActiveForOperator(
    operatorId: string,
  ): InternalCredentialRecord[] {
    const ids = byOperator.get(operatorId);
    if (!ids) return [];
    const active: InternalCredentialRecord[] = [];
    for (const id of ids) {
      const record = byId.get(id);
      if (record?.status === "active") {
        active.push(record);
      }
    }
    return active;
  }

  function cleanupRevealState(credentialId: string): void {
    const store = revealStates.get(credentialId);
    if (store) {
      store.restore({ activeReveals: [] });
    }
  }

  function revokeRecord(
    credentialId: string,
    reason: CredentialRevocationReason,
  ): Result<InternalCredentialRecord, InternalError> {
    cleanupRevealState(credentialId);
    const result = mutateRecord(credentialId, {
      status: "revoked",
      revokedAt: now(),
      revocationReason: reason,
    });
    if (result.isOk()) {
      options?.onCredentialRevoked?.(result.value);
    }
    return result;
  }

  /** Build a ScopeSetType from config allow/deny. */
  function buildScopeSet(cfg: CredentialConfigType): ScopeSetType {
    return {
      allow: cfg.allow ?? [],
      deny: cfg.deny ?? [],
    };
  }

  const manager: InternalCredentialManager = {
    async issueCredential(credentialConfig, opts) {
      const scopes = buildScopeSet(credentialConfig);
      const policyHash = computePolicyHash(scopes, credentialConfig.chatIds);

      const activeCredentials = getActiveForOperator(
        credentialConfig.operatorId,
      );

      // Concurrent credential limit: revoke oldest if at max
      if (activeCredentials.length >= config.maxConcurrentPerOperator) {
        const sorted = [...activeCredentials].sort(
          (a, b) =>
            new Date(a.issuedAt).getTime() - new Date(b.issuedAt).getTime(),
        );
        const oldest = sorted[0];
        if (oldest) {
          const revokeResult = revokeRecord(
            oldest.credentialId,
            "policy-violation",
          );
          if (!revokeResult.isOk()) {
            return Result.err(revokeResult.error);
          }
        }
      }

      // Dedup: same operator + same policy hash (after eviction)
      const currentActive = getActiveForOperator(credentialConfig.operatorId);
      const existing = currentActive.find((c) => c.policyHash === policyHash);
      if (existing) {
        return Result.ok(existing);
      }

      const currentTime = now();
      const ttl = credentialConfig.ttlSeconds ?? config.defaultTtlSeconds;
      const ttlMs = ttl * 1000;
      const expiresAt = new Date(Date.now() + ttlMs).toISOString();
      const resolved = resolveScopeSet(scopes);

      const record: InternalCredentialRecord = {
        credentialId: opts?.credentialId ?? generateCredentialId(),
        token: generateToken(config.tokenByteLength),
        operatorId: credentialConfig.operatorId,
        chatIds: credentialConfig.chatIds,
        effectiveScopes: scopes,
        resolvedScopes: resolved,
        policyHash,
        status: "active",
        heartbeatInterval: 30,
        lastHeartbeat: currentTime,
        issuedAt: currentTime,
        expiresAt,
        issuedBy: opts?.issuedBy ?? "owner",
        ttlMs,
        revokedAt: null,
        revocationReason: null,
      };

      upsertRecord(record);
      return Result.ok(record);
    },

    getCredentialByToken(token) {
      const credentialId = byToken.get(token);
      if (!credentialId) {
        return Result.err(NotFoundError.create("credential", token));
      }
      const record = byId.get(credentialId);
      if (!record) {
        return Result.err(NotFoundError.create("credential", token));
      }
      if (Date.now() >= new Date(record.expiresAt).getTime()) {
        mutateRecord(credentialId, { status: "expired" });
        return Result.err(CredentialExpiredError.create(credentialId));
      }
      if (record.status !== "active") {
        return Result.err(CredentialExpiredError.create(credentialId));
      }
      return Result.ok(record);
    },

    lookupByToken(token) {
      return manager.getCredentialByToken(token);
    },

    getCredentialById(credentialId) {
      const record = byId.get(credentialId);
      if (!record) {
        return Result.err(NotFoundError.create("credential", credentialId));
      }
      return Result.ok(record);
    },

    getActiveCredentials(operatorId) {
      return getActiveForOperator(operatorId);
    },

    listCredentials(operatorId) {
      if (operatorId !== undefined) {
        return getActiveForOperator(operatorId);
      }
      const active: InternalCredentialRecord[] = [];
      for (const record of byId.values()) {
        if (record.status === "active") {
          active.push(record);
        }
      }
      return active;
    },

    recordHeartbeat(credentialId) {
      const record = byId.get(credentialId);
      if (!record) {
        return Result.err(NotFoundError.create("credential", credentialId));
      }
      if (record.status !== "active") {
        return Result.err(CredentialExpiredError.create(credentialId));
      }
      const heartbeatResult = mutateRecord(credentialId, {
        lastHeartbeat: now(),
      });
      if (!heartbeatResult.isOk()) {
        return Result.err(NotFoundError.create("credential", credentialId));
      }
      return Result.ok(undefined);
    },

    async renewCredential(credentialId) {
      const record = byId.get(credentialId);
      if (!record) {
        return Result.err(NotFoundError.create("credential", credentialId));
      }
      if (record.status !== "active") {
        return Result.err(CredentialExpiredError.create(credentialId));
      }
      const expiresAt = new Date(record.expiresAt).getTime();
      const remaining = (expiresAt - Date.now()) / 1000;
      if (remaining > config.renewalWindowSeconds) {
        return Result.err(
          AuthError.create("Not in renewal window", {
            credentialId,
            remainingSeconds: remaining,
            renewalWindowSeconds: config.renewalWindowSeconds,
          }),
        );
      }
      const newExpiresAt = new Date(Date.now() + record.ttlMs).toISOString();
      const renewResult = mutateRecord(credentialId, {
        expiresAt: newExpiresAt,
      });
      if (!renewResult.isOk()) {
        return Result.err(NotFoundError.create("credential", credentialId));
      }
      return Result.ok(renewResult.value);
    },

    updateCredentialScopes(credentialId, scopes) {
      const record = byId.get(credentialId);
      if (!record) {
        return Result.err(NotFoundError.create("credential", credentialId));
      }
      if (record.status !== "active") {
        return Result.err(CredentialExpiredError.create(credentialId));
      }
      const policyHash = computePolicyHash(scopes, record.chatIds);
      const resolved = resolveScopeSet(scopes);
      const updateResult = mutateRecord(credentialId, {
        effectiveScopes: scopes,
        resolvedScopes: resolved,
        policyHash,
      });
      if (!updateResult.isOk()) {
        return Result.err(NotFoundError.create("credential", credentialId));
      }
      return Result.ok(updateResult.value);
    },

    revokeCredential(credentialId, reason) {
      const record = byId.get(credentialId);
      if (!record) {
        return Result.err(NotFoundError.create("credential", credentialId));
      }
      const revokeResult = revokeRecord(credentialId, reason);
      if (!revokeResult.isOk()) {
        return Result.err(NotFoundError.create("credential", credentialId));
      }
      return Result.ok(revokeResult.value);
    },

    revokeAllCredentials(operatorId, reason) {
      const activeCredentials = getActiveForOperator(operatorId);
      const revoked: InternalCredentialRecord[] = [];
      for (const cred of activeCredentials) {
        const revokeResult = revokeRecord(cred.credentialId, reason);
        if (revokeResult.isOk()) {
          revoked.push(revokeResult.value);
        }
      }
      return revoked;
    },

    getRevealState(credentialId) {
      const record = byId.get(credentialId);
      if (!record) {
        return Result.err(NotFoundError.create("credential", credentialId));
      }
      let store = revealStates.get(credentialId);
      if (!store) {
        store = createRevealStateStore();
        revealStates.set(credentialId, store);
      }
      return Result.ok(store);
    },

    setCredentialStatus(credentialId, status) {
      const record = byId.get(credentialId);
      if (!record) {
        return Result.err(NotFoundError.create("credential", credentialId));
      }
      const updateResult = mutateRecord(credentialId, { status });
      if (!updateResult.isOk()) {
        return Result.err(NotFoundError.create("credential", credentialId));
      }
      return Result.ok(updateResult.value);
    },

    checkMateriality(credentialId, newScopes) {
      const record = byId.get(credentialId);
      if (!record) {
        return Result.err(NotFoundError.create("credential", credentialId));
      }
      const result = checkMaterialityImpl(record.effectiveScopes, newScopes);
      return Result.ok(result);
    },

    isHeartbeatStale(credentialId) {
      const record = byId.get(credentialId);
      if (!record) {
        return Result.err(NotFoundError.create("credential", credentialId));
      }
      if (record.status !== "active") {
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
      const swept: InternalCredentialRecord[] = [];
      const currentTime = Date.now();
      for (const record of byId.values()) {
        if (record.status !== "active") continue;

        // TTL expiry
        const expiresAt = new Date(record.expiresAt).getTime();
        if (currentTime >= expiresAt) {
          cleanupRevealState(record.credentialId);
          const expireResult = mutateRecord(record.credentialId, {
            status: "expired",
          });
          if (expireResult.isOk()) {
            swept.push(expireResult.value);
          }
          continue;
        }

        // Heartbeat timeout
        const lastHb = new Date(record.lastHeartbeat).getTime();
        const heartbeatDeadline =
          lastHb +
          record.heartbeatInterval * 1000 +
          config.heartbeatGracePeriod * 1000;
        if (currentTime >= heartbeatDeadline) {
          const revokeResult = revokeRecord(
            record.credentialId,
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
