import { describe, test, expect, afterEach } from "bun:test";
import { Result } from "better-result";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { p256 } from "@noble/curves/nist.js";
import {
  detectPlatform,
  resetPlatformCache,
  seCreate,
  seSign,
  seInfo,
  seDelete,
} from "../index.js";
import { createVault } from "../vault.js";
import { initializeRootKey, signWithRootKey } from "../root-key.js";
import { createKeyManager } from "../key-manager.js";
import { secureEnclaveTestCapability } from "./se-test-capability.js";

/**
 * Secure Enclave integration tests.
 * Gated on macOS + signer binary availability.
 * These hit the real Secure Enclave — no mocks.
 */

const signerPath =
  secureEnclaveTestCapability.kind === "available"
    ? secureEnclaveTestCapability.signerPath
    : null;
const isRealSE = secureEnclaveTestCapability.kind === "available";

describe.skipIf(!isRealSE)("Secure Enclave integration", () => {
  // Track created keys for cleanup
  const createdKeyRefs: string[] = [];

  afterEach(async () => {
    // Clean up any SE keys created during tests
    for (const keyRef of createdKeyRefs) {
      await seDelete(keyRef, signerPath!);
    }
    createdKeyRefs.length = 0;
    resetPlatformCache();
  });

  test("signet-signer info --system reports SE available", async () => {
    const result = await seInfo(signerPath!);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error("info failed");

    expect(result.value.available).toBe(true);
    expect(result.value.chip).toBeDefined();
    expect(result.value.macOS).toBeDefined();
  });

  test("create + sign + verify round-trip with @noble/curves", async () => {
    // 1. Create SE key with policy "open" (no biometric prompt)
    const createResult = await seCreate(
      `signet-test-${Date.now()}`,
      "open",
      signerPath!,
    );
    expect(Result.isOk(createResult)).toBe(true);
    if (Result.isError(createResult))
      throw new Error(`create failed: ${createResult.error.message}`);

    createdKeyRefs.push(createResult.value.keyRef);
    const { publicKey: publicKeyHex } = createResult.value;

    // Public key should be uncompressed P-256 (65 bytes = 130 hex chars)
    expect(publicKeyHex).toMatch(/^04[0-9a-f]{128}$/);

    // 2. Sign a 32-byte test digest (pre-hashed path)
    const testDigest = new Uint8Array(32);
    crypto.getRandomValues(testDigest);

    const signResult = await seSign(
      createResult.value.keyRef,
      testDigest,
      signerPath!,
    );
    expect(Result.isOk(signResult)).toBe(true);
    if (Result.isError(signResult))
      throw new Error(`sign failed: ${signResult.error.message}`);

    // 3. Verify signature using @noble/curves/p256
    const sigHex = signResult.value.signature;
    const sigBytes = hexToBytes(sigHex);
    const pubBytes = hexToBytes(publicKeyHex);

    // Parse DER to (r, s) and convert to compact 64-byte format for noble v2
    const { r, s } = parseDERToRS(sigBytes);
    const rPad = bigintToBytes(r, 32);
    const sPad = bigintToBytes(s, 32);
    const compactSig = new Uint8Array(64);
    compactSig.set(rPad, 0);
    compactSig.set(sPad, 32);

    // prehash: false = message IS the hash, don't hash again
    // The SE pre-hash path signs the 32-byte digest directly
    const valid = p256.verify(compactSig, testDigest, pubBytes, {
      prehash: false,
    });
    expect(valid).toBe(true);
  });

  test("platform detection returns secure-enclave on macOS with signer", () => {
    resetPlatformCache();
    expect(detectPlatform()).toBe("secure-enclave");
  });

  test("key manager initializes with SE root key", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "se-km-test-"));
    try {
      resetPlatformCache();

      const kmResult = await createKeyManager({
        dataDir,
        rootKeyPolicy: "open",
      });
      expect(Result.isOk(kmResult)).toBe(true);
      if (Result.isError(kmResult))
        throw new Error(`km create failed: ${kmResult.error.message}`);

      const km = kmResult.value;
      expect(km.platform).toBe("secure-enclave");
      expect(km.trustTier).toBe("source-verified");

      const initResult = await km.initialize();
      expect(Result.isOk(initResult)).toBe(true);
      if (Result.isError(initResult))
        throw new Error(`init failed: ${initResult.error.message}`);

      expect(initResult.value.platform).toBe("secure-enclave");
      expect(initResult.value.publicKey).toMatch(/^04[0-9a-f]+$/);

      // Track for cleanup
      createdKeyRefs.push(initResult.value.keyRef);

      km.close();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("root key round-trip: init + sign + verify", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "se-rootkey-test-"));
    try {
      const vaultResult = await createVault(dataDir);
      if (Result.isError(vaultResult)) throw new Error("vault failed");
      const vault = vaultResult.value;

      const initResult = await initializeRootKey(
        vault,
        "open",
        "secure-enclave",
      );
      expect(Result.isOk(initResult)).toBe(true);
      if (Result.isError(initResult))
        throw new Error(`init failed: ${initResult.error.message}`);

      createdKeyRefs.push(initResult.value.keyRef);

      // Sign test data
      const testData = new Uint8Array([1, 2, 3, 4, 5]);
      const sigResult = await signWithRootKey(vault, testData);
      expect(Result.isOk(sigResult)).toBe(true);
      if (Result.isError(sigResult))
        throw new Error(`sign failed: ${sigResult.error.message}`);

      expect(sigResult.value.byteLength).toBeGreaterThan(0);

      vault.close();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

// Helpers

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

function bigintToBytes(n: bigint, length: number): Uint8Array {
  const hex = n.toString(16).padStart(length * 2, "0");
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function parseDERToRS(der: Uint8Array): { r: bigint; s: bigint } {
  let offset = 0;
  if (der[offset] !== 0x30) throw new Error("expected SEQUENCE");
  offset += 2; // skip tag + length

  if (der[offset] !== 0x02) throw new Error("expected INTEGER for r");
  offset += 1;
  const rLen = der[offset]!;
  offset += 1;
  let rBytes = der.slice(offset, offset + rLen);
  offset += rLen;

  if (der[offset] !== 0x02) throw new Error("expected INTEGER for s");
  offset += 1;
  const sLen = der[offset]!;
  offset += 1;
  let sBytes = der.slice(offset, offset + sLen);

  // Strip leading zeros
  while (rBytes.length > 1 && rBytes[0] === 0) rBytes = rBytes.slice(1);
  while (sBytes.length > 1 && sBytes[0] === 0) sBytes = sBytes.slice(1);

  const r = BigInt(
    "0x" +
      Array.from(rBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
  );
  const s = BigInt(
    "0x" +
      Array.from(sBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
  );

  return { r, s };
}
