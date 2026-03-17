import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Result } from "better-result";
import { InternalError, NotFoundError } from "@xmtp/signet-schemas";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createVault, type Vault } from "../vault.js";
import { initializeRootKey, signWithRootKey } from "../root-key.js";

describe("initializeRootKey", () => {
  let dataDir: string;
  let vault: Vault;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "rootkey-test-"));
    const result = await createVault(dataDir);
    if (Result.isError(result)) throw new Error("vault setup failed");
    vault = result.value;
  });

  afterEach(() => {
    vault.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("generates a root key and returns handle without private material", async () => {
    const result = await initializeRootKey(vault, "open", "software-vault");
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error("init failed");

    expect(result.value.keyRef).toBeDefined();
    expect(result.value.publicKey).toMatch(/^[0-9a-f]+$/);
    expect(result.value.platform).toBe("software-vault");
    // Ensure no private key is exposed on the handle
    expect("privateKey" in result.value).toBe(false);
  });

  test("persists root key in vault and signs on-demand", async () => {
    const r1 = await initializeRootKey(vault, "open", "software-vault");
    if (Result.isError(r1)) throw new Error("first init failed");

    // Sign data on-demand via vault
    const data = new Uint8Array([1, 2, 3]);
    const sig1 = await signWithRootKey(vault, data);
    if (Result.isError(sig1)) throw new Error("sign failed");
    expect(sig1.value.byteLength).toBeGreaterThan(0);

    // Re-initialize — should load existing handle from vault
    const r2 = await initializeRootKey(vault, "open", "software-vault");
    if (Result.isError(r2)) throw new Error("second init failed");

    expect(r2.value.keyRef).toBe(r1.value.keyRef);
    expect(r2.value.publicKey).toBe(r1.value.publicKey);

    // Signing still works after re-initialization
    const sig2 = await signWithRootKey(vault, data);
    if (Result.isError(sig2)) throw new Error("sign with reloaded key failed");
    expect(sig2.value.byteLength).toBeGreaterThan(0);
  });

  test("survives vault close and reopen", async () => {
    const r1 = await initializeRootKey(vault, "open", "software-vault");
    if (Result.isError(r1)) throw new Error("first init failed");

    vault.close();

    // Reopen vault
    const vaultResult = await createVault(dataDir);
    if (Result.isError(vaultResult)) throw new Error("vault reopen failed");
    const vault2 = vaultResult.value;

    const r2 = await initializeRootKey(vault2, "open", "software-vault");
    if (Result.isError(r2)) throw new Error("second init failed");

    expect(r2.value.keyRef).toBe(r1.value.keyRef);

    vault2.close();
  });

  test("stores private key separately from handle metadata", async () => {
    await initializeRootKey(vault, "open", "software-vault");

    const names = vault.list();
    expect(names).toContain("root-key-ref");
    expect(names).toContain("root-key:private");
  });

  test("propagates vault read failures instead of generating a new root key", async () => {
    const brokenVault: Vault = {
      async set() {
        return Result.ok();
      },
      async get(name) {
        if (name === "root-key-ref") {
          return Result.err(InternalError.create("vault read failed"));
        }
        return Result.err(NotFoundError.create("VaultSecret", name));
      },
      async delete(name) {
        return Result.err(NotFoundError.create("VaultSecret", name));
      },
      list() {
        return [];
      },
      close() {},
    };

    const result = await initializeRootKey(
      brokenVault,
      "open",
      "software-vault",
    );
    expect(Result.isError(result)).toBe(true);
    if (Result.isOk(result)) throw new Error("expected error");
    expect(result.error.message).toContain("vault read failed");
  });
});
