import type { Result } from "better-result";
import type {
  AgentRevocationReason,
  SignetError,
  CredentialConfigType,
  CredentialIssuerType,
  IssuedCredentialType,
  CredentialTokenType,
  CredentialRevocationReason,
  OperatorConfigType,
  OperatorRecordType,
  PolicyConfigType,
  PolicyRecordType,
  PermissionScopeType,
  ScopeSetType,
  SealEnvelopeType,
} from "@xmtp/signet-schemas";
import type { CoreState, GroupInfo } from "./core-types.js";
import type { CredentialRecord } from "./credential-types.js";

/** Optional provenance supplied when issuing a credential. */
export interface CredentialIssueOptions {
  /** Actor that issued the credential. Defaults to `"owner"` when omitted. */
  readonly issuedBy?: CredentialIssuerType;
}

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

/** Credential issuance, lookup, renewal, and revocation. */
export interface CredentialManager {
  /** Issue a new credential from the given configuration. */
  issue(
    config: CredentialConfigType,
    options?: CredentialIssueOptions,
  ): Promise<Result<IssuedCredentialType, SignetError>>;

  /** List all credentials, optionally filtered by operator. */
  list(
    operatorId?: string,
  ): Promise<Result<readonly CredentialRecord[], SignetError>>;

  /** Look up a credential by its ID. */
  lookup(credentialId: string): Promise<Result<CredentialRecord, SignetError>>;

  /** Resolve a bearer token to its credential record. */
  lookupByToken(token: string): Promise<Result<CredentialRecord, SignetError>>;

  /** Revoke a credential with the given reason. */
  revoke(
    credentialId: string,
    reason: CredentialRevocationReason,
  ): Promise<Result<void, SignetError>>;

  /** Update a credential's configuration. */
  update(
    credentialId: string,
    changes: Partial<CredentialConfigType>,
  ): Promise<Result<CredentialRecord, SignetError>>;

  /** Renew an expiring credential's token. */
  renew(
    credentialId: string,
  ): Promise<Result<CredentialTokenType, SignetError>>;
}

/** Operator registration, lookup, and lifecycle management. */
export interface OperatorManager {
  /** Register a new operator. */
  create(
    config: OperatorConfigType,
  ): Promise<Result<OperatorRecordType, SignetError>>;

  /** List all registered operators. */
  list(): Promise<Result<readonly OperatorRecordType[], SignetError>>;

  /** Look up an operator by ID. */
  lookup(operatorId: string): Promise<Result<OperatorRecordType, SignetError>>;

  /** Update an operator's configuration. */
  update(
    operatorId: string,
    changes: Partial<OperatorConfigType>,
  ): Promise<Result<OperatorRecordType, SignetError>>;

  /** Remove an operator and revoke associated credentials. */
  remove(operatorId: string): Promise<Result<void, SignetError>>;
}

/** Policy creation, lookup, and lifecycle management. */
export interface PolicyManager {
  /** Create a new policy from the given configuration. */
  create(
    config: PolicyConfigType,
  ): Promise<Result<PolicyRecordType, SignetError>>;

  /** List all registered policies. */
  list(): Promise<Result<readonly PolicyRecordType[], SignetError>>;

  /** Look up a policy by ID. */
  lookup(policyId: string): Promise<Result<PolicyRecordType, SignetError>>;

  /** Update a policy's configuration. */
  update(
    policyId: string,
    changes: Partial<PolicyConfigType>,
  ): Promise<Result<PolicyRecordType, SignetError>>;

  /** Remove a policy. */
  remove(policyId: string): Promise<Result<void, SignetError>>;
}

/** Runtime scope checking against credential permissions. */
export interface ScopeGuard {
  /** Check whether a specific scope is allowed for a credential. */
  check(
    scope: PermissionScopeType,
    credentialId: string,
  ): Promise<Result<boolean, SignetError>>;

  /** Compute the effective scope set for a credential. */
  effectiveScopes(
    credentialId: string,
  ): Promise<Result<ScopeSetType, SignetError>>;
}

/** Seal lifecycle: issue, refresh, revoke, query. */
export interface SealManager {
  /** Issue a seal for a credential in a chat. */
  issue(
    credentialId: string,
    chatId: string,
  ): Promise<Result<SealEnvelopeType, SignetError>>;

  /** Refresh an existing seal. */
  refresh(sealId: string): Promise<Result<SealEnvelopeType, SignetError>>;

  /** Revoke a seal with the given reason. */
  revoke(
    sealId: string,
    reason: AgentRevocationReason,
  ): Promise<Result<void, SignetError>>;

  /** Get the current seal for a credential in a chat. */
  current(
    credentialId: string,
    chatId: string,
  ): Promise<Result<SealEnvelopeType | null, SignetError>>;
}
