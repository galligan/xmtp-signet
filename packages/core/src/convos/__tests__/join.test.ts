import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import protobuf from "protobufjs";
import Long from "long";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { InternalError } from "@xmtp/signet-schemas";
import { SqliteIdentityStore } from "../../identity-store.js";
import type {
  XmtpClient,
  XmtpClientFactory,
  XmtpGroupInfo,
  SignerProviderLike,
} from "../../xmtp-client-factory.js";
import { joinConversation, type JoinConversationDeps } from "../join.js";

// --- Protobuf setup (same as invite-parser tests) ---

protobuf.util.Long = Long;
protobuf.configure();

const InvitePayloadType = new protobuf.Type("InvitePayload")
  .add(new protobuf.Field("conversationToken", 1, "bytes"))
  .add(new protobuf.Field("creatorInboxId", 2, "bytes"))
  .add(new protobuf.Field("tag", 3, "string"))
  .add(new protobuf.Field("name", 4, "string", "optional"))
  .add(new protobuf.Field("description", 5, "string", "optional"))
  .add(new protobuf.Field("imageURL", 6, "string", "optional"))
  .add(
    new protobuf.Field("conversationExpiresAtUnix", 7, "sfixed64", "optional"),
  )
  .add(new protobuf.Field("expiresAtUnix", 8, "sfixed64", "optional"))
  .add(new protobuf.Field("expiresAfterUse", 9, "bool"));

const SignedInviteType = new protobuf.Type("SignedInvite")
  .add(new protobuf.Field("payload", 1, "bytes"))
  .add(new protobuf.Field("signature", 2, "bytes"));

new protobuf.Root().add(InvitePayloadType).add(SignedInviteType);

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function base64UrlEncode(data: Uint8Array): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const TEST_PRIVATE_KEY = new Uint8Array(32);
TEST_PRIVATE_KEY[31] = 1;

const TEST_CREATOR_INBOX_ID =
  "aabbccddee1122334455667788990011aabbccddee1122334455667788990011";

const TEST_DB_KEY = new Uint8Array(32).fill(0xab);
const TEST_SIGNER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

function buildTestSlug(): string {
  const payloadBytes = InvitePayloadType.encode(
    InvitePayloadType.create({
      conversationToken: new Uint8Array([1, 2, 3, 4, 5]),
      creatorInboxId: hexToBytes(TEST_CREATOR_INBOX_ID),
      tag: "test-join-tag",
      name: "Test Group",
      expiresAfterUse: false,
    }),
  ).finish();

  const hash = sha256(payloadBytes);
  const sig = secp256k1.sign(hash, TEST_PRIVATE_KEY);
  const compact = sig.toCompactRawBytes();
  const signature = new Uint8Array(65);
  signature.set(compact, 0);
  signature[64] = sig.recovery;

  const signedBytes = SignedInviteType.encode(
    SignedInviteType.create({ payload: payloadBytes, signature }),
  ).finish();

  return base64UrlEncode(signedBytes);
}

function buildTestUrl(): string {
  return `https://popup.convos.org/v2?i=${encodeURIComponent(buildTestSlug())}`;
}

// --- Mock helpers ---

function createMockSignerProvider(): SignerProviderLike {
  return {
    sign: () => Promise.resolve(Result.ok(new Uint8Array(64))),
    getPublicKey: () => Promise.resolve(Result.ok(new Uint8Array(32))),
    getFingerprint: () => Promise.resolve(Result.ok("mock-fingerprint")),
    getDbEncryptionKey: () => Promise.resolve(Result.ok(TEST_DB_KEY)),
    getXmtpIdentityKey: () => Promise.resolve(Result.ok(TEST_SIGNER_KEY)),
  };
}

function createMockClient(options?: {
  inboxId?: string;
  onCreateDm?: (peerInboxId: string) => void;
  onSendDm?: (dmId: string, text: string) => void;
  groupsAfterSync?: XmtpGroupInfo[];
  syncCount?: { value: number };
}): XmtpClient {
  const inboxId = options?.inboxId ?? "joiner-inbox-123";
  const syncCount = options?.syncCount ?? { value: 0 };
  const groupsAfterSync = options?.groupsAfterSync ?? [];
  const notImplemented = () => {
    throw new Error("Not implemented in test stub");
  };

  return {
    inboxId,
    sendMessage: notImplemented,
    createDm: async (peerInboxId) => {
      options?.onCreateDm?.(peerInboxId);
      return Result.ok({ dmId: "dm-1", peerInboxId });
    },
    sendDmMessage: async (dmId, text) => {
      options?.onSendDm?.(dmId, text);
      return Result.ok("dm-msg-1");
    },
    syncAll: async () => {
      syncCount.value++;
      return Result.ok();
    },
    syncGroup: notImplemented,
    getGroupInfo: notImplemented,
    listGroups: async () => {
      // Return groups only after sync has been called (simulating acceptance)
      if (syncCount.value > 0 && groupsAfterSync.length > 0) {
        return Result.ok(groupsAfterSync);
      }
      return Result.ok([]);
    },
    createGroup: notImplemented,
    addMembers: notImplemented,
    removeMembers: notImplemented,
    streamAllMessages: notImplemented,
    streamGroups: notImplemented,
  };
}

