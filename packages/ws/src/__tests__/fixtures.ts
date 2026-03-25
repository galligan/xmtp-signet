import { Result } from "better-result";
import type { HarnessRequest, CredentialTokenType } from "@xmtp/signet-schemas";
import { AuthError, NotFoundError } from "@xmtp/signet-schemas";
import type {
  SignetCore,
  CredentialRecord,
  SealManager,
} from "@xmtp/signet-contracts";
import type { WsServerDeps } from "../server.js";

/** Default credential record used in tests. */
export function makeCredentialRecord(
  overrides: Partial<CredentialRecord> = {},
): CredentialRecord {
  return {
    id: "cred_deadbeeffeedbabe",
    config: {
      operatorId: "op_deadbeeffeedbabe",
      chatIds: ["conv_c0ffee12feedbabe"],
      allow: ["send", "reply", "read-messages"],
      deny: [],
    },
    inboxIds: ["inbox_deadbeeffeedbabe"],
    credentialId: "cred_deadbeeffeedbabe",
    operatorId: "op_deadbeeffeedbabe",
    effectiveScopes: {
      allow: ["send", "reply", "read-messages"],
      deny: [],
    },
    status: "active",
    issuedAt: "2024-01-01T00:00:00Z",
    expiresAt: "2024-01-02T00:00:00Z",
    issuedBy: "op_admin1234",
    isExpired: false,
    lastHeartbeat: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makeCredentialToken(
  record: CredentialRecord = makeCredentialRecord(),
): CredentialTokenType {
  return {
    credentialId: record.credentialId,
    operatorId: record.operatorId,
    fingerprint: "fp_test",
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
  };
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
  credentialRecord: CredentialRecord;
} {
  const credentialRecord = makeCredentialRecord();
  return {
    deps: {
      core: createMockSignetCore(),
      credentialLookup: async (credentialId: string) => {
        if (credentialId === credentialRecord.credentialId) {
          return Result.ok(credentialRecord);
        }
        return Result.err(NotFoundError.create("credential", credentialId));
      },
      sealManager: createMockSealManager(),
      tokenLookup: async (token: string) => {
        if (token === validToken) {
          return Result.ok(credentialRecord);
        }
        return Result.err(AuthError.create("Invalid token"));
      },
      requestHandler: async (
        request: HarnessRequest,
        _credential: CredentialRecord,
      ) => {
        if (request.type === "heartbeat") {
          return Result.ok(null);
        }
        return Result.ok({ messageId: "msg_test" });
      },
    },
    credentialRecord,
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
