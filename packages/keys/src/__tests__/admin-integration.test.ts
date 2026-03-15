import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Result } from "better-result";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createKeyManager, type KeyManager } from "../key-manager.js";

describe("KeyManager.admin integration", () => {
  let dataDir: string;
  let manager: KeyManager;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "admin-integ-test-"));
    const result = await createKeyManager({ dataDir });
    if (Result.isError(result)) throw new Error("key manager setup failed");
    manager = result.value;
  });

  afterEach(() => {
    manager.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("admin property is accessible on KeyManager", () => {
    expect(manager.admin).toBeDefined();
  });

  test("creates admin key through facade", async () => {
    const result = await manager.admin.create();
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error("create failed");
    expect(result.value.publicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(result.value.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  test("signs and verifies JWT through facade", async () => {
    await manager.admin.create();

    const jwt = await manager.admin.signJwt();
    expect(Result.isOk(jwt)).toBe(true);
    if (Result.isError(jwt)) throw new Error("sign failed");

    const verified = await manager.admin.verifyJwt(jwt.value);
    expect(Result.isOk(verified)).toBe(true);
    if (Result.isError(verified)) throw new Error("verify failed");
    expect(verified.value.sub).toBe("admin");
  });

  test("admin key exists check through facade", async () => {
    expect(manager.admin.exists()).toBe(false);
    await manager.admin.create();
    expect(manager.admin.exists()).toBe(true);
  });

  test("admin and operational keys coexist in vault", async () => {
    await manager.admin.create();
    await manager.createOperationalKey("agent-1", null);

    const vaultKeys = manager.vaultList();
    const adminKeys = vaultKeys.filter((k) => k.startsWith("admin-key:"));
    const opKeys = vaultKeys.filter((k) => k.startsWith("op-key:"));

    expect(adminKeys.length).toBeGreaterThan(0);
    expect(opKeys.length).toBeGreaterThan(0);
  });

  test("rotates admin key through facade", async () => {
    const original = await manager.admin.create();
    if (Result.isError(original)) throw new Error("create failed");

    const rotated = await manager.admin.rotate();
    expect(Result.isOk(rotated)).toBe(true);
    if (Result.isError(rotated)) throw new Error("rotate failed");

    expect(rotated.value.fingerprint).not.toBe(original.value.fingerprint);
  });

  test("exports public key through facade", async () => {
    await manager.admin.create();
    const result = await manager.admin.exportPublicKey();
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error("export failed");
    expect(result.value).toMatch(/^[0-9a-f]{64}$/);
  });
});
