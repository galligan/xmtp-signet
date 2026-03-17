import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Result } from "better-result";
import { InternalError } from "@xmtp/signet-schemas";
import type { SignetError } from "@xmtp/signet-schemas";
import { SignetCoreImpl } from "../signet-core.js";
import type { CoreRawEvent } from "../raw-events.js";
import type {
  SignerProviderLike,
  XmtpClient,
  XmtpClientCreateOptions,
  XmtpGroupInfo,
} from "../xmtp-client-factory.js";
import {
  createMockSignerProviderFactory,
  createMockClientFactory,
  createMockXmtpClient,
  createTestConfig,
} from "./fixtures.js";

let core: SignetCoreImpl;

function createCore(
  configOverrides?: Parameters<typeof createTestConfig>[0],
  factoryOverrides?: Partial<XmtpClient>,
) {
  const { factory } = createMockSignerProviderFactory();
  return new SignetCoreImpl(
    createTestConfig(configOverrides),
    factory,
    createMockClientFactory(factoryOverrides),
  );
}

beforeEach(() => {
  core = createCore();
});

afterEach(async () => {
  // Ensure cleanup regardless of test state
  if (core.state === "running") {
    await core.stop();
  }
});

describe("SignetCoreImpl", () => {
  describe("initial state", () => {
    test("starts in idle state", () => {
      expect(core.state).toBe("idle");
    });
  });

  describe("start", () => {
    test("transitions from idle to local with startLocal", async () => {
      const result = await core.startLocal();
      expect(result.isOk()).toBe(true);
      expect(core.state).toBe("local");
    });

    test("transitions from idle to running", async () => {
      const result = await core.start();
      expect(result.isOk()).toBe(true);
      expect(core.state).toBe("running");
    });

    test("emits raw.core.started event", async () => {
      const events: CoreRawEvent[] = [];
      core.on((e) => events.push(e));

      await core.start();

      const started = events.find((e) => e.type === "raw.core.started");
      expect(started).toBeDefined();
      if (started?.type === "raw.core.started") {
        expect(started.identityCount).toBeGreaterThanOrEqual(0);
        expect(started.syncedThrough).toBeTruthy();
      }
    });

    test("rejects start from running state", async () => {
      await core.start();
      const result = await core.start();
      expect(result.isErr()).toBe(true);
    });

    test("rejects start from stopped state", async () => {
      await core.start();
      await core.stop();
      const result = await core.start();
      expect(result.isErr()).toBe(true);
    });

    test("fails startup when message stream initialization returns an error", async () => {
      const { factory: signerFactory } = createMockSignerProviderFactory();
      core = new SignetCoreImpl(
        createTestConfig(),
        signerFactory,
        createMockClientFactory({
          streamAllMessages: async () =>
            Result.err(InternalError.create("message stream failed")),
        }),
      );

      await core.identityStore.create(null);

      const result = await core.start();
      expect(result.isErr()).toBe(true);
      expect(core.state).toBe("error");
    });

    test("fails startup when group stream initialization returns an error", async () => {
      const { factory: signerFactory } = createMockSignerProviderFactory();
      core = new SignetCoreImpl(
        createTestConfig(),
        signerFactory,
        createMockClientFactory({
          streamGroups: async () =>
            Result.err(InternalError.create("group stream failed")),
        }),
      );

      await core.identityStore.create(null);

      const result = await core.start();
      expect(result.isErr()).toBe(true);
      expect(core.state).toBe("error");
    });

    test("returns to local state when full startup fails after local init", async () => {
      let failSync = true;
      const { factory: signerFactory } = createMockSignerProviderFactory();
      core = new SignetCoreImpl(
        createTestConfig(),
        signerFactory,
        createMockClientFactory({
          syncAll: async () => {
            if (failSync) {
              failSync = false;
              return Result.err(InternalError.create("sync failed"));
            }
            return Result.ok(undefined);
          },
        }),
      );

      await core.identityStore.create(null);

      const localResult = await core.startLocal();
      expect(localResult.isOk()).toBe(true);
      expect(core.state).toBe("local");

      const firstStart = await core.start();
      expect(firstStart.isErr()).toBe(true);
      expect(core.state).toBe("local");

      const secondStart = await core.start();
      expect(secondStart.isOk()).toBe(true);
      expect(core.state).toBe("running");
    });
  });

  describe("stop", () => {
    test("transitions from running to stopped", async () => {
      await core.start();
      const result = await core.stop();
      expect(result.isOk()).toBe(true);
      expect(core.state).toBe("stopped");
    });

    test("emits raw.core.stopped event", async () => {
      const events: CoreRawEvent[] = [];
      core.on((e) => events.push(e));

      await core.start();
      await core.stop();

      const stopped = events.find((e) => e.type === "raw.core.stopped");
      expect(stopped).toBeDefined();
      if (stopped?.type === "raw.core.stopped") {
        expect(stopped.reason).toBe("shutdown");
      }
    });

    test("rejects stop from idle state", async () => {
      const result = await core.stop();
      expect(result.isErr()).toBe(true);
    });

    test("rejects stop from stopped state", async () => {
      await core.start();
      await core.stop();
      const result = await core.stop();
      expect(result.isErr()).toBe(true);
    });

    test("allows cleanup from error state", async () => {
      const syncError = InternalError.create("sync failed");

      const { factory: signerFactory } = createMockSignerProviderFactory();
      core = new SignetCoreImpl(
        createTestConfig(),
        signerFactory,
        createMockClientFactory({
          syncAll: async () => Result.err(syncError),
        }),
      );

      await core.identityStore.create(null);
      await core.start();

      expect(core.state).toBe("error");

      const result = await core.stop();
      expect(result.isOk()).toBe(true);
      expect(core.state).toBe("stopped");
    });
  });

  describe("event subscription", () => {
    test("on returns unsubscribe function", async () => {
      const events: CoreRawEvent[] = [];
      const unsub = core.on((e) => events.push(e));

      await core.start();
      unsub();
      await core.stop();

      // Should only have the started event, not stopped
      expect(events.some((e) => e.type === "raw.core.started")).toBe(true);
      expect(events.some((e) => e.type === "raw.core.stopped")).toBe(false);
    });
  });

  describe("heartbeat", () => {
    test("emits heartbeat events at configured interval", async () => {
      core = createCore({ heartbeatIntervalMs: 50 });
      const events: CoreRawEvent[] = [];
      core.on((e) => events.push(e));

      await core.start();
      // Wait for at least 2 heartbeats
      await new Promise((resolve) => setTimeout(resolve, 130));
      await core.stop();

      const heartbeats = events.filter((e) => e.type === "raw.heartbeat");
      expect(heartbeats.length).toBeGreaterThanOrEqual(2);
    });

    test("stops heartbeat on shutdown", async () => {
      core = createCore({ heartbeatIntervalMs: 50 });
      const events: CoreRawEvent[] = [];
      core.on((e) => events.push(e));

      await core.start();
      await new Promise((resolve) => setTimeout(resolve, 70));
      await core.stop();

      const countAfterStop = events.filter(
        (e) => e.type === "raw.heartbeat",
      ).length;

      // Wait to confirm no more heartbeats arrive
      await new Promise((resolve) => setTimeout(resolve, 100));
      const countLater = events.filter(
        (e) => e.type === "raw.heartbeat",
      ).length;

      expect(countLater).toBe(countAfterStop);
    });
  });

  describe("context", () => {
    test("provides context for performing actions", () => {
      expect(core.context).toBeDefined();
    });

    test("context methods work after start", async () => {
      await core.start();
      const result = await core.context.listGroups();
      expect(result.isOk()).toBe(true);
    });
  });

  describe("state machine guards", () => {
    test("idle -> starting -> running -> stopping -> stopped", async () => {
      expect(core.state).toBe("idle");

      const startPromise = core.start();
      // The implementation transitions synchronously to starting then running
      const startResult = await startPromise;
      expect(startResult.isOk()).toBe(true);
      expect(core.state).toBe("running");

      const stopPromise = core.stop();
      const stopResult = await stopPromise;
      expect(stopResult.isOk()).toBe(true);
      expect(core.state).toBe("stopped");
    });
  });

  describe("per-identity signer provider (fix 1)", () => {
    test("creates distinct signer providers for each persisted identity", async () => {
      const { factory: signerFactory, createdFor } =
        createMockSignerProviderFactory();

      // Track which options each create() call receives
      const receivedOptions: XmtpClientCreateOptions[] = [];
      const clientFactory = {
        create: async (options: XmtpClientCreateOptions) => {
          receivedOptions.push(options);
          const client = createMockXmtpClient({
            inboxId: `inbox-${options.identityId}`,
          });
          return Result.ok(client) as Result<XmtpClient, SignetError>;
        },
      };

      core = new SignetCoreImpl(
        createTestConfig(),
        signerFactory,
        clientFactory,
      );

      // Seed two identities before starting
      await core.identityStore.create(null);
      await core.identityStore.create(null);

      const result = await core.start();
      expect(result.isOk()).toBe(true);

      // Factory should have been called once per identity
      expect(createdFor.length).toBe(2);
      // Each identity should get its own signer provider
      expect(createdFor[0]).not.toBe(createdFor[1]);
      // The client factory should receive options with signerPrivateKey
      expect(receivedOptions.length).toBe(2);
      expect(receivedOptions[0]!.signerPrivateKey).toBeDefined();
      expect(receivedOptions[1]!.signerPrivateKey).toBeDefined();
    });

    test("each provider is bound to the correct identity id", async () => {
      const requestedIdentityIds: string[] = [];

      const signerFactory = (identityId: string): SignerProviderLike => {
        requestedIdentityIds.push(identityId);
        const publicKey = new Uint8Array(32).fill(1);
        const dbEncKey = new Uint8Array(32);
        crypto.getRandomValues(dbEncKey);
        return {
          sign: async () => Result.ok(new Uint8Array(64).fill(2)),
          getPublicKey: async () => Result.ok(publicKey),
          getFingerprint: async () => Result.ok(`fingerprint-${identityId}`),
          getDbEncryptionKey: async () => Result.ok(dbEncKey),
          getXmtpIdentityKey: async () =>
            Result.ok(
              "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const,
            ),
        };
      };

      core = new SignetCoreImpl(
        createTestConfig(),
        signerFactory,
        createMockClientFactory(),
      );

      // Seed identities and capture their IDs
      const id1Result = await core.identityStore.create(null);
      const id2Result = await core.identityStore.create(null);
      expect(id1Result.isOk()).toBe(true);
      expect(id2Result.isOk()).toBe(true);
      const id1 = id1Result.value.id;
      const id2 = id2Result.value.id;

      await core.start();

      // The factory was called with the actual identity IDs
      expect(requestedIdentityIds).toContain(id1);
      expect(requestedIdentityIds).toContain(id2);
    });
  });

  describe("hydrate shared-mode group membership (fix 2)", () => {
    test("seeds groupIds from listGroups after syncAll", async () => {
      const testGroups: XmtpGroupInfo[] = [
        {
          groupId: "group-a",
          name: "Group A",
          description: "",
          memberInboxIds: [],
          createdAt: new Date().toISOString(),
        },
        {
          groupId: "group-b",
          name: "Group B",
          description: "",
          memberInboxIds: [],
          createdAt: new Date().toISOString(),
        },
      ];

      const { factory: signerFactory } = createMockSignerProviderFactory();
      core = new SignetCoreImpl(
        createTestConfig(),
        signerFactory,
        createMockClientFactory({
          listGroups: async () => Result.ok(testGroups),
          getGroupInfo: async (groupId: string) => {
            const group = testGroups.find((g) => g.groupId === groupId);
            if (!group) {
              return Result.err(InternalError.create("not found")) as Result<
                XmtpGroupInfo,
                SignetError
              >;
            }
            return Result.ok(group);
          },
        }),
      );

      // Seed a shared-mode identity (groupId === null)
      await core.identityStore.create(null);

      const result = await core.start();
      expect(result.isOk()).toBe(true);

      // After start, the context should be able to find groups by ID
      const groupAResult = await core.context.getGroupInfo("group-a");
      expect(groupAResult.isOk()).toBe(true);

      const groupBResult = await core.context.getGroupInfo("group-b");
      expect(groupBResult.isOk()).toBe(true);
    });

    test("operations succeed for hydrated group ids", async () => {
      const testGroups: XmtpGroupInfo[] = [
        {
          groupId: "hydrated-group",
          name: "Hydrated",
          description: "",
          memberInboxIds: [],
          createdAt: new Date().toISOString(),
        },
      ];

      const { factory: signerFactory } = createMockSignerProviderFactory();
      core = new SignetCoreImpl(
        createTestConfig(),
        signerFactory,
        createMockClientFactory({
          listGroups: async () => Result.ok(testGroups),
        }),
      );

      await core.identityStore.create(null);
      await core.start();

      // sendMessage should route to the correct client
      const sendResult = await core.context.sendMessage(
        "hydrated-group",
        "text",
        "hello",
      );
      expect(sendResult.isOk()).toBe(true);
    });

    test("unhydrated group id returns not found", async () => {
      const { factory: signerFactory } = createMockSignerProviderFactory();
      core = new SignetCoreImpl(
        createTestConfig(),
        signerFactory,
        createMockClientFactory({
          listGroups: async () => Result.ok([]),
        }),
      );

      await core.identityStore.create(null);
      await core.start();

      const result = await core.context.sendMessage(
        "nonexistent-group",
        "text",
        "hello",
      );
      expect(result.isErr()).toBe(true);
    });
  });

  describe("listGroups failure at startup", () => {
    test("returns error when listGroups fails", async () => {
      const listError = InternalError.create("listGroups failed");

      const { factory: signerFactory } = createMockSignerProviderFactory();
      core = new SignetCoreImpl(
        createTestConfig(),
        signerFactory,
        createMockClientFactory({
          listGroups: async () => Result.err(listError),
        }),
      );

      await core.identityStore.create(null);

      const result = await core.start();
      expect(result.isErr()).toBe(true);
    });

    test("transitions to error state on listGroups failure", async () => {
      const listError = InternalError.create("listGroups failed");

      const { factory: signerFactory } = createMockSignerProviderFactory();
      core = new SignetCoreImpl(
        createTestConfig(),
        signerFactory,
        createMockClientFactory({
          listGroups: async () => Result.err(listError),
        }),
      );

      await core.identityStore.create(null);
      await core.start();

      expect(core.state).toBe("error");
    });

    test("does not emit raw.core.started on listGroups failure", async () => {
      const listError = InternalError.create("listGroups failed");
      const events: CoreRawEvent[] = [];

      const { factory: signerFactory } = createMockSignerProviderFactory();
      core = new SignetCoreImpl(
        createTestConfig(),
        signerFactory,
        createMockClientFactory({
          listGroups: async () => Result.err(listError),
        }),
      );
      core.on((e) => events.push(e));

      await core.identityStore.create(null);
      await core.start();

      const started = events.find((e) => e.type === "raw.core.started");
      expect(started).toBeUndefined();
    });

    test("does not start heartbeat on listGroups failure", async () => {
      const listError = InternalError.create("listGroups failed");
      const events: CoreRawEvent[] = [];

      const { factory: signerFactory } = createMockSignerProviderFactory();
      core = new SignetCoreImpl(
        createTestConfig({ heartbeatIntervalMs: 10 }),
        signerFactory,
        createMockClientFactory({
          listGroups: async () => Result.err(listError),
        }),
      );
      core.on((e) => events.push(e));

      await core.identityStore.create(null);
      await core.start();

      await new Promise((resolve) => setTimeout(resolve, 50));

      const heartbeats = events.filter((e) => e.type === "raw.heartbeat");
      expect(heartbeats.length).toBe(0);
    });
  });

  describe("syncAll failure (fix 3)", () => {
    test("returns error when syncAll fails", async () => {
      const syncError = InternalError.create("sync failed");

      const { factory: signerFactory } = createMockSignerProviderFactory();
      core = new SignetCoreImpl(
        createTestConfig(),
        signerFactory,
        createMockClientFactory({
          syncAll: async () => Result.err(syncError),
        }),
      );

      // Seed an identity so the startup loop runs
      await core.identityStore.create(null);

      const result = await core.start();
      expect(result.isErr()).toBe(true);
    });

    test("transitions to error state on syncAll failure", async () => {
      const syncError = InternalError.create("sync failed");

      const { factory: signerFactory } = createMockSignerProviderFactory();
      core = new SignetCoreImpl(
        createTestConfig(),
        signerFactory,
        createMockClientFactory({
          syncAll: async () => Result.err(syncError),
        }),
      );

      await core.identityStore.create(null);
      await core.start();

      expect(core.state).toBe("error");
    });

    test("does not emit raw.core.started on syncAll failure", async () => {
      const syncError = InternalError.create("sync failed");
      const events: CoreRawEvent[] = [];

      const { factory: signerFactory } = createMockSignerProviderFactory();
      core = new SignetCoreImpl(
        createTestConfig(),
        signerFactory,
        createMockClientFactory({
          syncAll: async () => Result.err(syncError),
        }),
      );
      core.on((e) => events.push(e));

      await core.identityStore.create(null);
      await core.start();

      const started = events.find((e) => e.type === "raw.core.started");
      expect(started).toBeUndefined();
    });

    test("does not start heartbeat on syncAll failure", async () => {
      const syncError = InternalError.create("sync failed");
      const events: CoreRawEvent[] = [];

      const { factory: signerFactory } = createMockSignerProviderFactory();
      core = new SignetCoreImpl(
        createTestConfig({ heartbeatIntervalMs: 10 }),
        signerFactory,
        createMockClientFactory({
          syncAll: async () => Result.err(syncError),
        }),
      );
      core.on((e) => events.push(e));

      await core.identityStore.create(null);
      await core.start();

      // Wait to see if any heartbeats arrive
      await new Promise((resolve) => setTimeout(resolve, 50));

      const heartbeats = events.filter((e) => e.type === "raw.heartbeat");
      expect(heartbeats.length).toBe(0);
    });
  });

  describe("stream initialization failures", () => {
    test("returns error when streamAllMessages fails", async () => {
      const streamError = InternalError.create("message stream failed");

      const { factory: signerFactory } = createMockSignerProviderFactory();
      core = new SignetCoreImpl(
        createTestConfig(),
        signerFactory,
        createMockClientFactory({
          streamAllMessages: async () => Result.err(streamError),
        }),
      );

      await core.identityStore.create(null);

      const result = await core.start();
      expect(result.isErr()).toBe(true);
      expect(core.state).toBe("error");
    });

    test("returns error when streamGroups fails", async () => {
      const streamError = InternalError.create("group stream failed");

      const { factory: signerFactory } = createMockSignerProviderFactory();
      core = new SignetCoreImpl(
        createTestConfig(),
        signerFactory,
        createMockClientFactory({
          streamGroups: async () => Result.err(streamError),
        }),
      );

      await core.identityStore.create(null);

      const result = await core.start();
      expect(result.isErr()).toBe(true);
      expect(core.state).toBe("error");
    });
  });
});
