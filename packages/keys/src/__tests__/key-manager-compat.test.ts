import { afterEach, describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { InternalError } from "@xmtp/signet-schemas";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKeyManager } from "../key-manager-compat.js";
import { createSealStamper } from "../seal-stamper.js";
import { createSignerProvider } from "../signer-provider.js";
import type { VaultSecretProvider } from "../vault-secret-provider.js";
import type { BiometricPrompter } from "../biometric-gate.js";
import {
  exportPrivateKey,
  exportPublicKey,
  generateEd25519KeyPair,
  toHex,
} from "../crypto-keys.js";

const testDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    testDirs.splice(0).map((dir) =>
      rm(dir, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

function createDeterministicVaultSecretProvider(): VaultSecretProvider {
  return {
    kind: "software",
    async getSecret() {
      return Result.ok("11".repeat(32));
    },
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function setupCompatKeyManager(
  overrides: {
    biometricGating?: {
      rootKeyCreation?: boolean;
      operationalKeyRotation?: boolean;
      scopeExpansion?: boolean;
      egressExpansion?: boolean;
      agentCreation?: boolean;
    };
    biometricPrompter?: BiometricPrompter;
    vaultSecretProvider?: VaultSecretProvider;
  } = {},
) {
  const dataDir = await mkdtemp(join(tmpdir(), "xmtp-signet-keymgr-compat-"));
  testDirs.push(dataDir);

  const managerResult = await createKeyManager({
    dataDir,
    rootKeyPolicy: "open",
    operationalKeyPolicy: "open",
    vaultKeyPolicy: "open",
    biometricGating: overrides.biometricGating,
    biometricPrompter: overrides.biometricPrompter,
    vaultSecretProvider:
      overrides.vaultSecretProvider ?? createDeterministicVaultSecretProvider(),
  });
  expect(Result.isOk(managerResult)).toBe(true);
  if (Result.isError(managerResult)) {
    throw new Error("failed to create compat key manager");
  }

  const initResult = await managerResult.value.initialize();
  expect(Result.isOk(initResult)).toBe(true);

  return managerResult.value;
}

describe("createKeyManager admin key persistence", () => {
  test("reloads persisted admin key so later processes can sign JWTs", async () => {
    const firstManager = await setupCompatKeyManager();

    const created = await firstManager.admin.create();
    expect(Result.isOk(created)).toBe(true);
    if (Result.isError(created)) return;

    const firstToken = await firstManager.admin.signJwt({ ttlSeconds: 120 });
    expect(Result.isOk(firstToken)).toBe(true);
    firstManager.close();

    const secondManager = await createKeyManager({
      dataDir: testDirs[0] ?? "",
      rootKeyPolicy: "open",
      operationalKeyPolicy: "open",
      vaultKeyPolicy: "open",
      vaultSecretProvider: createDeterministicVaultSecretProvider(),
    });
    expect(Result.isOk(secondManager)).toBe(true);
    if (Result.isError(secondManager)) return;

    const initSecond = await secondManager.value.initialize();
    expect(Result.isOk(initSecond)).toBe(true);
    expect(secondManager.value.admin.exists()).toBe(true);

    const reloaded = await secondManager.value.admin.get();
    expect(Result.isOk(reloaded)).toBe(true);
    if (Result.isError(reloaded)) return;
    expect(reloaded.value.fingerprint).toBe(created.value.fingerprint);

    const secondToken = await secondManager.value.admin.signJwt({
      ttlSeconds: 120,
    });
    expect(Result.isOk(secondToken)).toBe(true);
    secondManager.value.close();
  });

  test("rejects tampered admin JWT signatures", async () => {
    const manager = await setupCompatKeyManager();
    const created = await manager.admin.create();
    expect(Result.isOk(created)).toBe(true);
    if (Result.isError(created)) return;

    const signed = await manager.admin.signJwt({ ttlSeconds: 120 });
    expect(Result.isOk(signed)).toBe(true);
    if (Result.isError(signed)) return;

    const parts = signed.value.split(".");
    expect(parts).toHaveLength(3);
    const signatureBytes = Buffer.from(parts[2] ?? "", "base64url");
    signatureBytes[0] = (signatureBytes[0] ?? 0) ^ 1;
    const tamperedSignature = signatureBytes.toString("base64url");
    const tampered = [parts[0], parts[1], tamperedSignature].join(".");

    const verified = await manager.admin.verifyJwt(tampered);
    expect(Result.isError(verified)).toBe(true);
  });

  test("persists compat secret material in the encrypted vault layout", async () => {
    const manager = await setupCompatKeyManager();

    const created = await manager.admin.create();
    expect(Result.isOk(created)).toBe(true);

    const dbKey = await manager.getOrCreateDbKey("identity-a");
    expect(Result.isOk(dbKey)).toBe(true);

    const identityKey = await manager.getOrCreateXmtpIdentityKey("identity-a");
    expect(Result.isOk(identityKey)).toBe(true);

    const dataDir = testDirs[0] ?? "";
    expect(existsSync(join(dataDir, "secrets", "admin-key.bin"))).toBe(true);
    expect(existsSync(join(dataDir, "secrets", "admin-key-pub.bin"))).toBe(
      true,
    );
    expect(
      existsSync(join(dataDir, "secrets", "db-key%3Aidentity-a.bin")),
    ).toBe(true);
    expect(
      existsSync(
        join(dataDir, "secrets", "xmtp-identity-key%3Aidentity-a.bin"),
      ),
    ).toBe(true);
    expect(existsSync(join(dataDir, "kv", "admin-key"))).toBe(false);
  });

  test("migrates legacy kv admin material into the encrypted vault on initialize", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "xmtp-signet-keymgr-legacy-"));
    testDirs.push(dataDir);

    const pair = await generateEd25519KeyPair();
    expect(Result.isOk(pair)).toBe(true);
    if (Result.isError(pair)) return;

    const privateKey = await exportPrivateKey(pair.value.privateKey);
    const publicKey = await exportPublicKey(pair.value.publicKey);
    expect(Result.isOk(privateKey)).toBe(true);
    expect(Result.isOk(publicKey)).toBe(true);
    if (Result.isError(privateKey) || Result.isError(publicKey)) return;

    const publicKeyHex = toHex(publicKey.value);
    const kvDir = join(dataDir, "kv");
    mkdirSync(kvDir, { recursive: true });
    writeFileSync(join(kvDir, "admin-key"), bytesToHex(privateKey.value));
    writeFileSync(
      join(kvDir, "admin-key-pub"),
      bytesToHex(new TextEncoder().encode(publicKeyHex)),
    );

    const managerResult = await createKeyManager({
      dataDir,
      rootKeyPolicy: "open",
      operationalKeyPolicy: "open",
      vaultKeyPolicy: "open",
      vaultSecretProvider: createDeterministicVaultSecretProvider(),
    });
    expect(Result.isOk(managerResult)).toBe(true);
    if (Result.isError(managerResult)) return;

    const initialized = await managerResult.value.initialize();
    expect(Result.isOk(initialized)).toBe(true);
    expect(managerResult.value.admin.exists()).toBe(true);

    const signed = await managerResult.value.admin.signJwt({ ttlSeconds: 120 });
    expect(Result.isOk(signed)).toBe(true);
    expect(existsSync(join(kvDir, "admin-key"))).toBe(false);
    expect(existsSync(join(kvDir, "admin-key-pub"))).toBe(false);
    expect(existsSync(join(dataDir, "secrets", "admin-key.bin"))).toBe(true);
    expect(existsSync(join(dataDir, "secrets", "admin-key-pub.bin"))).toBe(
      true,
    );
  });
});

describe("compat signer and stamper helpers", () => {
  test("createSignerProvider accepts a compat KeyManager", async () => {
    const manager = await setupCompatKeyManager();
    const opKey = await manager.createOperationalKey("identity-a", null);
    expect(Result.isOk(opKey)).toBe(true);
    if (Result.isError(opKey)) return;

    const signer = createSignerProvider(manager, "identity-a");
    const signature = await signer.sign(new Uint8Array([1, 2, 3]));
    expect(Result.isOk(signature)).toBe(true);

    const fingerprint = await signer.getFingerprint();
    expect(Result.isOk(fingerprint)).toBe(true);
    if (Result.isError(fingerprint)) return;
    expect(fingerprint.value).toBe(opKey.value.fingerprint);

    const dbKey = await signer.getDbEncryptionKey();
    expect(Result.isOk(dbKey)).toBe(true);

    const identityKey = await signer.getXmtpIdentityKey();
    expect(Result.isOk(identityKey)).toBe(true);
    if (Result.isError(identityKey)) return;
    expect(identityKey.value.startsWith("0x")).toBe(true);
  });

  test("createSealStamper accepts a compat KeyManager", async () => {
    const manager = await setupCompatKeyManager();
    const opKey = await manager.createOperationalKey(
      "identity-b",
      "conv_aabbccddeeff0011",
    );
    expect(Result.isOk(opKey)).toBe(true);

    const stamper = createSealStamper(manager, "identity-b");
    const envelope = await stamper.sign({
      sealId: "seal_aabbccddeeff0011",
      credentialId: "cred_aabbccddeeff0011",
      operatorId: "op_aabbccddeeff0011",
      chatId: "conv_aabbccddeeff0011",
      scopeMode: "per-chat",
      permissions: { allow: ["send"], deny: [] },
      issuedAt: new Date().toISOString(),
    });
    expect(Result.isOk(envelope)).toBe(true);
    if (Result.isError(envelope)) return;
    expect(envelope.value.algorithm).toBe("Ed25519");
    expect(envelope.value.signature.length).toBeGreaterThan(0);

    const revocation = await stamper.signRevocation({
      sealId: "seal_bbccddeefeedbabe",
      previousSealId: "seal_aabbccddeeff0011",
      operatorId: "op_aabbccddeeff0011",
      credentialId: "cred_aabbccddeeff0011",
      chatId: "conv_aabbccddeeff0011",
      reason: "owner-initiated",
      revokedAt: new Date().toISOString(),
      issuer: "owner",
    });
    expect(Result.isOk(revocation)).toBe(true);
  });
});

describe("createKeyManager biometric gating", () => {
  test("prompts for root key creation when enabled", async () => {
    const prompted: string[] = [];
    const manager = await setupCompatKeyManager({
      biometricGating: { rootKeyCreation: true },
      biometricPrompter: async (operation) => {
        prompted.push(operation);
        return Result.ok(undefined);
      },
    });

    const created = await manager.admin.create();
    expect(Result.isOk(created)).toBe(true);
    expect(prompted).toEqual(["rootKeyCreation"]);
  });

  test("prompts for agent creation when enabled", async () => {
    const prompted: string[] = [];
    const manager = await setupCompatKeyManager({
      biometricGating: { agentCreation: true },
      biometricPrompter: async (operation) => {
        prompted.push(operation);
        return Result.ok(undefined);
      },
    });

    const created = await manager.createOperationalKey("identity-gated", null);
    expect(Result.isOk(created)).toBe(true);
    expect(prompted).toEqual(["agentCreation"]);
  });

  test("prompts for operational key rotation when enabled", async () => {
    const prompted: string[] = [];
    const manager = await setupCompatKeyManager({
      biometricGating: { operationalKeyRotation: true },
      biometricPrompter: async (operation) => {
        prompted.push(operation);
        return Result.ok(undefined);
      },
    });

    const created = await manager.createOperationalKey("identity-rot", null);
    expect(Result.isOk(created)).toBe(true);

    const rotated = await manager.rotateOperationalKey("identity-rot");
    expect(Result.isOk(rotated)).toBe(true);
    expect(prompted).toEqual(["operationalKeyRotation"]);
  });

  test("fails closed when root key creation is gated and denied", async () => {
    const manager = await setupCompatKeyManager({
      biometricGating: { rootKeyCreation: true },
      biometricPrompter: async () =>
        Result.err(
          InternalError.create("Biometric gate unavailable", {
            category: "cancelled",
          }),
        ),
    });

    const created = await manager.admin.create();
    expect(Result.isError(created)).toBe(true);
    if (Result.isOk(created)) return;
    expect(created.error.message).toContain("Biometric gate unavailable");
    expect(manager.admin.exists()).toBe(false);
  });
});