function createMockFactory(client: XmtpClient): XmtpClientFactory {
  return {
    create: () => Promise.resolve(Result.ok(client)),
  };
}

function createDeps(overrides?: {
  client?: XmtpClient;
  identityStore?: SqliteIdentityStore;
}): JoinConversationDeps {
  const client =
    overrides?.client ??
    createMockClient({
      groupsAfterSync: [
        {
          groupId: "joined-group-1",
          name: "Test Group",
          description: "",
          memberInboxIds: ["joiner-inbox-123", TEST_CREATOR_INBOX_ID],
          createdAt: new Date().toISOString(),
        },
      ],
    });

  return {
    identityStore:
      overrides?.identityStore ?? new SqliteIdentityStore(":memory:"),
    clientFactory: createMockFactory(client),
    signerProviderFactory: () => createMockSignerProvider(),
    config: {
      dataDir: ":memory:",
      env: "dev",
      appVersion: "xmtp-signet/test",
    },
  };
}

describe("joinConversation", () => {
  test("successful join flow: creates identity, DMs slug, discovers group", async () => {
    const dmCalls: Array<{ peerInboxId: string }> = [];
    const sendCalls: Array<{ dmId: string; text: string }> = [];

    const client = createMockClient({
      onCreateDm: (peerInboxId) => dmCalls.push({ peerInboxId }),
      onSendDm: (dmId, text) => sendCalls.push({ dmId, text }),
      groupsAfterSync: [
        {
          groupId: "joined-group-1",
          name: "Test Group",
          description: "",
          memberInboxIds: ["joiner-inbox-123", TEST_CREATOR_INBOX_ID],
          createdAt: new Date().toISOString(),
        },
      ],
    });

    const deps = createDeps({ client });
    const inviteUrl = buildTestUrl();

    const result = await joinConversation(deps, inviteUrl, {
      label: "test-agent",
      pollIntervalMs: 10,
      maxPollAttempts: 3,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.groupId).toBe("joined-group-1");
    expect(result.value.identityId).toBeDefined();

    // Verify DM was sent to creator
    expect(dmCalls).toHaveLength(1);
    expect(dmCalls[0]?.peerInboxId).toBe(TEST_CREATOR_INBOX_ID);

    // Verify slug was sent as DM text
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]?.dmId).toBe("dm-1");

    // Verify identity was persisted
    const identities = await deps.identityStore.list();
    expect(identities).toHaveLength(1);
    expect(identities[0]?.inboxId).toBe("joiner-inbox-123");
  });

  test("returns error when invite URL is invalid", async () => {
    const deps = createDeps();

    const result = await joinConversation(deps, "not-a-valid-invite");
    expect(result.isErr()).toBe(true);
  });

  test("returns error when invite is expired", async () => {
    // Build an expired invite
    const pastTime = BigInt(Math.floor(Date.now() / 1000) - 3600);
    const payloadBytes = InvitePayloadType.encode(
      InvitePayloadType.create({
        conversationToken: new Uint8Array([1, 2, 3]),
        creatorInboxId: hexToBytes(TEST_CREATOR_INBOX_ID),
        tag: "expired-tag",
        expiresAfterUse: false,
        expiresAtUnix: new Long(
          Number(pastTime & 0xffffffffn),
          Number((pastTime >> 32n) & 0xffffffffn),
          false,
        ),
      }),
    ).finish();

    const hash = sha256(payloadBytes);
    const sig = secp256k1.sign(hash, TEST_PRIVATE_KEY);
    const compact = sig.toCompactRawBytes();
    const signature = new Uint8Array(65);
    signature.set(compact, 0);
    signature[64] = sig.recovery;

    const signedBytes = SignedInviteType.encode(
      SignedInviteType.create({ payload: payloadBytes, signature }),
    ).finish();

    const slug = base64UrlEncode(signedBytes);
    const url = `https://popup.convos.org/v2?i=${encodeURIComponent(slug)}`;

    const deps = createDeps();
    const result = await joinConversation(deps, url);

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.message).toContain("expired");
  });

  test("times out when group is never discovered", async () => {
    // Client that never returns groups
    const client = createMockClient({
      groupsAfterSync: [], // Never discovers a group
    });

    const deps = createDeps({ client });
    const inviteUrl = buildTestUrl();

    const result = await joinConversation(deps, inviteUrl, {
      pollIntervalMs: 10,
      maxPollAttempts: 2,
    });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.category).toBe("timeout");
  });

  test("cleans up identity on factory failure", async () => {
    const failingFactory: XmtpClientFactory = {
      create: () =>
        Promise.resolve(
          Result.err(InternalError.create("Network unreachable")),
        ),
    };

    const store = new SqliteIdentityStore(":memory:");
    const deps: JoinConversationDeps = {
      identityStore: store,
      clientFactory: failingFactory,
      signerProviderFactory: () => createMockSignerProvider(),
      config: {
        dataDir: ":memory:",
        env: "dev",
        appVersion: "xmtp-signet/test",
      },
    };

    const result = await joinConversation(deps, buildTestUrl());

    expect(result.isErr()).toBe(true);

    // Identity should have been cleaned up
    const identities = await store.list();
    expect(identities).toHaveLength(0);
  });
});
