import { describe, test, expect } from "bun:test";
import { Result } from "better-result";
import type { SealPayloadType, RevocationSeal } from "@xmtp/signet-schemas";
import { createSealStamper, type SigningKeyHandle } from "../stamper.js";

/** Deterministic Ed25519-like test signer backed by Web Crypto. */
async function createTestKeyHandle(): Promise<SigningKeyHandle> {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]);

  const raw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const hex = Array.from(new Uint8Array(raw))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return {
    fingerprint: () => `key_${hex.slice(0, 8)}`,
    async sign(data: Uint8Array): Promise<Uint8Array> {
      const sig = await crypto.subtle.sign(
        { name: "Ed25519" },
        keyPair.privateKey,
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      );
      return new Uint8Array(sig);
    },
  };
}

function makePayload(overrides?: Partial<SealPayloadType>): SealPayloadType {
  return {
    sealId: "seal_0000000000000001",
    credentialId: "cred_abcd1234feedbabe",
    operatorId: "op_abcd1234feedbabe",
    chatId: "conv_abcd1234feedbabe",
    scopeMode: "per-chat",
    permissions: { allow: ["send", "reply"], deny: [] },
    issuedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRevocation(overrides?: Partial<RevocationSeal>): RevocationSeal {
  return {
    sealId: "seal_0000000000000002",
    previousSealId: "seal_0000000000000001",
    operatorId: "op_abcd1234feedbabe",
    credentialId: "cred_abcd1234feedbabe",
    chatId: "conv_abcd1234feedbabe",
    reason: "owner-initiated",
    revokedAt: "2025-01-01T12:00:00.000Z",
    issuer: "signet-1",
    ...overrides,
  };
}

describe("createSealStamper", () => {
  describe("sign", () => {
    test("produces a valid SealEnvelopeType with correct structure", async () => {
      const keyHandle = await createTestKeyHandle();
      const stamper = createSealStamper({ signingKey: keyHandle });
      const payload = makePayload();

      const result = await stamper.sign(payload);

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;

      const envelope = result.value;
      expect(envelope.chain.current).toEqual(payload);
      expect(envelope.algorithm).toBe("Ed25519");
      expect(envelope.keyId).toBe(keyHandle.fingerprint());
      // Signature should be non-empty base64
      expect(envelope.signature.length).toBeGreaterThan(0);
      expect(() => atob(envelope.signature)).not.toThrow();
    });

    test("produces deterministic signatures for the same input", async () => {
      const keyHandle = await createTestKeyHandle();
      const stamper = createSealStamper({ signingKey: keyHandle });
      const payload = makePayload();

      const result1 = await stamper.sign(payload);
      const result2 = await stamper.sign(payload);

      expect(Result.isOk(result1)).toBe(true);
      expect(Result.isOk(result2)).toBe(true);
      if (!Result.isOk(result1) || !Result.isOk(result2)) return;

      expect(result1.value.signature).toBe(result2.value.signature);
    });

    test("produces different signatures for different inputs", async () => {
      const keyHandle = await createTestKeyHandle();
      const stamper = createSealStamper({ signingKey: keyHandle });

      const payload1 = makePayload({ sealId: "seal_0000000000000001" });
      const payload2 = makePayload({ sealId: "seal_0000000000000002" });

      const result1 = await stamper.sign(payload1);
      const result2 = await stamper.sign(payload2);

      expect(Result.isOk(result1)).toBe(true);
      expect(Result.isOk(result2)).toBe(true);
      if (!Result.isOk(result1) || !Result.isOk(result2)) return;

      expect(result1.value.signature).not.toBe(result2.value.signature);
    });
  });

  describe("signRevocation", () => {
    test("produces a valid SignedRevocationEnvelope", async () => {
      const keyHandle = await createTestKeyHandle();
      const stamper = createSealStamper({ signingKey: keyHandle });
      const revocation = makeRevocation();

      const result = await stamper.signRevocation(revocation);

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;

      const envelope = result.value;
      expect(envelope.revocation).toEqual(revocation);
      expect(envelope.signatureAlgorithm).toBe("Ed25519");
      expect(envelope.signerKeyRef).toBe(keyHandle.fingerprint());
      expect(envelope.signature.length).toBeGreaterThan(0);
      expect(() => atob(envelope.signature)).not.toThrow();
    });

    test("produces deterministic signatures for the same revocation", async () => {
      const keyHandle = await createTestKeyHandle();
      const stamper = createSealStamper({ signingKey: keyHandle });
      const revocation = makeRevocation();

      const result1 = await stamper.signRevocation(revocation);
      const result2 = await stamper.signRevocation(revocation);

      expect(Result.isOk(result1)).toBe(true);
      expect(Result.isOk(result2)).toBe(true);
      if (!Result.isOk(result1) || !Result.isOk(result2)) return;

      expect(result1.value.signature).toBe(result2.value.signature);
    });
  });

  describe("error handling", () => {
    test("returns error when signing key fails", async () => {
      const failingKey: SigningKeyHandle = {
        fingerprint: () => "key_badkey01",
        sign: async () => {
          throw new Error("key material unavailable");
        },
      };
      const stamper = createSealStamper({ signingKey: failingKey });
      const payload = makePayload();

      const result = await stamper.sign(payload);

      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) return;
      expect(result.error._tag).toBe("InternalError");
    });
  });
});
