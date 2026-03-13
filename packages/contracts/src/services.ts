import type { Result } from "better-result";
import type {
  AgentRevocationReason,
  BrokerError,
  IssuedSession,
  SessionConfig,
  SessionRevocationReason,
} from "@xmtp-broker/schemas";
import type { SignedAttestation } from "./attestation-types.js";
import type { CoreState, GroupInfo } from "./core-types.js";
import type { SessionRecord } from "./session-types.js";

/** Top-level broker lifecycle: initialize, shutdown, state transitions. */
export interface BrokerCore {
  readonly state: CoreState;
  initializeLocal(): Promise<Result<void, BrokerError>>;
  initialize(): Promise<Result<void, BrokerError>>;
  shutdown(): Promise<Result<void, BrokerError>>;
  sendMessage(
    groupId: string,
    contentType: string,
    content: unknown,
  ): Promise<Result<{ messageId: string }, BrokerError>>;
  getGroupInfo(groupId: string): Promise<Result<GroupInfo, BrokerError>>;
}

/** Session issuance, lookup, revocation, heartbeat processing. */
export interface SessionManager {
  issue(config: SessionConfig): Promise<Result<IssuedSession, BrokerError>>;
  list(
    agentInboxId?: string,
  ): Promise<Result<readonly SessionRecord[], BrokerError>>;
  lookup(sessionId: string): Promise<Result<SessionRecord, BrokerError>>;
  /** Resolve a bearer token to its session record. */
  lookupByToken(token: string): Promise<Result<SessionRecord, BrokerError>>;
  revoke(
    sessionId: string,
    reason: SessionRevocationReason,
  ): Promise<Result<void, BrokerError>>;
  heartbeat(sessionId: string): Promise<Result<void, BrokerError>>;
  isActive(sessionId: string): Promise<Result<boolean, BrokerError>>;
}

/** Attestation lifecycle: issue, refresh, revoke, query. */
export interface AttestationManager {
  issue(
    sessionId: string,
    groupId: string,
  ): Promise<Result<SignedAttestation, BrokerError>>;
  refresh(
    attestationId: string,
  ): Promise<Result<SignedAttestation, BrokerError>>;
  revoke(
    attestationId: string,
    reason: AgentRevocationReason,
  ): Promise<Result<void, BrokerError>>;
  current(
    agentInboxId: string,
    groupId: string,
  ): Promise<Result<SignedAttestation | null, BrokerError>>;
}
