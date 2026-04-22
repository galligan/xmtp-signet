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
  SdkGroupMemberShape,
  SdkDecodedMessageShape,
  SdkAsyncStreamProxyShape,
  SdkDmShape,
  SdkGroupShape,
  SdkClientShape,
} from "../sdk/sdk-types.js";

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
    imageUrl: string;
    isActive: boolean;
    createdAtNs: bigint;
    members: SdkGroupMemberShape[];
  }>,
): SdkGroupShape {
  const id = overrides?.id ?? "group-1";
  const name = overrides?.name ?? "Test Group";
  const description = overrides?.description ?? "A test group";
  const imageUrl = overrides?.imageUrl;
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
    imageUrl,
    isActive,
    createdAtNs,
    createdAt: new Date(Number(createdAtNs / 1_000_000n)),
    members: async () => membersList,
    sync: async () => {},
    sendText: async (_text: string) => `msg-${Date.now()}`,
    send: async (_encoded: unknown) => `msg-${Date.now()}`,
    sendReaction: async (_reaction) => `msg-${Date.now()}`,
    sendReadReceipt: async () => `msg-${Date.now()}`,
    sendReply: async (_reply) => `msg-${Date.now()}`,
    addMembers: async (_inboxIds: string[]) => {},
    removeMembers: async (_inboxIds: string[]) => {},
    updateName: async (_name: string) => {},
    updateDescription: async (_description: string) => {},
    updateImageUrl: async (_imageUrl: string) => {},
    leaveGroup: async () => {},
    addAdmin: async (_inboxId: string) => {},
    removeAdmin: async (_inboxId: string) => {},
    addSuperAdmin: async (_inboxId: string) => {},
    removeSuperAdmin: async (_inboxId: string) => {},
    messages: async () => [],
    stream: async () => createMockAsyncStreamProxy<SdkDecodedMessageShape>([]),
    metadata: async () => ({
      creatorInboxId: "creator-inbox",
      conversationType: "group" as const,
    }),
  };
}

/** Create a mock DM. */
export function createMockDm(
  overrides?: Partial<{
    id: string;
    peerInboxId: string;
  }>,
): SdkDmShape {
  const dm = createMockGroup({ id: overrides?.id ?? "dm-1", name: "" });
  return {
    ...dm,
    peerInboxId: overrides?.peerInboxId ?? "peer-inbox-1",
    metadata: async () => ({
      creatorInboxId: "creator-inbox",
      conversationType: "dm" as const,
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

  const consentStore = new Map<string, "Unknown" | "Allowed" | "Denied">();

  return {
    inboxId: overrides?.inboxId ?? "test-inbox-id",
    installationId: overrides?.installationId ?? "test-installation-id",
    conversations: {
      getConversationById: async (id: string) => groupMap.get(id),
      getMessageById: (_id: string) => undefined,
      list: async () => groups,
      listGroups: () => groups,
      createDm: async (_inboxId: string) =>
        createMockGroup({ id: `dm-${Date.now()}` }),
      createGroup: async (
        inboxIds: string[],
        opts?: { name?: string; groupName?: string },
      ) =>
        createMockGroup({
          id: `group-${Date.now()}`,
          name: opts?.groupName ?? opts?.name,
        }),
      sync: async () => {},
      syncAll: async () => ({ numConversations: groups.length }),
      stream: async () => createMockAsyncStreamProxy<SdkGroupShape>([]),
      streamGroups: async () => createMockAsyncStreamProxy<SdkGroupShape>([]),
      streamDms: async () => createMockAsyncStreamProxy<SdkDmShape>([]),
      streamAllMessages: async () =>
        createMockAsyncStreamProxy<SdkDecodedMessageShape>([]),
      streamAllGroupMessages: async () =>
        createMockAsyncStreamProxy<SdkDecodedMessageShape>([]),
    },
    preferences: {
      getConsentState: async (_entityType: string, entity: string) =>
        consentStore.get(entity) ?? ("Unknown" as const),
      setConsentStates: async (
        records: { entity: string; state: string }[],
      ) => {
        for (const r of records) {
          consentStore.set(
            r.entity,
            r.state as "Unknown" | "Allowed" | "Denied",
          );
        }
      },
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
