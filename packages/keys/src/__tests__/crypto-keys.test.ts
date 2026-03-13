import { describe, test, expect } from "bun:test";
import { Result } from "better-result";
import {
  generateP256KeyPair,
  generateEd25519KeyPair,
  signP256,
  verifyP256,
  signEd25519,
  verifyEd25519,
  exportPublicKey,
  exportPrivateKey,
  importEd25519PrivateKey,
  fingerprint,
} from "../crypto-keys.js";

describe("P-256 keys", () => {
  test("generates a key pair", async () => {
    const result = await generateP256KeyPair();
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error("gen failed");
    expect(result.value.publicKey).toBeDefined();
    expect(result.value.privateKey).toBeDefined();
  });

  test("signs and verifies data", async () => {
    const kp = await generateP256KeyPair();
    if (Result.isError(kp)) throw new Error("gen failed");

    const data = new Uint8Array([1, 2, 3, 4]);
    const sig = await signP256(kp.value.privateKey, data);
    expect(Result.isOk(sig)).toBe(true);
    if (Result.isError(sig)) throw new Error("sign failed");

    const valid = await verifyP256(kp.value.publicKey, data, sig.value);
    expect(Result.isOk(valid)).toBe(true);
    if (Result.isError(valid)) throw new Error("verify failed");
    expect(valid.value).toBe(true);
  });

  test("rejects tampered data", async () => {
    const kp = await generateP256KeyPair();
    if (Result.isError(kp)) throw new Error("gen failed");

    const data = new Uint8Array([1, 2, 3]);
    const sig = await signP256(kp.value.privateKey, data);
    if (Result.isError(sig)) throw new Error("sign failed");

    const tampered = new Uint8Array([1, 2, 4]);
    const valid = await verifyP256(kp.value.publicKey, tampered, sig.value);
    expect(Result.isOk(valid)).toBe(true);
    if (Result.isError(valid)) throw new Error("verify failed");
    expect(valid.value).toBe(false);
  });
});

describe("Ed25519 keys", () => {
  test("generates a key pair", async () => {
    const result = await generateEd25519KeyPair();
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error("gen failed");
    expect(result.value.publicKey).toBeDefined();
    expect(result.value.privateKey).toBeDefined();
  });

  test("signs and verifies data", async () => {
    const kp = await generateEd25519KeyPair();
    if (Result.isError(kp)) throw new Error("gen failed");

    const data = new Uint8Array([10, 20, 30]);
    const sig = await signEd25519(kp.value.privateKey, data);
    expect(Result.isOk(sig)).toBe(true);
    if (Result.isError(sig)) throw new Error("sign failed");

    const valid = await verifyEd25519(kp.value.publicKey, data, sig.value);
    expect(Result.isOk(valid)).toBe(true);
    if (Result.isError(valid)) throw new Error("verify failed");
    expect(valid.value).toBe(true);
  });

  test("exports and re-imports private key", async () => {
    const kp = await generateEd25519KeyPair();
    if (Result.isError(kp)) throw new Error("gen failed");

    const exported = await exportPrivateKey(kp.value.privateKey);
    expect(Result.isOk(exported)).toBe(true);
    if (Result.isError(exported)) throw new Error("export failed");

    const reimported = await importEd25519PrivateKey(exported.value);
    expect(Result.isOk(reimported)).toBe(true);
    if (Result.isError(reimported)) throw new Error("import failed");

    // Sign with reimported key, verify with original public key
    const data = new Uint8Array([99]);
    const sig = await signEd25519(reimported.value, data);
    if (Result.isError(sig)) throw new Error("sign failed");
    const valid = await verifyEd25519(kp.value.publicKey, data, sig.value);
    if (Result.isError(valid)) throw new Error("verify failed");
    expect(valid.value).toBe(true);
  });
});

describe("exportPublicKey", () => {
  test("exports P-256 public key as bytes", async () => {
    const kp = await generateP256KeyPair();
    if (Result.isError(kp)) throw new Error("gen failed");

    const exported = await exportPublicKey(kp.value.publicKey);
    expect(Result.isOk(exported)).toBe(true);
    if (Result.isError(exported)) throw new Error("export failed");
    // P-256 uncompressed public key is 65 bytes (0x04 + 32 + 32)
    expect(exported.value.byteLength).toBe(65);
    expect(exported.value[0]).toBe(0x04);
  });

  test("exports Ed25519 public key as bytes", async () => {
    const kp = await generateEd25519KeyPair();
    if (Result.isError(kp)) throw new Error("gen failed");

    const exported = await exportPublicKey(kp.value.publicKey);
    expect(Result.isOk(exported)).toBe(true);
    if (Result.isError(exported)) throw new Error("export failed");
    // Ed25519 public key is 32 bytes
    expect(exported.value.byteLength).toBe(32);
  });
});

describe("fingerprint", () => {
  test("produces a hex-encoded SHA-256 fingerprint", async () => {
    const kp = await generateEd25519KeyPair();
    if (Result.isError(kp)) throw new Error("gen failed");

    const fp = await fingerprint(kp.value.publicKey);
    expect(Result.isOk(fp)).toBe(true);
    if (Result.isError(fp)) throw new Error("fingerprint failed");
    // SHA-256 hex = 64 characters
    expect(fp.value).toHaveLength(64);
    expect(fp.value).toMatch(/^[0-9a-f]{64}$/);
  });

  test("same key produces same fingerprint", async () => {
    const kp = await generateEd25519KeyPair();
    if (Result.isError(kp)) throw new Error("gen failed");

    const fp1 = await fingerprint(kp.value.publicKey);
    const fp2 = await fingerprint(kp.value.publicKey);
    if (Result.isError(fp1) || Result.isError(fp2))
      throw new Error("fp failed");
    expect(fp1.value).toBe(fp2.value);
  });
});
