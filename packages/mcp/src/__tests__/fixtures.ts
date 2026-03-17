import { z } from "zod";
import { Result } from "better-result";
import { NotFoundError } from "@xmtp/signet-schemas";
import type {
  ActionSpec,
  ActionRegistry,
  SessionManager,
  SessionRecord,
  McpSurface,
  HandlerContext,
  SignerProvider,
} from "@xmtp/signet-contracts";
import { createActionRegistry } from "@xmtp/signet-contracts";

// ---------------------------------------------------------------------------
// Session fixtures
// ---------------------------------------------------------------------------

export function makeSessionRecord(
  overrides: Partial<SessionRecord> = {},
): SessionRecord {
  return {
    sessionId: "sess_test",
    agentInboxId: "agent_test",
    sessionKeyFingerprint: "fp_test",
    view: {
      mode: "full",
      threadScopes: [{ groupId: "g1", threadId: null }],
      contentTypes: ["xmtp.org/text:1.0"],
    },
    grant: {
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
    },
    state: "active",
    issuedAt: "2024-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
    lastHeartbeat: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock SessionManager
// ---------------------------------------------------------------------------

export interface MockSessionManagerState {
  sessions: Map<string, SessionRecord>;
  tokenMap: Map<string, string>; // token -> sessionId
}

export function createMockSessionManager(
  validToken = "valid_token",
  record: SessionRecord = makeSessionRecord(),
): SessionManager & { _state: MockSessionManagerState } {
  const sessions = new Map<string, SessionRecord>();
  sessions.set(record.sessionId, record);
  const tokenMap = new Map<string, string>();
  tokenMap.set(validToken, record.sessionId);

  return {
    _state: { sessions, tokenMap },
    async issue() {
      return Result.ok({
        token: validToken,
        session: {
          sessionId: record.sessionId,
          agentInboxId: record.agentInboxId,
          sessionKeyFingerprint: record.sessionKeyFingerprint,
          issuedAt: record.issuedAt,
          expiresAt: record.expiresAt,
        },
      });
    },
    async list(agentInboxId?: string) {
      const records = [...sessions.values()].filter(
        (session) =>
          agentInboxId === undefined || session.agentInboxId === agentInboxId,
      );
      return Result.ok(records);
    },
    async lookup(sessionId: string) {
      const s = sessions.get(sessionId);
      if (!s) return Result.err(NotFoundError.create("session", sessionId));
      return Result.ok(s);
    },
    async lookupByToken(token: string) {
      const sessionId = tokenMap.get(token);
      if (!sessionId) {
        return Result.err(NotFoundError.create("session", token));
      }
      const s = sessions.get(sessionId);
      if (!s) return Result.err(NotFoundError.create("session", token));
      return Result.ok(s);
    },
    async revoke() {
      return Result.ok(undefined);
    },
    async heartbeat() {
      return Result.ok(undefined);
    },
    async isActive(sessionId: string) {
      const s = sessions.get(sessionId);
      return Result.ok(s?.state === "active");
    },
  };
}

// ---------------------------------------------------------------------------
// Mock SignerProvider
// ---------------------------------------------------------------------------

export function createMockSignerProvider(): SignerProvider {
  return {
    async sign() {
      return Result.ok(new Uint8Array([1, 2, 3]));
    },
    async getPublicKey() {
      return Result.ok(new Uint8Array([4, 5, 6]));
    },
    async getFingerprint() {
      return Result.ok("fp_mock");
    },
    async getDbEncryptionKey() {
      return Result.ok(new Uint8Array(32));
    },
  };
}

// ---------------------------------------------------------------------------
// ActionSpec factories
// ---------------------------------------------------------------------------

const MessageSendInputSchema = z.object({
  conversationId: z.string(),
  content: z.object({ text: z.string() }),
});

const MessageSendOutputSchema = z.object({
  messageId: z.string(),
});

const MessageListInputSchema = z.object({
  conversationId: z.string(),
  limit: z.number().int().positive().optional(),
});

const MessageListOutputSchema = z.object({
  messages: z.array(z.object({ messageId: z.string(), text: z.string() })),
});

export function createTestActionSpec(
  id: string,
  mcp?: McpSurface,
): ActionSpec<unknown, unknown> {
  return {
    id,
    handler: async (_input: unknown, _ctx: HandlerContext) => {
      return Result.ok({ messageId: "msg_test" });
    },
    input: MessageSendInputSchema,
    output: MessageSendOutputSchema,
    mcp,
  };
}

export function createSendSpec(
  handlerOverride?: ActionSpec<unknown, unknown>["handler"],
): ActionSpec<unknown, unknown> {
  return {
    id: "message.send",
    handler: handlerOverride ?? (async () => Result.ok({ messageId: "msg_1" })),
    input: MessageSendInputSchema,
    output: MessageSendOutputSchema,
    mcp: {
      toolName: "signet/message/send",
      description: "Send a message to a conversation",
      readOnly: false,
    },
  };
}

export function createListSpec(
  handlerOverride?: ActionSpec<unknown, unknown>["handler"],
): ActionSpec<unknown, unknown> {
  return {
    id: "message.list",
    handler:
      handlerOverride ??
      (async () =>
        Result.ok({
          messages: [{ messageId: "msg_1", text: "hello" }],
        })),
    input: MessageListInputSchema,
    output: MessageListOutputSchema,
    mcp: {
      toolName: "signet/message/list",
      description: "List messages in a conversation",
      readOnly: true,
    },
  };
}

export function createReadOnlySpec(): ActionSpec<unknown, unknown> {
  return {
    id: "conversation.list",
    handler: async () => Result.ok({ conversations: [] }),
    input: z.object({}),
    mcp: {
      toolName: "signet/conversation/list",
      description: "List conversations",
      readOnly: true,
    },
  };
}

export function createDestructiveSpec(): ActionSpec<unknown, unknown> {
  return {
    id: "conversation.delete",
    handler: async () => Result.ok(undefined),
    input: z.object({ conversationId: z.string() }),
    mcp: {
      toolName: "signet/conversation/delete",
      description: "Delete a conversation",
      readOnly: false,
      destructive: true,
    },
  };
}

export function createAdminOnlySpec(): ActionSpec<unknown, unknown> {
  return {
    id: "session.revoke",
    handler: async () => Result.ok(undefined),
    input: z.object({ sessionId: z.string() }),
    // No mcp metadata -- admin only
    cli: {
      command: "session:revoke",
      options: [
        {
          flag: "--session-id <id>",
          description: "Session ID",
          field: "sessionId",
          required: true,
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Registry helpers
// ---------------------------------------------------------------------------

export function createTestRegistry(
  specs?: readonly ActionSpec<unknown, unknown>[],
): ActionRegistry {
  const registry = createActionRegistry();
  const defaultSpecs = specs ?? [createSendSpec(), createListSpec()];
  for (const spec of defaultSpecs) {
    registry.register(spec);
  }
  return registry;
}
