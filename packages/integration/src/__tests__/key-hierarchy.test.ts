/**
 * Key hierarchy integration tests.
 *
 * Validates the three-tier key hierarchy: root -> operational -> session.
 * Uses software-vault platform capability (no Secure Enclave).
 */

import { describe, test, expect, afterEach } from "bun:test";
import { Result } from "better-result";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  createKeyManager,
  type KeyManager,
  createSignerProvider,
} from "@xmtp/signet-keys";

let keyManager: KeyManager | null = null;
let dataDir = "";

async function setup(): Promise<KeyManager> {
  dataDir = await mkdtemp(join(tmpdir(), "xmtp-key-test-"));
  const result = await createKeyManager({ dataDir });
  if (Result.isError(result)) {
    throw new Error(`Failed to create key manager: ${result.error.message}`);
  }
  keyManager = result.value;
  return keyManager;
}

afterEach(async () => {
  if (keyManager) {
    keyManager.close();
    keyManager = null;
  }
  if (dataDir) {
    await rm(dataDir, { recursive: true, force: true });
  }
});

describe("key-hierarchy", () => {
  test("initialize creates root key and reports software-vault platform", async () => {
    const km = await setup();

    expect(km.platform).toBe("software-vault");
    // software-vault maps to "unverified" trust tier
    expect(km.trustTier).toBe("unverified");

    const rootResult = await km.initialize();
    expect(rootResult.isOk()).toBe(true);
    if (!rootResult.isOk()) return;

    const root = rootResult.value;
    expect(root.keyRef).toBeTruthy();
    expect(root.publicKey).toBeTruthy();
    expect(root.policy).toBeTruthy();
    expect(root.platform).toBe("software-vault");
    expect(root.createdAt).toBeTruthy();
  });

  test("initialize is idempotent -- second call returns same root", async () => {
    const km = await setup();

    const first = await km.initialize();
    const second = await km.initialize();
    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    if (!first.isOk() || !second.isOk()) return;

    expect(first.value.keyRef).toBe(second.value.keyRef);
    expect(first.value.publicKey).toBe(second.value.publicKey);
  });

  test("create and retrieve operational key by identity and group", async () => {
    const km = await setup();
    await km.initialize();

    const createResult = await km.createOperationalKey("identity-1", "group-1");
    expect(createResult.isOk()).toBe(true);
    if (!createResult.isOk()) return;

    const opKey = createResult.value;
    expect(opKey.identityId).toBe("identity-1");
    expect(opKey.groupId).toBe("group-1");
    expect(opKey.publicKey).toBeTruthy();
    expect(opKey.fingerprint).toBeTruthy();
    expect(opKey.keyId).toBeTruthy();

    // Retrieve by identity ID
    const getResult = km.getOperationalKey("identity-1");
    expect(getResult.isOk()).toBe(true);
    if (!getResult.isOk()) return;
    expect(getResult.value.keyId).toBe(opKey.keyId);

    // Retrieve by group ID
    const byGroupResult = km.getOperationalKeyByGroupId("group-1");
    expect(byGroupResult.isOk()).toBe(true);
    if (!byGroupResult.isOk()) return;
    expect(byGroupResult.value.keyId).toBe(opKey.keyId);
  });

  test("sign with operational key produces non-empty signature", async () => {
    const km = await setup();
    await km.initialize();
    await km.createOperationalKey("signer-1", null);

    const data = new TextEncoder().encode("test payload");
    const sigResult = await km.signWithOperationalKey("signer-1", data);
    expect(sigResult.isOk()).toBe(true);
    if (!sigResult.isOk()) return;

    expect(sigResult.value.byteLength).toBeGreaterThan(0);

    // Different data produces different signature
    const data2 = new TextEncoder().encode("different payload");
    const sig2Result = await km.signWithOperationalKey("signer-1", data2);
    expect(sig2Result.isOk()).toBe(true);
    if (!sig2Result.isOk()) return;

    // Signatures should differ
    const sig1Hex = Buffer.from(sigResult.value).toString("hex");
    const sig2Hex = Buffer.from(sig2Result.value).toString("hex");
    expect(sig1Hex).not.toBe(sig2Hex);
  });

  test("signerProvider and sealSigner use operational key", async () => {
    const km = await setup();
    await km.initialize();
    await km.createOperationalKey("provider-id", null);

    // SignerProvider
    const signer = createSignerProvider(km, "provider-id");
    const signResult = await signer.sign(new TextEncoder().encode("data"));
    expect(signResult.isOk()).toBe(true);

    const pubResult = await signer.getPublicKey();
    expect(pubResult.isOk()).toBe(true);
    if (!pubResult.isOk()) return;
    expect(pubResult.value.byteLength).toBeGreaterThan(0);

    const fpResult = await signer.getFingerprint();
    expect(fpResult.isOk()).toBe(true);
    if (!fpResult.isOk()) return;
    expect(fpResult.value).toBeTruthy();

    // DB encryption key
    const dbKeyResult = await signer.getDbEncryptionKey();
    expect(dbKeyResult.isOk()).toBe(true);
    if (!dbKeyResult.isOk()) return;
    expect(dbKeyResult.value.byteLength).toBe(32);
  });

  test("session key -- issue, sign, revoke", async () => {
    const km = await setup();
    await km.initialize();

    const skResult = await km.issueSessionKey("session-1", 300);
    expect(skResult.isOk()).toBe(true);
    if (!skResult.isOk()) return;

    const sessionKey = skResult.value;
    expect(sessionKey.sessionId).toBe("session-1");
    expect(sessionKey.fingerprint).toBeTruthy();

    // Sign with session key
    const sigResult = await km.signWithSessionKey(
      sessionKey.keyId,
      new TextEncoder().encode("session data"),
    );
    expect(sigResult.isOk()).toBe(true);

    // Revoke
    const revokeResult = km.revokeSessionKey(sessionKey.keyId);
    expect(revokeResult.isOk()).toBe(true);

    // Sign after revoke fails
    const failResult = await km.signWithSessionKey(
      sessionKey.keyId,
      new TextEncoder().encode("after revoke"),
    );
    expect(failResult.isErr()).toBe(true);
  });

  test("vault isolation -- DB keys are deterministic per identity", async () => {
    const km = await setup();
    await km.initialize();

    // Same identity returns same DB key
    const dbKey1 = await km.getOrCreateDbKey("identity-a");
    const dbKey2 = await km.getOrCreateDbKey("identity-a");
    expect(dbKey1.isOk()).toBe(true);
    expect(dbKey2.isOk()).toBe(true);
    if (!dbKey1.isOk() || !dbKey2.isOk()) return;
    expect(dbKey1.value).toEqual(dbKey2.value);

    // Different identity returns different key
    const dbKey3 = await km.getOrCreateDbKey("identity-b");
    expect(dbKey3.isOk()).toBe(true);
    if (!dbKey3.isOk()) return;
    expect(dbKey1.value).not.toEqual(dbKey3.value);

    // Vault set/get works
    const testData = new Uint8Array([1, 2, 3, 4]);
    await km.vaultSet("custom-key", testData);
    const getResult = await km.vaultGet("custom-key");
    expect(getResult.isOk()).toBe(true);
    if (!getResult.isOk()) return;
    expect(getResult.value).toEqual(testData);

    // Missing key returns error
    const missingResult = await km.vaultGet("nonexistent");
    expect(missingResult.isErr()).toBe(true);
  });
});
