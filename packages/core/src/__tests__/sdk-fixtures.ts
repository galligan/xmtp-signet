/**
 * Mock factories for testing the SDK integration layer.
 *
 * Structural types live in `../sdk/sdk-types.ts`. This file provides
 * factory functions that create mock instances conforming to those types.
 */
import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import type { SignerProviderLike } from "../xmtp-client-factory.js";
import type {
  SdkIdentifierShape,
  SdkGroupMemberShape,
  SdkContentTypeIdShape,
  SdkDecodedMessageShape,
  SdkAsyncStreamProxyShape,
  SdkGroupShape,
  SdkConversationsShape,
  SdkClientShape,
} from "../sdk/sdk-types.js";

// Re-export structural types under their legacy "Mock" names for backward
// compatibility with tests that import from this file.
export type MockIdentifier = SdkIdentifierShape;
export type MockGroupMember = SdkGroupMemberShape;
export type MockContentTypeId = SdkContentTypeIdShape;
export type MockDecodedMessage = SdkDecodedMessageShape;
export type MockAsyncStreamProxy<T> = SdkAsyncStreamProxyShape<T>;
export type MockGroup = SdkGroupShape;
export type MockConversations = SdkConversationsShape;
export type MockSdkClient = SdkClientShape;

// ---- Factory functions ----

/** Create a mock decoded message. */
export function createMockDecodedMessage(
  overrides?: Partial<SdkDecodedMessageShape>,
): SdkDecodedMessageShape {
  const now = Date.now();
  return {
    content: overrides?.content ?? "hello",
    contentType: overrides?.contentType ?? {
      authorityId: "xmtp.org",
      typeId: "text",
      versionMajor: 1,
      versionMinor: 0,
    },
    conversationId: overrides?.conversationId ?? "group-1",
    deliveryStatus: overrides?.deliveryStatus ?? "published",
    id: overrides?.id ?? `msg-${now}`,
    kind: overrides?.kind ?? "application",
    senderInboxId: overrides?.senderInboxId ?? "sender-inbox-1",
    sentAt: overrides?.sentAt ?? new Date(now),
    sentAtNs: overrides?.sentAtNs ?? BigInt(now) * 1_000_000n,
  };
}

/** Create a mock group. */
export function createMockGroup(
  overrides?: Partial<{
    id: string;
    name: string;
    description: string;
    isActive: boolean;
    createdAtNs: bigint;
    members: SdkGroupMemberShape[];
  }>,
): SdkGroupShape {
  const id = overrides?.id ?? "group-1";
  const name = overrides?.name ?? "Test Group";
  const description = overrides?.description ?? "A test group";
  const isActive = overrides?.isActive ?? true;
  const createdAtNs = overrides?.createdAtNs ?? BigInt(Date.now()) * 1_000_000n;
  const membersList: SdkGroupMemberShape[] = overrides?.members ?? [
    {
      inboxId: "member-1",
      accountIdentifiers: [],
      installationIds: [],
      permissionLevel: "member",
    },
  ];

  return {
    id,
    name,
    description,
    isActive,
    createdAtNs,
    createdAt: new Date(Number(createdAtNs / 1_000_000n)),
    members: async () => membersList,
    sync: async () => {},
    sendText: async (_text: string) => `msg-${Date.now()}`,
    send: async (_encoded: unknown) => `msg-${Date.now()}`,
    addMembers: async (_inboxIds: string[]) => {},
    removeMembers: async (_inboxIds: string[]) => {},
    messages: async () => [],
    stream: async () => createMockAsyncStreamProxy<SdkDecodedMessageShape>([]),
    metadata: async () => ({
      creatorInboxId: "creator-inbox",
      conversationType: "group" as const,
    }),
  };
}

/** Create a mock SDK client. */
export function createMockSdkNativeClient(
  overrides?: Partial<{
    inboxId: string;
    installationId: string;
    groups: SdkGroupShape[];
  }>,
): SdkClientShape {
  const groups = overrides?.groups ?? [];
  const groupMap = new Map(groups.map((g) => [g.id, g]));

  return {
    inboxId: overrides?.inboxId ?? "test-inbox-id",
    installationId: overrides?.installationId ?? "test-installation-id",
    conversations: {
      getConversationById: async (id: string) => groupMap.get(id),
      list: async () => groups,
      listGroups: () => groups,
      sync: async () => {},
      syncAll: async () => ({ numConversations: groups.length }),
      stream: async () => createMockAsyncStreamProxy<SdkGroupShape>([]),
      streamGroups: async () => createMockAsyncStreamProxy<SdkGroupShape>([]),
      streamAllMessages: async () =>
        createMockAsyncStreamProxy<SdkDecodedMessageShape>([]),
      streamAllGroupMessages: async () =>
        createMockAsyncStreamProxy<SdkDecodedMessageShape>([]),
    },
  };
}

/** Create a mock AsyncStreamProxy that yields the given items. */
export function createMockAsyncStreamProxy<T>(
  items: T[],
): SdkAsyncStreamProxyShape<T> {
  let index = 0;
  let done = false;

  const proxy: SdkAsyncStreamProxyShape<T> = {
    get isDone() {
      return done;
    },
    async next() {
      if (done || index >= items.length) {
        done = true;
        return { value: undefined as unknown as T, done: true };
      }
      const value = items[index]!;
      index++;
      return { value, done: false };
    },
    async return() {
      done = true;
      return { value: undefined, done: true };
    },
    async end() {
      done = true;
      return { value: undefined, done: true };
    },
    [Symbol.asyncIterator]() {
      return {
        next: () => proxy.next(),
        return: async () => {
          await proxy.return();
          return { value: undefined as unknown as T, done: true as const };
        },
      };
    },
  };

  return proxy;
}

/** A fixed test secp256k1 private key (Hardhat account #0, not secret). */
const TEST_XMTP_IDENTITY_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

/** Create a SignerProviderLike that returns fixed values. */
export function createTestSignerProvider(
  overrides?: Partial<{
    publicKey: Uint8Array;
    signResponse: Uint8Array;
    fingerprint: string;
    dbEncryptionKey: Uint8Array;
    xmtpIdentityKey: `0x${string}`;
    signError: SignetError;
    publicKeyError: SignetError;
  }>,
): SignerProviderLike {
  return {
    sign: async (_data: Uint8Array) => {
      if (overrides?.signError) {
        return Result.err(overrides.signError);
      }
      return Result.ok(overrides?.signResponse ?? new Uint8Array(64).fill(2));
    },
    getPublicKey: async () => {
      if (overrides?.publicKeyError) {
        return Result.err(overrides.publicKeyError);
      }
      return Result.ok(overrides?.publicKey ?? new Uint8Array(32).fill(1));
    },
    getFingerprint: async () =>
      Result.ok(overrides?.fingerprint ?? "test-fingerprint"),
    getDbEncryptionKey: async (_identityId: string) =>
      Result.ok(overrides?.dbEncryptionKey ?? new Uint8Array(32).fill(3)),
    getXmtpIdentityKey: async (_identityId: string) =>
      Result.ok(overrides?.xmtpIdentityKey ?? TEST_XMTP_IDENTITY_KEY),
  };
}
