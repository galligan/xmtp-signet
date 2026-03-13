import { describe, test, expect, beforeEach } from "bun:test";
import { Result } from "better-result";
import {
  createSessionKeyManager,
  type SessionKeyManager,
} from "../session-key.js";

describe("SessionKeyManager", () => {
  let sessions: SessionKeyManager;

  beforeEach(() => {
    sessions = createSessionKeyManager();
  });

  describe("issue", () => {
    test("issues a session key bound to a session ID", async () => {
      const result = await sessions.issue("ses_abc", 3600);
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("issue failed");

      const key = result.value;
      expect(key.keyId).toBeDefined();
      expect(key.sessionId).toBe("ses_abc");
      expect(key.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(key.expiresAt).toBeDefined();
      expect(key.createdAt).toBeDefined();
    });

    test("issues unique keys for different sessions", async () => {
      const r1 = await sessions.issue("ses_1", 3600);
      const r2 = await sessions.issue("ses_2", 3600);
      if (Result.isError(r1) || Result.isError(r2))
        throw new Error("issue failed");
      expect(r1.value.keyId).not.toBe(r2.value.keyId);
    });

    test("sets expiry based on TTL", async () => {
      const before = Date.now();
      const result = await sessions.issue("ses_ttl", 60);
      if (Result.isError(result)) throw new Error("issue failed");

      const expiresAt = new Date(result.value.expiresAt).getTime();
      // Should be roughly now + 60 seconds
      expect(expiresAt).toBeGreaterThanOrEqual(before + 59_000);
      expect(expiresAt).toBeLessThanOrEqual(before + 61_000);
    });
  });

  describe("sign", () => {
    test("signs data with a session key", async () => {
      const issued = await sessions.issue("ses_sign", 3600);
      if (Result.isError(issued)) throw new Error("issue failed");

      const data = new Uint8Array([1, 2, 3]);
      const sig = await sessions.sign(issued.value.keyId, data);
      expect(Result.isOk(sig)).toBe(true);
      if (Result.isError(sig)) throw new Error("sign failed");
      expect(sig.value.byteLength).toBeGreaterThan(0);
    });

    test("returns NotFoundError for unknown key ID", async () => {
      const result = await sessions.sign("unknown-key", new Uint8Array([1]));
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error._tag).toBe("NotFoundError");
    });

    test("rejects signing with an expired key", async () => {
      // Issue with 0-second TTL so it expires immediately
      const issued = await sessions.issue("ses_expired", 0);
      if (Result.isError(issued)) throw new Error("issue failed");

      const result = await sessions.sign(
        issued.value.keyId,
        new Uint8Array([1]),
      );
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error._tag).toBe("NotFoundError");
    });

    test("deletes expired key on sign attempt", async () => {
      const issued = await sessions.issue("ses_expired2", 0);
      if (Result.isError(issued)) throw new Error("issue failed");

      // First sign attempt triggers expiry cleanup
      await sessions.sign(issued.value.keyId, new Uint8Array([1]));

      // Revoke should also fail since the key was deleted
      const revokeResult = sessions.revoke(issued.value.keyId);
      expect(Result.isError(revokeResult)).toBe(true);
    });
  });

  describe("revoke", () => {
    test("revokes an issued session key", async () => {
      const issued = await sessions.issue("ses_revoke", 3600);
      if (Result.isError(issued)) throw new Error("issue failed");

      const revokeResult = sessions.revoke(issued.value.keyId);
      expect(Result.isOk(revokeResult)).toBe(true);
    });

    test("signing after revoke fails", async () => {
      const issued = await sessions.issue("ses_revoke2", 3600);
      if (Result.isError(issued)) throw new Error("issue failed");

      sessions.revoke(issued.value.keyId);

      const sig = await sessions.sign(issued.value.keyId, new Uint8Array([1]));
      expect(Result.isError(sig)).toBe(true);
    });

    test("returns NotFoundError for unknown key", () => {
      const result = sessions.revoke("nonexistent");
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error._tag).toBe("NotFoundError");
    });

    test("double revoke returns NotFoundError", async () => {
      const issued = await sessions.issue("ses_double", 3600);
      if (Result.isError(issued)) throw new Error("issue failed");

      sessions.revoke(issued.value.keyId);
      const result = sessions.revoke(issued.value.keyId);
      expect(Result.isError(result)).toBe(true);
    });
  });
});
