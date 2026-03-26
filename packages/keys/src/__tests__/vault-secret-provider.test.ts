import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import { Result } from "better-result";
import {
  writeFileSync,
  chmodSync,
  mkdtempSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createSeVaultSecretProvider,
  createSoftwareVaultSecretProvider,
  resolveVaultSecretProvider,
} from "../vault-secret-provider.js";
import { seEncrypt } from "../se-bridge.js";

describe("SoftwareVaultSecretProvider", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "signet-vs-sw-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("generates and persists a secret on first call", async () => {
    const provider = createSoftwareVaultSecretProvider(tmpDir);
    const result = await provider.getSecret();

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error("expected ok");

    // 32 bytes hex = 64 chars
    expect(result.value).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(tmpDir, "vault-passphrase"))).toBe(true);
  });

  test("returns same secret on subsequent calls", async () => {
    const provider = createSoftwareVaultSecretProvider(tmpDir);
    const r1 = await provider.getSecret();
    const r2 = await provider.getSecret();

    expect(Result.isOk(r1)).toBe(true);
    expect(Result.isOk(r2)).toBe(true);
    if (Result.isError(r1) || Result.isError(r2)) throw new Error("fail");
    expect(r1.value).toBe(r2.value);
  });

  test("reads existing secret from disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "signet-vs-sw-read-"));
    writeFileSync(join(dir, "vault-passphrase"), "abcd1234".repeat(8));

    const provider = createSoftwareVaultSecretProvider(dir);
    const result = await provider.getSecret();

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error("expected ok");
    expect(result.value).toBe("abcd1234".repeat(8));
    rmSync(dir, { recursive: true, force: true });
  });

  test("reports software kind", () => {
    const provider = createSoftwareVaultSecretProvider(tmpDir);
    expect(provider.kind).toBe("software");
  });
});

describe("seEncrypt (pure TypeScript ECIES)", () => {
  test("produces a sealed box with all required fields", async () => {
    // Use a known P-256 test public key (uncompressed, 65 bytes = 130 hex)
    // Generate one on the fly for testing
    const { p256 } = await import("@noble/curves/nist.js");
    const privKey = p256.utils.randomSecretKey();
    const pubKey = p256.getPublicKey(privKey, false);
    const pubHex = Array.from(pubKey)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const plaintext = new Uint8Array(32);
    crypto.getRandomValues(plaintext);

    const sealedBox = seEncrypt(pubHex, plaintext);

    expect(sealedBox.ephemeralPublicKey).toMatch(/^04[0-9a-f]{128}$/);
    expect(sealedBox.nonce).toMatch(/^[0-9a-f]{24}$/); // 12 bytes
    expect(sealedBox.ciphertext).toMatch(/^[0-9a-f]+$/);
    expect(sealedBox.tag).toMatch(/^[0-9a-f]{32}$/); // 16 bytes
  });

  test("different encryptions produce different sealed boxes", async () => {
    const { p256 } = await import("@noble/curves/nist.js");
    const privKey = p256.utils.randomSecretKey();
    const pubKey = p256.getPublicKey(privKey, false);
    const pubHex = Array.from(pubKey)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const plaintext = new Uint8Array([1, 2, 3, 4]);
    const box1 = seEncrypt(pubHex, plaintext);
    const box2 = seEncrypt(pubHex, plaintext);

    // Different ephemeral keys → different ciphertext
    expect(box1.ephemeralPublicKey).not.toBe(box2.ephemeralPublicKey);
    expect(box1.ciphertext).not.toBe(box2.ciphertext);
  });
});

