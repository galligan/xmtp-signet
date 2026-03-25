import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Result } from "better-result";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createVault, type Vault } from "../vault.js";
import { createAdminKeyManager, type AdminKeyManager } from "../admin-key.js";
import { base64urlDecode } from "../jwt.js";

/** Decode a JWT payload without verification (for test assertions). */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT");
  const payloadPart = parts[1];
  if (payloadPart === undefined) throw new Error("Missing payload");
  const decoded = base64urlDecode(payloadPart);
  const text = new TextDecoder().decode(decoded);
  return JSON.parse(text) as Record<string, unknown>;
}

describe("AdminKeyManager", () => {
  let dataDir: string;
  let vault: Vault;
  let admin: AdminKeyManager;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "admin-key-test-"));
    const vaultResult = await createVault(dataDir);
    if (Result.isError(vaultResult)) throw new Error("vault setup failed");
    vault = vaultResult.value;
    admin = createAdminKeyManager(vault);
  });

  afterEach(() => {
    vault.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe("create", () => {
    test("creates admin key and returns record", async () => {
      const result = await admin.create();
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("create failed");

      const record = result.value;
      expect(record.keyId).toMatch(/^key_[0-9a-f]{8}$/);
      expect(record.publicKey).toMatch(/^[0-9a-f]{64}$/);
      expect(record.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(record.createdAt).toBeDefined();
      expect(record.rotatedAt).toBeNull();
    });

    test("fails with InternalError when admin key already exists", async () => {
      const first = await admin.create();
      if (Result.isError(first)) throw new Error("first create failed");

      const second = await admin.create();
      expect(Result.isError(second)).toBe(true);
      if (Result.isOk(second)) throw new Error("expected error");
      expect(second.error._tag).toBe("InternalError");
    });
  });

  describe("get", () => {
    test("returns the created admin key record", async () => {
      const created = await admin.create();
      if (Result.isError(created)) throw new Error("create failed");

      const result = await admin.get();
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("get failed");

      expect(result.value.keyId).toBe(created.value.keyId);
      expect(result.value.publicKey).toBe(created.value.publicKey);
      expect(result.value.fingerprint).toBe(created.value.fingerprint);
    });

    test("returns NotFoundError when no admin key exists", async () => {
      const result = await admin.get();
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error._tag).toBe("NotFoundError");
    });
  });

  describe("exists", () => {
    test("returns false when no admin key exists", () => {
      expect(admin.exists()).toBe(false);
    });

    test("returns true after admin key is created", async () => {
      await admin.create();
      expect(admin.exists()).toBe(true);
    });
  });

  describe("rotate", () => {
    test("replaces admin key with new key pair", async () => {
      const original = await admin.create();
      if (Result.isError(original)) throw new Error("create failed");

      const rotated = await admin.rotate();
      expect(Result.isOk(rotated)).toBe(true);
      if (Result.isError(rotated)) throw new Error("rotate failed");

      expect(rotated.value.fingerprint).not.toBe(original.value.fingerprint);
      expect(rotated.value.publicKey).not.toBe(original.value.publicKey);
      expect(rotated.value.rotatedAt).not.toBeNull();
    });

    test("returns NotFoundError when no admin key exists", async () => {
      const result = await admin.rotate();
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error._tag).toBe("NotFoundError");
    });

    test("old JWTs fail verification after rotation", async () => {
      await admin.create();
      const oldJwt = await admin.signJwt();
      if (Result.isError(oldJwt)) throw new Error("sign failed");

      await admin.rotate();

      const result = await admin.verifyJwt(oldJwt.value);
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error._tag).toBe("AuthError");
    });

    test("new JWTs succeed after rotation", async () => {
      await admin.create();
      await admin.rotate();

      const newJwt = await admin.signJwt();
      if (Result.isError(newJwt)) throw new Error("sign failed");

      const result = await admin.verifyJwt(newJwt.value);
      expect(Result.isOk(result)).toBe(true);
    });
  });

  describe("signJwt", () => {
    test("produces a valid 3-part compact JWT", async () => {
      await admin.create();
      const result = await admin.signJwt();
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("sign failed");

      const parts = result.value.split(".");
      expect(parts).toHaveLength(3);
    });

    test("JWT payload has correct claims", async () => {
      const created = await admin.create();
      if (Result.isError(created)) throw new Error("create failed");

      const jwt = await admin.signJwt();
      if (Result.isError(jwt)) throw new Error("sign failed");

      const payload = decodeJwtPayload(jwt.value);
      expect(payload.sub).toBe("admin");
      expect(payload.iss).toBe(created.value.fingerprint);
      expect(typeof payload.iat).toBe("number");
      expect(typeof payload.exp).toBe("number");
      expect(typeof payload.jti).toBe("string");
    });

    test("returns NotFoundError when no admin key exists", async () => {
      const result = await admin.signJwt();
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error._tag).toBe("NotFoundError");
    });

    test("rejects TTL exceeding max with ValidationError", async () => {
      await admin.create();
      const result = await admin.signJwt({ ttlSeconds: 7200 });
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error._tag).toBe("ValidationError");
    });

    test("rejects TTL of zero with ValidationError", async () => {
      await admin.create();
      const result = await admin.signJwt({ ttlSeconds: 0 });
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error._tag).toBe("ValidationError");
    });

    test("rejects negative TTL with ValidationError", async () => {
      await admin.create();
      const result = await admin.signJwt({ ttlSeconds: -1 });
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error._tag).toBe("ValidationError");
    });

    test("rejects fractional TTL with ValidationError", async () => {
      await admin.create();
      const result = await admin.signJwt({ ttlSeconds: 1.5 });
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error._tag).toBe("ValidationError");
    });

    test("rejects NaN TTL with ValidationError", async () => {
      await admin.create();
      const result = await admin.signJwt({ ttlSeconds: NaN });
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error._tag).toBe("ValidationError");
    });

    test("each call produces a unique jti", async () => {
      await admin.create();
      const jwt1 = await admin.signJwt();
      const jwt2 = await admin.signJwt();
      if (Result.isError(jwt1) || Result.isError(jwt2))
        throw new Error("sign failed");

      const p1 = decodeJwtPayload(jwt1.value);
      const p2 = decodeJwtPayload(jwt2.value);
      expect(p1.jti).not.toBe(p2.jti);
    });

    test("respects custom TTL", async () => {
      await admin.create();
      const jwt = await admin.signJwt({ ttlSeconds: 300 });
      if (Result.isError(jwt)) throw new Error("sign failed");

      const payload = decodeJwtPayload(jwt.value);
      const iat = payload.iat as number;
      const exp = payload.exp as number;
      expect(exp - iat).toBe(300);
    });
  });

  describe("verifyJwt", () => {
    test("verifies a valid JWT", async () => {
      const created = await admin.create();
      if (Result.isError(created)) throw new Error("create failed");

      const jwt = await admin.signJwt();
      if (Result.isError(jwt)) throw new Error("sign failed");

      const result = await admin.verifyJwt(jwt.value);
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("verify failed");
      expect(result.value.sub).toBe("admin");
      expect(result.value.iss).toBe(created.value.fingerprint);
    });

    test("rejects tampered signature with AuthError", async () => {
      await admin.create();
      const jwt = await admin.signJwt();
      if (Result.isError(jwt)) throw new Error("sign failed");

      const tampered = jwt.value.slice(0, -4) + "AAAA";
      const result = await admin.verifyJwt(tampered);
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error._tag).toBe("AuthError");
    });

    test("rejects malformed JWT with ValidationError", async () => {
      await admin.create();
      const result = await admin.verifyJwt("not.a.valid.jwt.token");
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error._tag).toBe("ValidationError");
    });

    test("rejects invalid payload schema with ValidationError", async () => {
      await admin.create();
      // Manually craft a JWT with invalid payload (missing required fields)
      const header = btoa(JSON.stringify({ alg: "EdDSA", typ: "JWT" }))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      const payload = btoa(JSON.stringify({ foo: "bar" }))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      const fakeSig = btoa("fakesig")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      const result = await admin.verifyJwt(`${header}.${payload}.${fakeSig}`);
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      // Could be ValidationError or AuthError depending on check order
      expect(["ValidationError", "AuthError"]).toContain(result.error._tag);
    });
  });

  describe("exportPublicKey", () => {
    test("returns hex-encoded public key", async () => {
      await admin.create();
      const result = await admin.exportPublicKey();
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("export failed");
      expect(result.value).toMatch(/^[0-9a-f]{64}$/);
    });

    test("returns NotFoundError when no admin key exists", async () => {
      const result = await admin.exportPublicKey();
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error._tag).toBe("NotFoundError");
    });
  });

  describe("vault isolation", () => {
    test("admin keys use admin-key: prefix", async () => {
      await admin.create();
      const keys = vault.list();
      const adminKeys = keys.filter((k) => k.startsWith("admin-key:"));
      expect(adminKeys.length).toBeGreaterThanOrEqual(3);
      expect(adminKeys).toContain("admin-key:private");
      expect(adminKeys).toContain("admin-key:public");
      expect(adminKeys).toContain("admin-key:meta");
    });

    test("admin keys do not collide with op-key: prefix", async () => {
      await admin.create();
      const keys = vault.list();
      const opKeys = keys.filter((k) => k.startsWith("op-key:"));
      const adminKeys = keys.filter((k) => k.startsWith("admin-key:"));
      // No overlap between prefixes
      for (const ak of adminKeys) {
        expect(opKeys).not.toContain(ak);
      }
    });
  });
});
