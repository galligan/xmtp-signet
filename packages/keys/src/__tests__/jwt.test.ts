import { describe, test, expect } from "bun:test";
import {
  base64urlEncode,
  base64urlDecode,
  encodeJwt,
  decodeJwt,
  signJwt,
  verifyJwt,
  AdminJwtConfigSchema,
} from "../jwt.js";
import { generateEd25519KeyPair, exportPublicKey } from "../crypto-keys.js";
import { Result } from "better-result";

describe("base64url", () => {
  test("round-trips arbitrary bytes", () => {
    const data = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const encoded = base64urlEncode(data);
    const decoded = base64urlDecode(encoded);
    expect(decoded).toEqual(data);
  });

  test("round-trips empty data", () => {
    const data = new Uint8Array([]);
    const encoded = base64urlEncode(data);
    const decoded = base64urlDecode(encoded);
    expect(decoded).toEqual(data);
  });

  test("round-trips all byte values", () => {
    const data = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      data[i] = i;
    }
    const encoded = base64urlEncode(data);
    const decoded = base64urlDecode(encoded);
    expect(decoded).toEqual(data);
  });

  test("produces URL-safe output without padding", () => {
    const data = new Uint8Array([255, 254, 253]);
    const encoded = base64urlEncode(data);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
  });
});

describe("encodeJwt / decodeJwt", () => {
  test("encodes header and payload into two base64url parts", () => {
    const header = { alg: "EdDSA", typ: "JWT" };
    const payload = { sub: "admin", iss: "test" };
    const encoded = encodeJwt(header, payload);
    expect(encoded.split(".")).toHaveLength(2);
  });

  test("decodeJwt round-trips the payload", () => {
    const header = { alg: "EdDSA", typ: "JWT" };
    const payload = {
      iss: "abc123",
      sub: "admin",
      iat: 1000,
      exp: 2000,
      jti: "nonce123",
    };
    const encoded = encodeJwt(header, payload);
    const decoded = decodeJwt(encoded);
    expect(Result.isOk(decoded)).toBe(true);
    if (Result.isError(decoded)) throw new Error("decode failed");
    expect(decoded.value.header).toEqual(header);
    expect(decoded.value.payload).toEqual(payload);
  });

  test("decodeJwt rejects string with wrong part count", () => {
    const result = decodeJwt("one.two.three.four");
    expect(Result.isError(result)).toBe(true);
    if (Result.isOk(result)) throw new Error("expected error");
    expect(result.error._tag).toBe("ValidationError");
  });

  test("decodeJwt rejects invalid base64url", () => {
    const result = decodeJwt("!!!.@@@");
    expect(Result.isError(result)).toBe(true);
  });
});

