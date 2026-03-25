import { describe, expect, test } from "bun:test";
import {
  SEAL_CONTENT_TYPE_ID,
  REVOCATION_CONTENT_TYPE_ID,
  SealMessage,
  RevocationMessage,
  encodeSealMessage,
  encodeRevocationMessage,
} from "../content-type.js";
import type { SealEnvelopeType } from "@xmtp/signet-schemas";
import type { SignedRevocationEnvelope } from "@xmtp/signet-contracts";

/** Minimal valid signed seal for testing codec functions. */
function stubSeal(): SealEnvelopeType {
  return {
    chain: {
      current: {
        sealId: "seal_0000000000000001",
        credentialId: "cred_abcd1234feedbabe",
        operatorId: "op_abcd1234feedbabe",
        chatId: "conv_abcd1234feedbabe",
        scopeMode: "per-chat",
        permissions: { allow: ["send"], deny: [] },
        issuedAt: new Date().toISOString(),
      },
      delta: { added: [], removed: [], changed: [] },
    },
    signature: "dGVzdA==",
    keyId: "key_feedc0defeedbabe",
    algorithm: "Ed25519",
  };
}

/** Minimal valid signed revocation for testing codec functions. */
function stubSignedRevocation(): SignedRevocationEnvelope {
  return {
    revocation: {
      sealId: "seal_0000000000000002",
      previousSealId: "seal_0000000000000001",
      operatorId: "op_abcd1234feedbabe",
      credentialId: "cred_abcd1234feedbabe",
      chatId: "conv_abcd1234feedbabe",
      reason: "owner-initiated",
      revokedAt: new Date().toISOString(),
      issuer: "signet-1",
    },
    signature: "dGVzdA==",
    signatureAlgorithm: "Ed25519",
    signerKeyRef: "key_test0001",
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
    expect(message.chain.current).toBe(envelope.chain.current);
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