describe("SeVaultSecretProvider (mock signer)", () => {
  let tmpDir: string;
  let mockSigner: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "signet-vs-se-"));

    // Mock signer: create returns a key ref + real P-256 public key,
    // decrypt returns a fixed plaintext (simulating SE ECDH + decrypt)
    const fixedSecret = "aa".repeat(32); // 32 bytes of 0xaa
    // Real P-256 uncompressed public key (65 bytes = 130 hex chars starting with 04)
    const realPubKey =
      "04ceb1ebde14307e32544178a94d440d7cbde3fd3d8f57bf2c55c7b866345b4c29665cb65049a5b58c1602b8a09b3562a9229012c12db99f8da7b42245abf34a1b";
    const script = `#!/usr/bin/env bash
case "$1" in
  "create") echo '{"keyRef":"dGVzdC12YXVsdC1rZXk=","publicKey":"${realPubKey}","policy":"open"}' ;;
  "decrypt") echo '{"plaintext":"${fixedSecret}"}' ;;
  *) echo '{}' ;;
esac
exit 0
`;
    mockSigner = join(tmpDir, "mock-signet-signer");
    writeFileSync(mockSigner, script);
    chmodSync(mockSigner, 0o755);
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates key and sealed box on first call", async () => {
    const dataDir = join(tmpDir, "data1");
    const provider = createSeVaultSecretProvider(dataDir, mockSigner);
    const result = await provider.getSecret();

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error("expected ok");

    expect(result.value).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(dataDir, "se-vault-keyref"))).toBe(true);
    expect(existsSync(join(dataDir, "vault-sealed-box.json"))).toBe(true);
    expect(existsSync(join(dataDir, "se-vault-pubkey"))).toBe(true);
  });

  test("decrypts existing sealed box on subsequent calls", async () => {
    // This tests the decrypt path — mock signer returns the fixed secret
    const dataDir = join(tmpDir, "data2");
    const provider = createSeVaultSecretProvider(dataDir, mockSigner);

    // First call: creates key + encrypts
    const r1 = await provider.getSecret();
    expect(Result.isOk(r1)).toBe(true);

    // Create a new provider instance (simulating restart)
    const provider2 = createSeVaultSecretProvider(dataDir, mockSigner);
    const r2 = await provider2.getSecret();
    expect(Result.isOk(r2)).toBe(true);

    // The mock always returns the same plaintext on decrypt
    if (Result.isError(r2)) throw new Error("fail");
    expect(r2.value).toBe("aa".repeat(32));
  });

  test("reports secure-enclave kind", () => {
    const dataDir = join(tmpDir, "data3");
    const provider = createSeVaultSecretProvider(dataDir, mockSigner);
    expect(provider.kind).toBe("secure-enclave");
  });

  test("returns error when signer fails", async () => {
    const failSigner = join(tmpDir, "fail-signer");
    writeFileSync(
      failSigner,
      '#!/usr/bin/env bash\necho "error: SE unavailable" >&2\nexit 1\n',
    );
    chmodSync(failSigner, 0o755);

    const dataDir = join(tmpDir, "data-fail");
    const provider = createSeVaultSecretProvider(dataDir, failSigner);
    const result = await provider.getSecret();
    expect(Result.isError(result)).toBe(true);
  });

  test("returns a deterministic secret for concurrent first-run calls", async () => {
    const dataDir = join(tmpDir, "data-concurrent");
    const provider = createSeVaultSecretProvider(dataDir, mockSigner);

    const [r1, r2] = await Promise.all([
      provider.getSecret(),
      provider.getSecret(),
    ]);

    expect(Result.isOk(r1)).toBe(true);
    expect(Result.isOk(r2)).toBe(true);
    if (Result.isError(r1) || Result.isError(r2)) {
      throw new Error("expected ok");
    }
    expect(r1.value).toBe(r2.value);
  });
});

describe("resolveVaultSecretProvider", () => {
  const originalSignerPath = process.env["SIGNET_SIGNER_PATH"];

  beforeEach(() => {
    if (originalSignerPath === undefined) {
      delete process.env["SIGNET_SIGNER_PATH"];
      return;
    }
    process.env["SIGNET_SIGNER_PATH"] = originalSignerPath;
  });

  test("returns a provider with software or secure-enclave kind", () => {
    const dir = mkdtempSync(join(tmpdir(), "signet-vs-resolve-"));
    const provider = resolveVaultSecretProvider(dir);

    expect(
      provider.kind === "software" || provider.kind === "secure-enclave",
    ).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("prefers legacy software provider when vault-passphrase exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "signet-vs-legacy-"));
    const legacySecret = "be".repeat(32);
    writeFileSync(join(dir, "vault-passphrase"), legacySecret);

    const provider = resolveVaultSecretProvider(dir);
    const result = await provider.getSecret();

    expect(provider.kind).toBe("software");
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error("expected ok");
    expect(result.value).toBe(legacySecret);

    rmSync(dir, { recursive: true, force: true });
  });

  test("returns an error when an SE-backed vault exists but signer is unavailable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "signet-vs-missing-signer-"));
    process.env["SIGNET_SIGNER_PATH"] = join(dir, "missing-signer");
    writeFileSync(join(dir, "vault-sealed-box.json"), "{}");

    const provider = resolveVaultSecretProvider(dir);
    const result = await provider.getSecret();

    expect(provider.kind).toBe("software");
    expect(Result.isError(result)).toBe(true);
    if (Result.isOk(result)) throw new Error("expected error");
    expect(result.error.message).toContain("Secure Enclave");

    rmSync(dir, { recursive: true, force: true });
  });
});