describe("signJwt / verifyJwt", () => {
  test("sign and verify round-trip succeeds", async () => {
    const keyPair = await generateEd25519KeyPair();
    if (Result.isError(keyPair)) throw new Error("keygen failed");

    const payload = {
      iss: "fingerprint-hex",
      sub: "admin" as const,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 120,
      jti: "abc123",
    };

    const token = await signJwt(keyPair.value.privateKey, payload);
    expect(Result.isOk(token)).toBe(true);
    if (Result.isError(token)) throw new Error("sign failed");

    const parts = token.value.split(".");
    expect(parts).toHaveLength(3);

    const pubBytes = await exportPublicKey(keyPair.value.publicKey);
    if (Result.isError(pubBytes)) throw new Error("export failed");

    const verified = await verifyJwt(token.value, pubBytes.value);
    expect(Result.isOk(verified)).toBe(true);
    if (Result.isError(verified)) throw new Error("verify failed");
    expect(verified.value.sub).toBe("admin");
    expect(verified.value.iss).toBe("fingerprint-hex");
  });

  test("verifyJwt rejects tampered signature", async () => {
    const keyPair = await generateEd25519KeyPair();
    if (Result.isError(keyPair)) throw new Error("keygen failed");

    const payload = {
      iss: "fp",
      sub: "admin" as const,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 120,
      jti: "nonce",
    };

    const token = await signJwt(keyPair.value.privateKey, payload);
    if (Result.isError(token)) throw new Error("sign failed");

    const tampered = token.value.slice(0, -4) + "AAAA";
    const pubBytes = await exportPublicKey(keyPair.value.publicKey);
    if (Result.isError(pubBytes)) throw new Error("export failed");

    const result = await verifyJwt(tampered, pubBytes.value);
    expect(Result.isError(result)).toBe(true);
    if (Result.isOk(result)) throw new Error("expected error");
    expect(result.error._tag).toBe("AuthError");
  });

  test("verifyJwt rejects expired token", async () => {
    const keyPair = await generateEd25519KeyPair();
    if (Result.isError(keyPair)) throw new Error("keygen failed");

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: "fp",
      sub: "admin" as const,
      iat: now - 600,
      exp: now - 300,
      jti: "nonce",
    };

    const token = await signJwt(keyPair.value.privateKey, payload);
    if (Result.isError(token)) throw new Error("sign failed");

    const pubBytes = await exportPublicKey(keyPair.value.publicKey);
    if (Result.isError(pubBytes)) throw new Error("export failed");

    const result = await verifyJwt(token.value, pubBytes.value);
    expect(Result.isError(result)).toBe(true);
    if (Result.isOk(result)) throw new Error("expected error");
    expect(result.error._tag).toBe("AuthError");
  });

  test("verifyJwt accepts token within clock skew tolerance", async () => {
    const keyPair = await generateEd25519KeyPair();
    if (Result.isError(keyPair)) throw new Error("keygen failed");

    const now = Math.floor(Date.now() / 1000);
    // Token expired 10 seconds ago but within 30s skew
    const payload = {
      iss: "fp",
      sub: "admin" as const,
      iat: now - 120,
      exp: now - 10,
      jti: "nonce",
    };

    const token = await signJwt(keyPair.value.privateKey, payload);
    if (Result.isError(token)) throw new Error("sign failed");

    const pubBytes = await exportPublicKey(keyPair.value.publicKey);
    if (Result.isError(pubBytes)) throw new Error("export failed");

    const result = await verifyJwt(token.value, pubBytes.value, {
      clockSkewSeconds: 30,
    });
    expect(Result.isOk(result)).toBe(true);
  });

  test("verifyJwt rejects token issued in the future beyond skew", async () => {
    const keyPair = await generateEd25519KeyPair();
    if (Result.isError(keyPair)) throw new Error("keygen failed");

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: "fp",
      sub: "admin" as const,
      iat: now + 300,
      exp: now + 600,
      jti: "nonce",
    };

    const token = await signJwt(keyPair.value.privateKey, payload);
    if (Result.isError(token)) throw new Error("sign failed");

    const pubBytes = await exportPublicKey(keyPair.value.publicKey);
    if (Result.isError(pubBytes)) throw new Error("export failed");

    const result = await verifyJwt(token.value, pubBytes.value, {
      clockSkewSeconds: 30,
    });
    expect(Result.isError(result)).toBe(true);
    if (Result.isOk(result)) throw new Error("expected error");
    expect(result.error._tag).toBe("ValidationError");
  });

  test("verifyJwt rejects malformed token (not 3 parts)", async () => {
    const keyPair = await generateEd25519KeyPair();
    if (Result.isError(keyPair)) throw new Error("keygen failed");

    const pubBytes = await exportPublicKey(keyPair.value.publicKey);
    if (Result.isError(pubBytes)) throw new Error("export failed");

    const result = await verifyJwt("not-a-jwt", pubBytes.value);
    expect(Result.isError(result)).toBe(true);
    if (Result.isOk(result)) throw new Error("expected error");
    expect(result.error._tag).toBe("ValidationError");
  });

  test("verifyJwt rejects wrong key", async () => {
    const keyPair1 = await generateEd25519KeyPair();
    const keyPair2 = await generateEd25519KeyPair();
    if (Result.isError(keyPair1) || Result.isError(keyPair2))
      throw new Error("keygen failed");

    const payload = {
      iss: "fp",
      sub: "admin" as const,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 120,
      jti: "nonce",
    };

    const token = await signJwt(keyPair1.value.privateKey, payload);
    if (Result.isError(token)) throw new Error("sign failed");

    const wrongPubBytes = await exportPublicKey(keyPair2.value.publicKey);
    if (Result.isError(wrongPubBytes)) throw new Error("export failed");

    const result = await verifyJwt(token.value, wrongPubBytes.value);
    expect(Result.isError(result)).toBe(true);
    if (Result.isOk(result)) throw new Error("expected error");
    expect(result.error._tag).toBe("AuthError");
  });
});

describe("AdminJwtConfigSchema", () => {
  test("applies defaults", () => {
    const parsed = AdminJwtConfigSchema.parse({});
    expect(parsed.defaultTtlSeconds).toBe(120);
    expect(parsed.maxTtlSeconds).toBe(3600);
    expect(parsed.clockSkewSeconds).toBe(30);
  });

  test("accepts custom values", () => {
    const parsed = AdminJwtConfigSchema.parse({
      defaultTtlSeconds: 60,
      maxTtlSeconds: 1800,
      clockSkewSeconds: 10,
    });
    expect(parsed.defaultTtlSeconds).toBe(60);
    expect(parsed.maxTtlSeconds).toBe(1800);
    expect(parsed.clockSkewSeconds).toBe(10);
  });
});
