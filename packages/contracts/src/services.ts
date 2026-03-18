import type { Result } from "better-result";
import type {
  AgentRevocationReason,
  SignetError,
  IssuedSession,
  SessionConfig,
  SessionRevocationReason,
  Seal,
} from "@xmtp/signet-schemas";
import type { SealEnvelope } from "./seal-envelope.js";
import type { CoreState, GroupInfo } from "./core-types.js";
import type { SessionRecord } from "./session-types.js";
import type { RevealStateStore } from "./providers.js";

/** Top-level signet lifecycle: initialize, shutdown, state transitions. */
export interface SignetCore {
  readonly state: CoreState;
  initializeLocal(): Promise<Result<void, SignetError>>;
  initialize(): Promise<Result<void, SignetError>>;
  shutdown(): Promise<Result<void, SignetError>>;
  sendMessage(
    groupId: string,
    contentType: string,
    content: unknown,
  ): Promise<Result<{ messageId: string }, SignetError>>;
  getGroupInfo(groupId: string): Promise<Result<GroupInfo, SignetError>>;
}

/** Session issuance, lookup, revocation, heartbeat processing. */
export interface SessionManager {
  issue(config: SessionConfig): Promise<Result<IssuedSession, SignetError>>;
  list(
    agentInboxId?: string,
  ): Promise<Result<readonly SessionRecord[], SignetError>>;
  lookup(sessionId: string): Promise<Result<SessionRecord, SignetError>>;
  /** Resolve a bearer token to its session record. */
  lookupByToken(token: string): Promise<Result<SessionRecord, SignetError>>;
  revoke(
    sessionId: string,
    reason: SessionRevocationReason,
  ): Promise<Result<void, SignetError>>;
  heartbeat(sessionId: string): Promise<Result<void, SignetError>>;
  isActive(sessionId: string): Promise<Result<boolean, SignetError>>;
  /** Get the per-session reveal state store, lazily creating it if needed. */
  getRevealState(sessionId: string): Result<RevealStateStore, SignetError>;
}

/** Seal lifecycle: issue, refresh, revoke, query. */
export interface SealManager {
  issue(
    sessionId: string,
    groupId: string,
  ): Promise<Result<SealEnvelope, SignetError>>;
  refresh(sealId: string): Promise<Result<SealEnvelope, SignetError>>;
  revoke(
    sealId: string,
    reason: AgentRevocationReason,
  ): Promise<Result<void, SignetError>>;
  current(
    agentInboxId: string,
    groupId: string,
  ): Promise<Result<SealEnvelope | null, SignetError>>;
  needsRenewal(seal: Seal): boolean;
}
