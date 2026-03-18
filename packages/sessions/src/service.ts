import { Result } from "better-result";
import type {
  SignetError,
  IssuedSession,
  SessionConfig,
  SessionRevocationReason,
} from "@xmtp/signet-schemas";
import type { SessionManager, SessionRecord } from "@xmtp/signet-contracts";
import { generateSessionId } from "./token.js";
import { computePolicyHash } from "./policy-hash.js";
import type {
  InternalSessionManager,
  InternalSessionRecord,
} from "./session-manager.js";

/** Dependencies required by the session service. */
export interface SessionServiceDeps {
  readonly manager: InternalSessionManager;
  readonly keyManager: {
    issueSessionKey(
      sessionId: string,
      ttlSeconds: number,
    ): Promise<Result<{ fingerprint: string }, SignetError>>;
    revokeSessionKey?(keyId: string): Result<void, SignetError>;
  };
}

function toSessionRecord(record: InternalSessionRecord): SessionRecord {
  return {
    sessionId: record.sessionId,
    agentInboxId: record.agentInboxId,
    sessionKeyFingerprint: record.sessionKeyFingerprint,
    view: record.view,
    grant: record.grant,
    state: record.state,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    lastHeartbeat: record.lastHeartbeat,
  };
}

function toIssuedSession(record: InternalSessionRecord): IssuedSession {
  return {
    token: record.token,
    session: {
      sessionId: record.sessionId,
      agentInboxId: record.agentInboxId,
      sessionKeyFingerprint: record.sessionKeyFingerprint,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
    },
  };
}

/** Create the public session service implementation. */
export function createSessionService(deps: SessionServiceDeps): SessionManager {
  return {
    async issue(config: SessionConfig) {
      deps.manager.sweepExpired();

      const policyHash = computePolicyHash(config.view, config.grant);
      const existing = deps.manager
        .getActiveSessions(config.agentInboxId)
        .find((record) => record.policyHash === policyHash);
      if (existing) {
        return Result.ok(toIssuedSession(existing));
      }

      const sessionId = generateSessionId();
      const ttlSeconds = config.ttlSeconds ?? 3600;

      const sessionKey = await deps.keyManager.issueSessionKey(
        sessionId,
        ttlSeconds,
      );
      if (Result.isError(sessionKey)) {
        return sessionKey;
      }

      const created = await deps.manager.createSession(
        config,
        sessionKey.value.fingerprint,
        { sessionId },
      );
      if (Result.isError(created)) {
        return created;
      }

      return Result.ok(toIssuedSession(created.value));
    },

    async list(agentInboxId?: string) {
      deps.manager.sweepExpired();
      return Result.ok(
        deps.manager.listSessions(agentInboxId).map(toSessionRecord),
      );
    },

    async lookup(sessionId: string) {
      deps.manager.sweepExpired();
      const result = deps.manager.getSessionById(sessionId);
      if (Result.isError(result)) {
        return result;
      }
      return Result.ok(toSessionRecord(result.value));
    },

    async lookupByToken(token: string) {
      const result = deps.manager.getSessionByToken(token);
      if (Result.isError(result)) {
        return result;
      }
      return Result.ok(toSessionRecord(result.value));
    },

    async revoke(sessionId: string, reason: SessionRevocationReason) {
      const result = deps.manager.revokeSession(sessionId, reason);
      if (Result.isError(result)) {
        return result;
      }
      return Result.ok(undefined);
    },

    async heartbeat(sessionId: string) {
      const result = deps.manager.recordHeartbeat(sessionId);
      if (Result.isError(result)) {
        return result;
      }
      return Result.ok(undefined);
    },

    getRevealState(sessionId: string) {
      return deps.manager.getRevealState(sessionId);
    },

    async isActive(sessionId: string) {
      deps.manager.sweepExpired();
      const result = deps.manager.getSessionById(sessionId);
      if (Result.isError(result)) {
        return result;
      }
      return Result.ok(result.value.state === "active");
    },
  };
}
