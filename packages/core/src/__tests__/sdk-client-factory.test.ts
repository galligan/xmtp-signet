import { describe, expect, test } from "bun:test";
import { generatePrivateKey } from "viem/accounts";
import { createSdkClientFactory } from "../sdk/sdk-client-factory.js";
import { createMockSdkNativeClient } from "./sdk-fixtures.js";
import type { XmtpClientCreateOptions } from "../xmtp-client-factory.js";

describe("createSdkClientFactory", () => {
  const testPrivateKey = generatePrivateKey();

  const defaultOptions: XmtpClientCreateOptions = {
    identityId: "test-identity",
    dbPath: "/tmp/test.db3",
    dbEncryptionKey: new Uint8Array(32),
    env: "local",
    appVersion: "test/0.1.0",
    signerPrivateKey: testPrivateKey,
  };

  test("returns an XmtpClientFactory", () => {
    const factory = createSdkClientFactory();
    expect(factory).toBeDefined();
    expect(typeof factory.create).toBe("function");
  });

  test("factory.create returns Result with XmtpClient on success", async () => {
    const mockNative = createMockSdkNativeClient({ inboxId: "inbox-99" });
    const factory = createSdkClientFactory({
      sdkCreateClient: async () => mockNative,
    });

    const result = await factory.create(defaultOptions);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.inboxId).toBe("inbox-99");
    }
  });

  test("factory.create returns Result.err when SDK creation fails", async () => {
    const factory = createSdkClientFactory({
      sdkCreateClient: async () => {
        throw new Error("native binding missing");
      },
    });

    const result = await factory.create(defaultOptions);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("InternalError");
      expect(result.error.message).toContain("native binding missing");
    }
  });

  test("passes options through to SDK create", async () => {
    let capturedOptions: Record<string, unknown> = {};
    const factory = createSdkClientFactory({
      sdkCreateClient: async (_signer, options) => {
        capturedOptions = options as Record<string, unknown>;
        return createMockSdkNativeClient();
      },
    });

    await factory.create(defaultOptions);

    expect(capturedOptions["dbPath"]).toBe("/tmp/test.db3");
    expect(capturedOptions["env"]).toBe("local");
    expect(capturedOptions["appVersion"]).toBe("test/0.1.0");
  });

  test("creates signer from signerPrivateKey in options", async () => {
    let capturedSigner: unknown = null;
    const factory = createSdkClientFactory({
      sdkCreateClient: async (signer) => {
        capturedSigner = signer;
        return createMockSdkNativeClient();
      },
    });

    await factory.create(defaultOptions);

    expect(capturedSigner).toBeDefined();
    expect((capturedSigner as { type: string }).type).toBe("EOA");
  });

  test("signer uses the provided private key for identity", async () => {
    let capturedSigner: { getIdentifier: () => unknown } | null = null;
    const factory = createSdkClientFactory({
      sdkCreateClient: async (signer) => {
        capturedSigner = signer as { getIdentifier: () => unknown };
        return createMockSdkNativeClient();
      },
    });

    await factory.create(defaultOptions);

    expect(capturedSigner).not.toBeNull();
    const id = capturedSigner!.getIdentifier() as {
      identifier: string;
      identifierKind: string;
    };
    expect(id.identifierKind).toBe("Ethereum");
    expect(id.identifier).toMatch(/^0x[a-f0-9]{40}$/);
  });
});
