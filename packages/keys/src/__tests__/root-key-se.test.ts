import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Result } from "better-result";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createVault, type Vault } from "../vault.js";
import { initializeRootKey, signWithRootKey } from "../root-key.js";

/**
 * Tests for root key SE dispatch path.
 * Uses SIGNET_SIGNER_PATH env var + mock scripts to test the full
 * subprocess path without actual Secure Enclave hardware.
 */

const MOCK_KEY_REF = "dGVzdC1rZXktcmVm";
const MOCK_PUBLIC_KEY = "04" + "ab".repeat(32) + "cd".repeat(32);
const MOCK_SIGNATURE =
  "3046022100" + "aa".repeat(32) + "022100" + "bb".repeat(32);

function createMockSignerScript(tmpDir: string): string {
  const scriptPath = join(tmpDir, "mock-signet-signer");
  // Return different JSON based on subcommand
  const script = `#!/usr/bin/env bash
case "$1" in
  "create")
    echo '{"keyRef":"${MOCK_KEY_REF}","publicKey":"${MOCK_PUBLIC_KEY}","policy":"open"}'
    ;;
  "sign")
    echo '{"signature":"${MOCK_SIGNATURE}"}'
    ;;
  "info")
    echo '{"available":true,"chip":"Mock M2","macOS":"15.0"}'
    ;;
  "delete")
    ;;
  *)
    echo '{}' ;;
esac
exit 0
`;
  writeFileSync(scriptPath, script);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

describe("root-key SE dispatch", () => {
  let dataDir: string;
  let vault: Vault;
  let originalSignerPath: string | undefined;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "rootkey-se-test-"));
    const result = await createVault(dataDir);
    if (Result.isError(result)) throw new Error("vault setup failed");
    vault = result.value;

    // Set SIGNET_SIGNER_PATH to mock script
    originalSignerPath = process.env["SIGNET_SIGNER_PATH"];
    const mockPath = createMockSignerScript(dataDir);
    process.env["SIGNET_SIGNER_PATH"] = mockPath;
  });

  afterEach(() => {
    vault.close();
    rmSync(dataDir, { recursive: true, force: true });
    // Restore env
    if (originalSignerPath === undefined) {
      delete process.env["SIGNET_SIGNER_PATH"];
    } else {
      process.env["SIGNET_SIGNER_PATH"] = originalSignerPath;
    }
  });

  test("SE platform creates key via subprocess and stores handle", async () => {
    const result = await initializeRootKey(vault, "open", "secure-enclave");
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result))
      throw new Error(`init failed: ${result.error.message}`);

    expect(result.value.platform).toBe("secure-enclave");
    expect(result.value.keyRef).toBe(MOCK_KEY_REF);
    expect(result.value.publicKey).toBe(MOCK_PUBLIC_KEY);
  });

  test("SE platform does NOT store private material in vault", async () => {
    await initializeRootKey(vault, "open", "secure-enclave");

    const names = vault.list();
    expect(names).toContain("root-key-ref");
    // No private key stored — SE keys never leave the enclave
    expect(names).not.toContain("root-key:private");
  });

  test("SE handle loads from vault on re-init", async () => {
    const r1 = await initializeRootKey(vault, "open", "secure-enclave");
    if (Result.isError(r1)) throw new Error("first init failed");

    const r2 = await initializeRootKey(vault, "open", "secure-enclave");
    expect(Result.isOk(r2)).toBe(true);
    if (Result.isError(r2)) throw new Error("re-init failed");

    expect(r2.value.keyRef).toBe(r1.value.keyRef);
    expect(r2.value.platform).toBe("secure-enclave");
  });

  test("signWithRootKey dispatches to SE when handle has secure-enclave platform", async () => {
    await initializeRootKey(vault, "open", "secure-enclave");

    const data = new Uint8Array([1, 2, 3]);
    const result = await signWithRootKey(vault, data);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result))
      throw new Error(`sign failed: ${result.error.message}`);

    expect(result.value.byteLength).toBeGreaterThan(0);
  });

  test("software platform uses existing software path (unchanged)", async () => {
    const result = await initializeRootKey(vault, "open", "software-vault");
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error("init failed");

    expect(result.value.platform).toBe("software-vault");

    // Signing should work via software path
    const sig = await signWithRootKey(vault, new Uint8Array([1, 2, 3]));
    expect(Result.isOk(sig)).toBe(true);
  });

  test("SE init fails gracefully when signer binary not found", async () => {
    process.env["SIGNET_SIGNER_PATH"] = "/nonexistent/path/signet-signer";

    const result = await initializeRootKey(vault, "open", "secure-enclave");
    expect(Result.isError(result)).toBe(true);
    if (Result.isOk(result)) throw new Error("expected error");
    expect(result.error.message).toContain("signet-signer binary not found");
  });
});
