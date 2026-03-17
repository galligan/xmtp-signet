import { describe, expect, test } from "bun:test";
import {
  SEAL_CONTENT_TYPE_ID,
  REVOCATION_CONTENT_TYPE_ID,
  SealMessage,
  RevocationMessage,
  encodeSealMessage,
  encodeRevocationMessage,
} from "../content-type.js";
import type {
  SealEnvelope,
  SignedRevocationEnvelope,
} from "@xmtp/signet-contracts";
import type { Seal, RevocationSeal } from "@xmtp/signet-schemas";

/** Minimal valid signed seal for testing codec functions. */
function stubSeal(): SealEnvelope {
  return {
    seal: {
      sealId: "att_00000000000000000000000000000001",
      previousSealId: null,
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
      issuer: "signet-1",
    } as Seal,
    signature: "dGVzdA==",
    signatureAlgorithm: "Ed25519",
    signerKeyRef: "test-key",
  };
}

/** Minimal valid signed revocation for testing codec functions. */
function stubSignedRevocation(): SignedRevocationEnvelope {
  return {
    revocation: {
      sealId: "att_00000000000000000000000000000002",
      previousSealId: "att_00000000000000000000000000000001",
      agentInboxId: "agent-1",
      groupId: "group-1",
      reason: "owner-initiated",
      revokedAt: new Date().toISOString(),
      issuer: "signet-1",
    } as RevocationSeal,
    signature: "dGVzdA==",
    signatureAlgorithm: "Ed25519",
    signerKeyRef: "test-key",
  };
}

describe("content type IDs", () => {
  test("SEAL_CONTENT_TYPE_ID follows authority/type:version format", () => {
    expect(SEAL_CONTENT_TYPE_ID).toBe("xmtp.org/agentSeal:1.0");
  });

  test("REVOCATION_CONTENT_TYPE_ID follows authority/type:version format", () => {
    expect(REVOCATION_CONTENT_TYPE_ID).toBe("xmtp.org/agentRevocation:1.0");
  });

  test("content type IDs are distinct", () => {
    expect(SEAL_CONTENT_TYPE_ID).not.toBe(REVOCATION_CONTENT_TYPE_ID);
  });
});

describe("encodeSealMessage", () => {
  test("wraps signed seal with contentType field", () => {
    const envelope = stubSeal();
    const message = encodeSealMessage(envelope);
    expect(message.contentType).toBe(SEAL_CONTENT_TYPE_ID);
    expect(message.seal).toBe(envelope.seal);
    expect(message.signature).toBe(envelope.signature);
  });

  test("result validates against SealMessage schema", () => {
    const envelope = stubSeal();
    const message = encodeSealMessage(envelope);
    const parsed = SealMessage.safeParse(message);
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

describe("SealMessage schema", () => {
  test("rejects messages without contentType", () => {
    const envelope = stubSeal();
    const parsed = SealMessage.safeParse(envelope);
    expect(parsed.success).toBe(false);
  });

  test("rejects messages with wrong contentType", () => {
    const envelope = stubSeal();
    const parsed = SealMessage.safeParse({
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
