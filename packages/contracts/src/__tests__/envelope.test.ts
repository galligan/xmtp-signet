import { describe, expect, test } from "bun:test";
import {
  SignedAttestationEnvelope,
  SignedRevocationEnvelope,
} from "../attestation-types.js";

/** Minimal valid attestation payload matching AttestationSchema. */
function validAttestation() {
  return {
    attestationId: "att-001",
    previousAttestationId: null,
    agentInboxId: "agent-inbox-1",
    ownerInboxId: "owner-inbox-1",
    groupId: "group-1",
    threadScope: null,
    viewMode: "full",
    contentTypes: ["xmtp.org/text:1.0"],
    grantedOps: ["send"],
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
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2026-01-01T01:00:00Z",
    revocationRules: {
      maxTtlSeconds: 3600,
      requireHeartbeat: true,
      ownerCanRevoke: true,
      adminCanRemove: true,
    },
    issuer: "broker-1",
  };
}

/** Minimal valid revocation payload matching RevocationAttestation. */
function validRevocation() {
  return {
    attestationId: "rev-001",
    previousAttestationId: "att-001",
    agentInboxId: "agent-inbox-1",
    groupId: "group-1",
    reason: "owner-initiated",
    revokedAt: "2026-01-01T00:30:00Z",
    issuer: "broker-1",
  };
}

describe("SignedAttestationEnvelope", () => {
  test("accepts a valid signed attestation", () => {
    const input = {
      attestation: validAttestation(),
      signature: "dGVzdC1zaWduYXR1cmU=",
      signatureAlgorithm: "Ed25519",
      signerKeyRef: "key-ref-001",
    };

    const result = SignedAttestationEnvelope.safeParse(input);
    expect(result.success).toBe(true);
  });

  test("rejects missing signature", () => {
    const input = {
      attestation: validAttestation(),
      signatureAlgorithm: "Ed25519",
      signerKeyRef: "key-ref-001",
    };

    const result = SignedAttestationEnvelope.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("rejects missing attestation", () => {
    const input = {
      signature: "dGVzdC1zaWduYXR1cmU=",
      signatureAlgorithm: "Ed25519",
      signerKeyRef: "key-ref-001",
    };

    const result = SignedAttestationEnvelope.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("rejects invalid attestation payload", () => {
    const input = {
      attestation: { attestationId: "att-001" },
      signature: "dGVzdC1zaWduYXR1cmU=",
      signatureAlgorithm: "Ed25519",
      signerKeyRef: "key-ref-001",
    };

    const result = SignedAttestationEnvelope.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("rejects missing signatureAlgorithm", () => {
    const input = {
      attestation: validAttestation(),
      signature: "dGVzdC1zaWduYXR1cmU=",
      signerKeyRef: "key-ref-001",
    };

    const result = SignedAttestationEnvelope.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("rejects missing signerKeyRef", () => {
    const input = {
      attestation: validAttestation(),
      signature: "dGVzdC1zaWduYXR1cmU=",
      signatureAlgorithm: "Ed25519",
    };

    const result = SignedAttestationEnvelope.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("rejects empty attestation signature", () => {
    const input = {
      attestation: validAttestation(),
      signature: "",
      signatureAlgorithm: "Ed25519",
      signerKeyRef: "key-ref-001",
    };

    const result = SignedAttestationEnvelope.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("rejects non-base64 attestation signature", () => {
    const input = {
      attestation: validAttestation(),
      signature: "not-base64!!!",
      signatureAlgorithm: "Ed25519",
      signerKeyRef: "key-ref-001",
    };

    const result = SignedAttestationEnvelope.safeParse(input);
    expect(result.success).toBe(false);
  });
});

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
      revocation: { attestationId: "rev-001" },
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
