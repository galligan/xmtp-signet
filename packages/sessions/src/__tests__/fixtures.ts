import type {
  SessionConfig,
  ViewConfig,
  GrantConfig,
} from "@xmtp/signet-schemas";

export const baseView: ViewConfig = {
  mode: "redacted",
  threadScopes: [{ groupId: "group-1", threadId: null }],
  contentTypes: ["text"],
};

export const baseGrant: GrantConfig = {
  messaging: { send: false, reply: false, react: false, draftOnly: true },
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
};

export function createTestSessionConfig(
  overrides?: Partial<SessionConfig>,
): SessionConfig {
  return {
    agentInboxId: "agent-inbox-1",
    view: baseView,
    grant: baseGrant,
    ttlSeconds: 3600,
    heartbeatInterval: 30,
    ...overrides,
  };
}

export function createTestView(overrides?: Partial<ViewConfig>): ViewConfig {
  return { ...baseView, ...overrides };
}

export function createTestGrant(overrides?: Partial<GrantConfig>): GrantConfig {
  return { ...baseGrant, ...overrides };
}
