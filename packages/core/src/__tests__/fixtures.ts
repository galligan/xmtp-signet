import { Result } from "better-result";
import { NotFoundError } from "@xmtp-broker/schemas";
import type { BrokerError } from "@xmtp-broker/schemas";
import type {
  SignerProviderLike,
  XmtpClient,
  XmtpClientCreateOptions,
  XmtpClientFactory,
  XmtpDecodedMessage,
  XmtpGroupInfo,
} from "../xmtp-client-factory.js";
import type { BrokerCoreConfig } from "../config.js";

/** A fixed test secp256k1 private key (not used for real signing). */
const TEST_XMTP_IDENTITY_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

/** Create a mock SignerProviderLike for testing. */
export function createMockSignerProvider(): SignerProviderLike {
  const publicKey = new Uint8Array(32).fill(1);
  const dbEncKey = new Uint8Array(32);
  crypto.getRandomValues(dbEncKey);
  return {
    sign: async (_data: Uint8Array) => Result.ok(new Uint8Array(64).fill(2)),
    getPublicKey: async () => Result.ok(publicKey),
    getFingerprint: async () => Result.ok("mock-fingerprint"),
    getDbEncryptionKey: async (_identityId: string) => Result.ok(dbEncKey),
    getXmtpIdentityKey: async (_identityId: string) =>
      Result.ok(TEST_XMTP_IDENTITY_KEY),
  };
}

/**
 * Create a signer-provider factory that produces a distinct provider
 * per identityId. Tracks which identityIds were requested.
 */
export function createMockSignerProviderFactory(): {
  factory: (identityId: string) => SignerProviderLike;
  createdFor: string[];
} {
  const createdFor: string[] = [];
  const factory = (identityId: string): SignerProviderLike => {
    createdFor.push(identityId);
    return createMockSignerProvider();
  };
  return { factory, createdFor };
}

/** Create a mock XMTP client for testing. */
export function createMockXmtpClient(options?: {
  inboxId?: string;
  groups?: XmtpGroupInfo[];
}): XmtpClient {
  const inboxId = options?.inboxId ?? "mock-inbox-id";
  const groups = options?.groups ?? [];

  return {
    inboxId,
    sendMessage: async (_groupId, _content) => Result.ok(`msg-${Date.now()}`),
    syncAll: async () => Result.ok(),
    syncGroup: async (_groupId) => Result.ok(),
    getGroupInfo: async (groupId) => {
      const group = groups.find((g) => g.groupId === groupId);
      if (!group) {
        return Result.err(
          NotFoundError.create("group", groupId) as BrokerError,
        );
      }
      return Result.ok(group);
    },
    listGroups: async () => Result.ok(groups),
    createGroup: async (memberInboxIds, opts) =>
      Result.ok({
        groupId: `group-${Date.now()}`,
        name: opts?.name ?? "",
        description: "",
        memberInboxIds: [inboxId, ...memberInboxIds],
        createdAt: new Date().toISOString(),
      }),
    addMembers: async (_groupId, _inboxIds) => Result.ok(),
    removeMembers: async (_groupId, _inboxIds) => Result.ok(),
    streamAllMessages: async () =>
      Result.ok({
        messages: emptyAsyncIterable<XmtpDecodedMessage>(),
        abort: () => {},
      }),
    streamGroups: async () =>
      Result.ok({
        groups: emptyAsyncIterable(),
        abort: () => {},
      }),
  };
}

/** Create a mock XmtpClientFactory for testing. */
export function createMockClientFactory(
  clientOverrides?: Partial<XmtpClient>,
): XmtpClientFactory {
  return {
    create: async (options: XmtpClientCreateOptions) => {
      const base = createMockXmtpClient({
        inboxId: `inbox-${options.identityId}`,
      });
      return Result.ok({ ...base, ...clientOverrides });
    },
  };
}

/** Create a minimal BrokerCoreConfig for testing. */
export function createTestConfig(
  overrides?: Partial<BrokerCoreConfig>,
): BrokerCoreConfig {
  return {
    dataDir: ":memory:",
    env: "dev",
    identityMode: "per-group",
    heartbeatIntervalMs: 30_000,
    syncTimeoutMs: 30_000,
    appVersion: "xmtp-broker/test",
    ...overrides,
  };
}

/** Helper: create an async iterable that yields nothing. */
function emptyAsyncIterable<T>(): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          return { done: true as const, value: undefined as unknown as T };
        },
      };
    },
  };
}

/** Helper: create an async iterable that yields specific items then completes. */
export function asyncIterableOf<T>(...items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (index < items.length) {
            const value = items[index]!;
            index++;
            return { done: false as const, value };
          }
          return { done: true as const, value: undefined as unknown as T };
        },
      };
    },
  };
}
