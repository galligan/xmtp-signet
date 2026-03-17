import type { Seal } from "../seal.js";
import type { ViewConfig } from "../view.js";
import type { GrantConfig } from "../grant.js";
import type { IssuedSession, SessionToken } from "../session.js";

/** Valid seal fixture for testing. */
export function createTestSeal(overrides?: Partial<Seal>): Seal {
  return {
    sealId: "test-att-001",
    previousSealId: null,
    agentInboxId: "test-agent-inbox",
    ownerInboxId: "test-owner-inbox",
    groupId: "test-group-1",
    threadScope: null,
    viewMode: "full",
    contentTypes: ["xmtp.org/text:1.0"],
    grantedOps: ["send", "reply"],
    toolScopes: [],
    inferenceMode: "external",
    inferenceProviders: ["openai"],
    contentEgressScope: "full-messages",
    retentionAtProvider: "session",
    hostingMode: "managed",
    trustTier: "unverified",
    buildProvenanceRef: null,
    verifierStatementRef: null,
    sessionKeyFingerprint: null,
    policyHash: "test-policy-hash",
    heartbeatInterval: 30,
    issuedAt: "2024-01-01T00:00:00Z",
    expiresAt: "2024-01-01T01:00:00Z",
    revocationRules: {
      maxTtlSeconds: 3600,
      requireHeartbeat: true,
      ownerCanRevoke: true,
      adminCanRemove: false,
    },
    issuer: "test-signet-identity",
    ...overrides,
  };
}

/** Valid view config fixture. */
export function createTestViewConfig(
  overrides?: Partial<ViewConfig>,
): ViewConfig {
  return {
    mode: "full",
    threadScopes: [{ groupId: "test-group-1", threadId: null }],
    contentTypes: ["xmtp.org/text:1.0"],
    ...overrides,
  };
}

/** Valid grant config fixture. */
export function createTestGrantConfig(
  overrides?: Partial<GrantConfig>,
): GrantConfig {
  return {
    messaging: { send: true, reply: true, react: true, draftOnly: false },
    groupManagement: {
      addMembers: false,
      removeMembers: false,
      updateMetadata: false,
      inviteUsers: false,
    },
    tools: { scopes: [] },
    egress: {
      storeExcerpts: false,
      useForMemory: false,
      forwardToProviders: false,
      quoteRevealed: false,
      summarize: false,
    },
    ...overrides,
  };
}

/** Valid session token fixture. */
export function createTestSessionToken(
  overrides?: Partial<SessionToken>,
): SessionToken {
  return {
    sessionId: "test-session-001",
    agentInboxId: "test-agent-inbox",
    sessionKeyFingerprint: "test-fingerprint",
    issuedAt: "2024-01-01T00:00:00Z",
    expiresAt: "2024-01-01T01:00:00Z",
    ...overrides,
  };
}

/** Valid issued session fixture. */
export function createTestIssuedSession(
  overrides?: Partial<IssuedSession>,
): IssuedSession {
  return {
    token: "test-bearer-token",
    session: createTestSessionToken(),
    ...overrides,
  };
}
