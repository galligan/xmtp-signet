import { z } from "zod";
import { Result } from "better-result";
import { NotFoundError } from "@xmtp/signet-schemas";
import type {
  ActionSpec,
  ActionRegistry,
  CredentialRecord,
  McpSurface,
  HandlerContext,
  SignerProvider,
} from "@xmtp/signet-contracts";
import { createActionRegistry } from "@xmtp/signet-contracts";
import type { TokenLookup, CredentialLookup } from "../credential-guard.js";

// ---------------------------------------------------------------------------
// Credential fixtures
// ---------------------------------------------------------------------------

export function makeCredentialRecord(
  overrides: Partial<CredentialRecord> = {},
): CredentialRecord {
  return {
    id: "cred_aabbccddeeff0011",
    config: {
      operatorId: "op_aabbccddeeff0011",
      chatIds: ["conv_aabbccddeeff0011"],
      allow: ["send", "reply"],
      deny: [],
    },
    inboxIds: ["inbox_aabbccddeeff0011"],
    credentialId: "cred_aabbccddeeff0011",
    operatorId: "op_aabbccddeeff0011",
    effectiveScopes: {
      allow: ["send", "reply"],
      deny: [],
    },
    status: "active",
    issuedAt: "2024-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
    issuedBy: "op_bbccddeefeedbabe",
    isExpired: false,
    lastHeartbeat: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock credential lookups
// ---------------------------------------------------------------------------

export interface MockCredentialLookups {
  readonly tokenLookup: TokenLookup;
  readonly credentialLookup: CredentialLookup;
  readonly _state: {
    credentials: Map<string, CredentialRecord>;
    tokenMap: Map<string, string>;
  };
}

export function createMockCredentialLookups(
  validToken = "valid_token",
  record: CredentialRecord = makeCredentialRecord(),
): MockCredentialLookups {
  const credentials = new Map<string, CredentialRecord>();
  credentials.set(record.credentialId, record);
  const tokenMap = new Map<string, string>();
  tokenMap.set(validToken, record.credentialId);

  const tokenLookup: TokenLookup = async (token: string) => {
    const credentialId = tokenMap.get(token);
    if (!credentialId) {
      return Result.err(NotFoundError.create("credential", token));
    }
    const credential = credentials.get(credentialId);
    if (!credential) {
      return Result.err(NotFoundError.create("credential", token));
    }
    return Result.ok(credential);
  };

  const credentialLookup: CredentialLookup = async (credentialId: string) => {
    const credential = credentials.get(credentialId);
    if (!credential) {
      return Result.err(NotFoundError.create("credential", credentialId));
    }
    return Result.ok(credential);
  };

  return {
    tokenLookup,
    credentialLookup,
    _state: { credentials, tokenMap },
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
    async getXmtpIdentityKey() {
      return Result.ok(`0x${"11".repeat(32)}` as `0x${string}`);
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
    description: "Send a message to a conversation",
    intent: "write",
    handler: handlerOverride ?? (async () => Result.ok({ messageId: "msg_1" })),
    input: MessageSendInputSchema,
    output: MessageSendOutputSchema,
    mcp: {},
  };
}

export function createListSpec(
  handlerOverride?: ActionSpec<unknown, unknown>["handler"],
): ActionSpec<unknown, unknown> {
  return {
    id: "message.list",
    description: "List messages in a conversation",
    intent: "read",
    handler:
      handlerOverride ??
      (async () =>
        Result.ok({
          messages: [{ messageId: "msg_1", text: "hello" }],
        })),
    input: MessageListInputSchema,
    output: MessageListOutputSchema,
    mcp: {
      toolName: "signet/message/messages",
    },
  };
}

export function createReadOnlySpec(): ActionSpec<unknown, unknown> {
  return {
    id: "chat.list",
    description: "List conversations",
    intent: "read",
    handler: async () => Result.ok({ conversations: [] }),
    input: z.object({}),
    mcp: {},
  };
}

export function createDestructiveSpec(): ActionSpec<unknown, unknown> {
  return {
    id: "chat.delete",
    description: "Delete a conversation",
    intent: "destroy",
    handler: async () => Result.ok(undefined),
    input: z.object({ conversationId: z.string() }),
    mcp: {},
  };
}

export function createAdminOnlySpec(): ActionSpec<unknown, unknown> {
  return {
    id: "credential.revoke",
    handler: async () => Result.ok(undefined),
    input: z.object({ credentialId: z.string() }),
    // No mcp metadata -- admin only
    cli: {
      command: "credential:revoke",
      options: [
        {
          flag: "--credential-id <id>",
          description: "Credential ID",
          field: "credentialId",
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
