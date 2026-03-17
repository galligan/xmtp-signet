import { describe, expect, test } from "bun:test";
import {
  ATTESTATION_CONTENT_TYPE_ID,
  REVOCATION_CONTENT_TYPE_ID,
  AttestationMessage,
  RevocationMessage,
  encodeAttestationMessage,
  encodeRevocationMessage,
} from "../content-type.js";
import type {
  SignedAttestation,
  SignedRevocationEnvelope,
} from "@xmtp-broker/contracts";
import type { Attestation, RevocationAttestation } from "@xmtp-broker/schemas";

/** Minimal valid signed attestation for testing codec functions. */
function stubSignedAttestation(): SignedAttestation {
  return {
    attestation: {
      attestationId: "att_00000000000000000000000000000001",
      previousAttestationId: null,
      agentInboxId: "agent-1",
      ownerInboxId: "owner-1",
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
      policyHash: "sha256:test",
      heartbeatInterval: 30,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      revocationRules: {
        maxTtlSeconds: 86400,
        requireHeartbeat: true,
        ownerCanRevoke: true,
        adminCanRemove: true,
      },
      issuer: "broker-1",
    } as Attestation,
    signature: "dGVzdA==",
    signatureAlgorithm: "Ed25519",
    signerKeyRef: "test-key",
  };
}

/** Minimal valid signed revocation for testing codec functions. */
function stubSignedRevocation(): SignedRevocationEnvelope {
  return {
    revocation: {
      attestationId: "att_00000000000000000000000000000002",
      previousAttestationId: "att_00000000000000000000000000000001",
      agentInboxId: "agent-1",
      groupId: "group-1",
      reason: "owner-initiated",
      revokedAt: new Date().toISOString(),
      issuer: "broker-1",
    } as RevocationAttestation,
    signature: "dGVzdA==",
    signatureAlgorithm: "Ed25519",
    signerKeyRef: "test-key",
  };
}

describe("content type IDs", () => {
  test("ATTESTATION_CONTENT_TYPE_ID follows authority/type:version format", () => {
    expect(ATTESTATION_CONTENT_TYPE_ID).toBe("xmtp.org/agentAttestation:1.0");
  });

  test("REVOCATION_CONTENT_TYPE_ID follows authority/type:version format", () => {
    expect(REVOCATION_CONTENT_TYPE_ID).toBe("xmtp.org/agentRevocation:1.0");
  });

  test("content type IDs are distinct", () => {
    expect(ATTESTATION_CONTENT_TYPE_ID).not.toBe(REVOCATION_CONTENT_TYPE_ID);
  });
});

describe("encodeAttestationMessage", () => {
  test("wraps signed attestation with contentType field", () => {
    const envelope = stubSignedAttestation();
    const message = encodeAttestationMessage(envelope);
    expect(message.contentType).toBe(ATTESTATION_CONTENT_TYPE_ID);
    expect(message.attestation).toBe(envelope.attestation);
    expect(message.signature).toBe(envelope.signature);
  });

  test("result validates against AttestationMessage schema", () => {
    const envelope = stubSignedAttestation();
    const message = encodeAttestationMessage(envelope);
    const parsed = AttestationMessage.safeParse(message);
    expect(parsed.success).toBe(true);
  });
});

describe("encodeRevocationMessage", () => {
  test("wraps signed revocation with contentType field", () => {
    const envelope = stubSignedRevocation();
    const message = encodeRevocationMessage(envelope);
    expect(message.contentType).toBe(REVOCATION_CONTENT_TYPE_ID);
    expect(message.revocation).toBe(envelope.revocation);
    expect(message.signature).toBe(envelope.signature);
  });

  test("result validates against RevocationMessage schema", () => {
    const envelope = stubSignedRevocation();
    const message = encodeRevocationMessage(envelope);
    const parsed = RevocationMessage.safeParse(message);
    expect(parsed.success).toBe(true);
  });
});

describe("AttestationMessage schema", () => {
  test("rejects messages without contentType", () => {
    const envelope = stubSignedAttestation();
    const parsed = AttestationMessage.safeParse(envelope);
    expect(parsed.success).toBe(false);
  });

  test("rejects messages with wrong contentType", () => {
    const envelope = stubSignedAttestation();
    const parsed = AttestationMessage.safeParse({
      ...envelope,
      contentType: "wrong/type:1.0",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("RevocationMessage schema", () => {
  test("rejects messages without contentType", () => {
    const envelope = stubSignedRevocation();
    const parsed = RevocationMessage.safeParse(envelope);
    expect(parsed.success).toBe(false);
  });

  test("rejects messages with wrong contentType", () => {
    const envelope = stubSignedRevocation();
    const parsed = RevocationMessage.safeParse({
      ...envelope,
      contentType: "wrong/type:1.0",
    });
    expect(parsed.success).toBe(false);
  });
});
