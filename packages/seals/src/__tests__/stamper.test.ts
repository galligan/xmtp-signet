import { describe, test, expect } from "bun:test";
import { Result } from "better-result";
import type { Seal, RevocationSeal } from "@xmtp/signet-schemas";
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
    fingerprint: () => hex.slice(0, 16),
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

function makeSeal(overrides?: Partial<Seal>): Seal {
  return {
    sealId: "seal-1",
    previousSealId: null,
    agentInboxId: "agent-inbox-1",
    ownerInboxId: "owner-inbox-1",
    groupId: "group-1",
    threadScope: null,
    viewMode: "full",
    contentTypes: ["xmtp.org/text:1.0"],
    grantedOps: ["send", "reply"],
    toolScopes: [],
    inferenceMode: "local",
    inferenceProviders: [],
    contentEgressScope: "none",
    retentionAtProvider: "none",
    hostingMode: "local",
    trustTier: "unverified",
    buildProvenanceRef: null,
    verifierStatementRef: null,
    sessionKeyFingerprint: null,
    policyHash: "sha256:abc123",
    heartbeatInterval: 30,
    issuedAt: "2025-01-01T00:00:00.000Z",
    expiresAt: "2025-01-02T00:00:00.000Z",
    revocationRules: {
      maxTtlSeconds: 86400,
      requireHeartbeat: true,
      ownerCanRevoke: true,
      adminCanRemove: true,
    },
    issuer: "signet-1",
    ...overrides,
  };
}

function makeRevocation(overrides?: Partial<RevocationSeal>): RevocationSeal {
  return {
    sealId: "revoke-1",
    previousSealId: "seal-1",
    agentInboxId: "agent-inbox-1",
    groupId: "group-1",
    reason: "owner-initiated",
    revokedAt: "2025-01-01T12:00:00.000Z",
    issuer: "signet-1",
    ...overrides,
  };
}

describe("createSealStamper", () => {
  describe("sign", () => {
    test("produces a valid SealEnvelope with correct structure", async () => {
      const keyHandle = await createTestKeyHandle();
      const stamper = createSealStamper({ signingKey: keyHandle });
      const seal = makeSeal();

      const result = await stamper.sign(seal);

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;

      const envelope = result.value;
      expect(envelope.seal).toEqual(seal);
      expect(envelope.signatureAlgorithm).toBe("Ed25519");
      expect(envelope.signerKeyRef).toBe(keyHandle.fingerprint());
      // Signature should be non-empty base64
      expect(envelope.signature.length).toBeGreaterThan(0);
      expect(() => atob(envelope.signature)).not.toThrow();
    });

    test("produces deterministic signatures for the same input", async () => {
      const keyHandle = await createTestKeyHandle();
      const stamper = createSealStamper({ signingKey: keyHandle });
      const seal = makeSeal();

      const result1 = await stamper.sign(seal);
      const result2 = await stamper.sign(seal);

      expect(Result.isOk(result1)).toBe(true);
      expect(Result.isOk(result2)).toBe(true);
      if (!Result.isOk(result1) || !Result.isOk(result2)) return;

      expect(result1.value.signature).toBe(result2.value.signature);
    });

    test("produces different signatures for different inputs", async () => {
      const keyHandle = await createTestKeyHandle();
      const stamper = createSealStamper({ signingKey: keyHandle });

      const seal1 = makeSeal({ sealId: "seal-1" });
      const seal2 = makeSeal({ sealId: "seal-2" });

      const result1 = await stamper.sign(seal1);
      const result2 = await stamper.sign(seal2);

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
        fingerprint: () => "bad-key",
        sign: async () => {
          throw new Error("key material unavailable");
        },
      };
      const stamper = createSealStamper({ signingKey: failingKey });
      const seal = makeSeal();

      const result = await stamper.sign(seal);

      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) return;
      expect(result.error._tag).toBe("InternalError");
    });
  });
});
