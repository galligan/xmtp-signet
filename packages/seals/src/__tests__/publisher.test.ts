import { describe, test, expect } from "bun:test";
import { Result } from "better-result";
import { InternalError } from "@xmtp/signet-schemas";
import type { SealEnvelopeType } from "@xmtp/signet-schemas";
import type { SignedRevocationEnvelope } from "@xmtp/signet-contracts";
import {
  SEAL_CONTENT_TYPE_ID,
  REVOCATION_CONTENT_TYPE_ID,
} from "../content-type.js";
import { createSealPublisher, type PublisherDeps } from "../publisher.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSealEnvelope(): SealEnvelopeType {
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

function makeRevocationEnvelope(): SignedRevocationEnvelope {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SealPublisher", () => {
  test("publish sends seal with correct content type", async () => {
    const calls: Array<{
      groupId: string;
      contentType: string;
      content: unknown;
    }> = [];

    const deps: PublisherDeps = {
      async sendMessage(groupId, contentType, content) {
        calls.push({ groupId, contentType, content });
        return Result.ok({ messageId: "msg-001" });
      },
    };

    const publisher = createSealPublisher(deps);
    const envelope = makeSealEnvelope();
    const result = await publisher.publish("conv_abcd1234feedbabe", envelope);

    expect(Result.isOk(result)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.groupId).toBe("conv_abcd1234feedbabe");
    expect(calls[0]!.contentType).toBe(SEAL_CONTENT_TYPE_ID);
    // Content should be a JSON string of the envelope
    expect(typeof calls[0]!.content).toBe("string");
    const parsed = JSON.parse(calls[0]!.content as string);
    expect(parsed.chain.current.sealId).toBe("seal_0000000000000001");
  });

  test("publishRevocation sends with correct content type", async () => {
    const calls: Array<{
      groupId: string;
      contentType: string;
      content: unknown;
    }> = [];

    const deps: PublisherDeps = {
      async sendMessage(groupId, contentType, content) {
        calls.push({ groupId, contentType, content });
        return Result.ok({ messageId: "msg-002" });
      },
    };

    const publisher = createSealPublisher(deps);
    const revocation = makeRevocationEnvelope();
    const result = await publisher.publishRevocation(
      "conv_abcd1234feedbabe",
      revocation,
    );

    expect(Result.isOk(result)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.groupId).toBe("conv_abcd1234feedbabe");
    expect(calls[0]!.contentType).toBe(REVOCATION_CONTENT_TYPE_ID);
    const parsed = JSON.parse(calls[0]!.content as string);
    expect(parsed.revocation.sealId).toBe("seal_0000000000000002");
  });

  test("error from sendMessage is propagated", async () => {
    const deps: PublisherDeps = {
      async sendMessage(_groupId, _contentType, _content) {
        return Result.err(InternalError.create("Network failure"));
      },
    };

    const publisher = createSealPublisher(deps);
    const envelope = makeSealEnvelope();
    const result = await publisher.publish("conv_abcd1234feedbabe", envelope);

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.message).toContain("Network failure");
    }
  });

  test("publishRevocation propagates sendMessage error", async () => {
    const deps: PublisherDeps = {
      async sendMessage(_groupId, _contentType, _content) {
        return Result.err(InternalError.create("Revocation send failed"));
      },
    };

    const publisher = createSealPublisher(deps);
    const revocation = makeRevocationEnvelope();
    const result = await publisher.publishRevocation(
      "conv_abcd1234feedbabe",
      revocation,
    );

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.message).toContain("Revocation send failed");
    }
  });
});
