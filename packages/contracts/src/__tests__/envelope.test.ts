import { describe, expect, test } from "bun:test";
import { SignedRevocationEnvelope } from "../seal-envelope.js";

/** Minimal valid revocation payload matching v1 RevocationSeal. */
function validRevocation() {
  return {
    sealId: "seal_fedc1234deadbeef",
    previousSealId: "seal_beef1234cafefeed",
    operatorId: "op_a9e41234feedbabe",
    credentialId: "cred_abc12345fedcba98",
    chatId: "conv_c0ffee12faceb00c",
    reason: "owner-initiated",
    revokedAt: "2026-01-01T00:30:00Z",
    issuer: "signet-1",
  };
}

describe("SignedRevocationEnvelope", () => {
  test("accepts a valid signed revocation", () => {
    const input = {
      revocation: validRevocation(),
      signature: "dGVzdC1zaWduYXR1cmU=",
      signatureAlgorithm: "Ed25519",
      signerKeyRef: "key-ref-001",
    };

    const result = SignedRevocationEnvelope.safeParse(input);
    expect(result.success).toBe(true);
  });

  test("rejects missing revocation", () => {
    const input = {
      signature: "dGVzdC1zaWduYXR1cmU=",
      signatureAlgorithm: "Ed25519",
      signerKeyRef: "key-ref-001",
    };

    const result = SignedRevocationEnvelope.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("rejects invalid revocation payload", () => {
    const input = {
      revocation: { sealId: "seal_fedc1234deadbeef" },
      signature: "dGVzdC1zaWduYXR1cmU=",
      signatureAlgorithm: "Ed25519",
      signerKeyRef: "key-ref-001",
    };

    const result = SignedRevocationEnvelope.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("rejects missing signature", () => {
    const input = {
      revocation: validRevocation(),
      signatureAlgorithm: "Ed25519",
      signerKeyRef: "key-ref-001",
    };

    const result = SignedRevocationEnvelope.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("rejects invalid revocation reason", () => {
    const input = {
      revocation: { ...validRevocation(), reason: "invalid-reason" },
      signature: "dGVzdC1zaWduYXR1cmU=",
      signatureAlgorithm: "Ed25519",
      signerKeyRef: "key-ref-001",
    };

    const result = SignedRevocationEnvelope.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("rejects empty revocation signature", () => {
    const input = {
      revocation: validRevocation(),
      signature: "",
      signatureAlgorithm: "Ed25519",
      signerKeyRef: "key-ref-001",
    };

    const result = SignedRevocationEnvelope.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("rejects non-base64 revocation signature", () => {
    const input = {
      revocation: validRevocation(),
      signature: "not-base64!!!",
      signatureAlgorithm: "Ed25519",
      signerKeyRef: "key-ref-001",
    };

    const result = SignedRevocationEnvelope.safeParse(input);
    expect(result.success).toBe(false);
  });
});
