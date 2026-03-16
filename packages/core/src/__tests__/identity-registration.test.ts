import { describe, expect, test, beforeEach } from "bun:test";
import { Result } from "better-result";
import { SqliteIdentityStore } from "../identity-store.js";
import { registerIdentity } from "../identity-registration.js";
import type { IdentityRegistrationDeps } from "../identity-registration.js";
import type {
  XmtpClient,
  XmtpClientFactory,
  SignerProviderLike,
} from "../xmtp-client-factory.js";
import type { BrokerError } from "@xmtp-broker/schemas";
import { InternalError } from "@xmtp-broker/schemas";

/** Hardhat's first test account private key. */
const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

/** Expected address for the test private key. */
const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

/** 32-byte encryption key for tests. */
const TEST_DB_KEY = new Uint8Array(32).fill(0xab);

function createMockSignerProvider(): SignerProviderLike {
  return {
    sign: () => Promise.resolve(Result.ok(new Uint8Array(64))),
    getPublicKey: () => Promise.resolve(Result.ok(new Uint8Array(32))),
    getFingerprint: () => Promise.resolve(Result.ok("mock-fingerprint")),
    getDbEncryptionKey: () => Promise.resolve(Result.ok(TEST_DB_KEY)),
    getXmtpIdentityKey: () => Promise.resolve(Result.ok(TEST_PRIVATE_KEY)),
  };
}

function createMockClient(inboxId: string): XmtpClient {
  const notImplemented = () => {
    throw new Error("Not implemented in test stub");
  };
  return {
    inboxId,
    sendMessage: notImplemented,
    syncAll: notImplemented,
    syncGroup: notImplemented,
    getGroupInfo: notImplemented,
    listGroups: notImplemented,
    addMembers: notImplemented,
    removeMembers: notImplemented,
    streamAllMessages: notImplemented,
    streamGroups: notImplemented,
  };
}

function createMockFactory(inboxId: string): XmtpClientFactory {
  return {
    create: () => Promise.resolve(Result.ok(createMockClient(inboxId))),
  };
}

function createFailingFactory(error: BrokerError): XmtpClientFactory {
  return {
    create: () => Promise.resolve(Result.err(error)),
  };
}

function createDeps(
  overrides?: Partial<IdentityRegistrationDeps>,
): IdentityRegistrationDeps {
  return {
    identityStore:
      overrides?.identityStore ?? new SqliteIdentityStore(":memory:"),
    clientFactory:
      overrides?.clientFactory ?? createMockFactory("mock-inbox-123"),
    signerProviderFactory:
      overrides?.signerProviderFactory ?? (() => createMockSignerProvider()),
    config: overrides?.config ?? {
      dataDir: ":memory:",
      env: "dev",
      appVersion: "xmtp-broker/test",
    },
  };
}

describe("registerIdentity", () => {
  let deps: IdentityRegistrationDeps;

  beforeEach(() => {
    deps = createDeps();
  });

  test("creates identity and returns inbox ID", async () => {
    const result = await registerIdentity(deps, {});
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.inboxId).toBe("mock-inbox-123");
    expect(result.value.env).toBe("dev");

    // Verify identity store has record with inboxId set
    const stored = await deps.identityStore.getById(result.value.identityId);
    expect(stored).not.toBeNull();
    expect(stored?.inboxId).toBe("mock-inbox-123");
  });

  test("cleans up identity record on factory failure", async () => {
    const failingDeps = createDeps({
      clientFactory: createFailingFactory(
        InternalError.create("XMTP network unreachable"),
      ),
    });

    const result = await registerIdentity(failingDeps, {});
    expect(result.isErr()).toBe(true);

    // Verify identity store is empty after failure
    const list = await failingDeps.identityStore.list();
    expect(list).toHaveLength(0);
  });

  test("stores and retrieves label", async () => {
    const result = await registerIdentity(deps, { label: "my-agent" });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.label).toBe("my-agent");

    // Verify getByLabel returns the identity
    const found = await deps.identityStore.getByLabel("my-agent");
    expect(found).not.toBeNull();
    expect(found?.id).toBe(result.value.identityId);
  });

  test("rejects duplicate label", async () => {
    const result1 = await registerIdentity(deps, { label: "unique-label" });
    expect(result1.isOk()).toBe(true);

    const result2 = await registerIdentity(deps, { label: "unique-label" });
    expect(result2.isErr()).toBe(true);
  });

  test("handles null groupId for shared mode", async () => {
    const result = await registerIdentity(deps, { groupId: null });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const stored = await deps.identityStore.getById(result.value.identityId);
    expect(stored).not.toBeNull();
    expect(stored?.groupId).toBeNull();
  });

  test("computes address from signer key", async () => {
    const result = await registerIdentity(deps, {});
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // Verify it's a valid Ethereum address (0x + 40 hex chars)
    expect(result.value.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // Verify it matches expected address for test key
    expect(result.value.address.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
  });
});
