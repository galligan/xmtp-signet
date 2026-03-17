import { Result } from "better-result";
import type {
  HarnessRequest,
  IssuedSession,
  SessionToken,
} from "@xmtp/signet-schemas";
import { AuthError, NotFoundError } from "@xmtp/signet-schemas";
import type {
  SignetCore,
  SessionManager,
  SealManager,
  SessionRecord,
} from "@xmtp/signet-contracts";
import type { WsServerDeps } from "../server.js";

/** Default session record used in tests. */
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
    expiresAt: "2024-01-02T00:00:00Z",
    lastHeartbeat: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makeSessionToken(
  record: SessionRecord = makeSessionRecord(),
): SessionToken {
  return {
    sessionId: record.sessionId,
    agentInboxId: record.agentInboxId,
    sessionKeyFingerprint: record.sessionKeyFingerprint,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
  };
}

export function makeIssuedSession(
  token = "valid_token",
  record: SessionRecord = makeSessionRecord(),
): IssuedSession {
  return {
    token,
    session: makeSessionToken(record),
  };
}

/** Creates a mock SessionManager that recognizes one token. */
export function createMockSessionManager(
  validToken = "valid_token",
  record: SessionRecord = makeSessionRecord(),
): SessionManager {
  const sessions = new Map<string, SessionRecord>();
  sessions.set(record.sessionId, record);

  return {
    async issue() {
      return Result.ok(makeIssuedSession(validToken, record));
    },
    async list(agentInboxId?: string) {
      return Result.ok(
        [...sessions.values()].filter(
          (session) =>
            agentInboxId === undefined || session.agentInboxId === agentInboxId,
        ),
      );
    },
    async lookup(sessionId: string) {
      const s = sessions.get(sessionId);
      if (!s) return Result.err(NotFoundError.create("session", sessionId));
      return Result.ok(s);
    },
    async lookupByToken(token: string) {
      if (token !== validToken) {
        return Result.err(NotFoundError.create("session", token));
      }
      return Result.ok(record);
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
    // Non-standard: token lookup for the WS layer
    _validToken: validToken,
    _record: record,
  } as SessionManager & { _validToken: string; _record: SessionRecord };
}

/** Creates a mock SignetCore. */
export function createMockSignetCore(): SignetCore {
  return {
    state: "ready",
    async initializeLocal() {
      return Result.ok(undefined);
    },
    async initialize() {
      return Result.ok(undefined);
    },
    async shutdown() {
      return Result.ok(undefined);
    },
    async sendMessage() {
      return Result.ok({ messageId: "msg_test" });
    },
    async getGroupInfo() {
      return Result.ok({
        groupId: "g1",
        identityKeyFingerprint: "fp_g1",
        memberInboxIds: ["agent_test"],
        createdAt: "2024-01-01T00:00:00Z",
      });
    },
  };
}

/** Creates a mock SealManager. */
export function createMockSealManager(): SealManager {
  return {
    async issue() {
      return Result.ok({
        envelope: {
          seal: {},
          signature: new Uint8Array(),
          publicKey: new Uint8Array(),
        },
      } as never);
    },
    async refresh() {
      return Result.ok({} as never);
    },
    async revoke() {
      return Result.ok(undefined);
    },
    async current() {
      return Result.ok(null);
    },
  };
}

/** Creates a full WsServerDeps mock. */
export function createMockDeps(validToken = "valid_token"): {
  deps: WsServerDeps;
  sessionRecord: SessionRecord;
} {
  const sessionRecord = makeSessionRecord();
  const sessionManager = createMockSessionManager(validToken, sessionRecord);
  return {
    deps: {
      sessionManager,
      core: createMockSignetCore(),
      sealManager: createMockSealManager(),
      tokenLookup: async (token: string) => {
        if (
          token ===
          (sessionManager as SessionManager & { _validToken: string })
            ._validToken
        ) {
          return Result.ok(sessionRecord);
        }
        return Result.err(AuthError.create("Invalid token"));
      },
      requestHandler: async (
        request: HarnessRequest,
        _session: SessionRecord,
      ) => {
        if (request.type === "heartbeat") {
          return Result.ok(null);
        }
        return Result.ok({ messageId: "msg_test" });
      },
    },
    sessionRecord,
  };
}

/** Wait for a WebSocket message, parsed as JSON. */
export function nextMessage(ws: WebSocket, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timeout waiting for message")),
      timeoutMs,
    );

    const handler = (event: MessageEvent) => {
      clearTimeout(timer);
      ws.removeEventListener("message", handler);
      resolve(JSON.parse(event.data as string));
    };

    ws.addEventListener("message", handler);
  });
}

/** Wait for WebSocket close event. */
export function waitForClose(
  ws: WebSocket,
  timeoutMs = 5000,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timeout waiting for close")),
      timeoutMs,
    );

    const handler = (event: CloseEvent) => {
      clearTimeout(timer);
      ws.removeEventListener("close", handler);
      resolve({ code: event.code, reason: event.reason });
    };

    ws.addEventListener("close", handler);
  });
}

/** Wait for WebSocket to open. */
export function waitForOpen(ws: WebSocket, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    const timer = setTimeout(
      () => reject(new Error("Timeout waiting for open")),
      timeoutMs,
    );

    const handler = () => {
      clearTimeout(timer);
      ws.removeEventListener("open", handler);
      resolve();
    };

    ws.addEventListener("open", handler);
  });
}

/** Collect N messages from a WebSocket. */
export function collectMessages(
  ws: WebSocket,
  count: number,
  timeoutMs = 5000,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const messages: unknown[] = [];
    const timer = setTimeout(
      () =>
        reject(
          new Error(`Timeout: collected ${messages.length}/${count} messages`),
        ),
      timeoutMs,
    );

    const handler = (event: MessageEvent) => {
      messages.push(JSON.parse(event.data as string));
      if (messages.length >= count) {
        clearTimeout(timer);
        ws.removeEventListener("message", handler);
        resolve(messages);
      }
    };

    ws.addEventListener("message", handler);
  });
}
