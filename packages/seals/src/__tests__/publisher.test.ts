import { describe, test, expect } from "bun:test";
import { Result } from "better-result";
import { InternalError } from "@xmtp/signet-schemas";
import type {
  SealEnvelope,
  SignedRevocationEnvelope,
} from "@xmtp/signet-contracts";
import {
  SEAL_CONTENT_TYPE_ID,
  REVOCATION_CONTENT_TYPE_ID,
} from "../content-type.js";
import { createSealPublisher, type PublisherDeps } from "../publisher.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSealEnvelope(overrides?: Partial<SealEnvelope>): SealEnvelope {
  return {
    seal: {
      sealId: "seal-001",
      previousSealId: null,
      agentInboxId: "agent-inbox-1",
      ownerInboxId: "owner-inbox-1",
      groupId: "group-1",
      threadScope: null,
      view: { read: true, list: true },
      grant: { send: true, react: true },
      inferenceMode: "cloud",
      inferenceProviders: [],
      contentEgressScope: "none",
      retentionAtProvider: null,
      hostingMode: "self",
      trustTier: "standard",
      buildProvenanceRef: null,
      verifierStatementRef: null,
      sessionKeyFingerprint: "fp-001",
      policyHash: "hash-001",
      heartbeatInterval: 300,
      revocationRules: { onSessionExpiry: "auto-revoke" },
      issuer: "signet-001",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    },
    signature: "base64sig",
    signatureAlgorithm: "Ed25519",
    signerKeyRef: "key-ref-001",
    ...overrides,
  } as SealEnvelope;
}

function makeRevocationEnvelope(): SignedRevocationEnvelope {
  return {
    revocation: {
      sealId: "revoke-001",
      previousSealId: "seal-001",
      agentInboxId: "agent-inbox-1",
      groupId: "group-1",
      reason: "session_expired",
      revokedAt: new Date().toISOString(),
      issuer: "signet-001",
    },
    signature: "base64rev-sig",
    signatureAlgorithm: "Ed25519",
    signerKeyRef: "key-ref-001",
  } as SignedRevocationEnvelope;
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
    const result = await publisher.publish("group-1", envelope);

    expect(Result.isOk(result)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.groupId).toBe("group-1");
    expect(calls[0]!.contentType).toBe(SEAL_CONTENT_TYPE_ID);
    // Content should be a JSON string of the envelope
    expect(typeof calls[0]!.content).toBe("string");
    const parsed = JSON.parse(calls[0]!.content as string);
    expect(parsed.seal.sealId).toBe("seal-001");
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
    const result = await publisher.publishRevocation("group-1", revocation);

    expect(Result.isOk(result)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.groupId).toBe("group-1");
    expect(calls[0]!.contentType).toBe(REVOCATION_CONTENT_TYPE_ID);
    const parsed = JSON.parse(calls[0]!.content as string);
    expect(parsed.revocation.sealId).toBe("revoke-001");
  });

  test("error from sendMessage is propagated", async () => {
    const deps: PublisherDeps = {
      async sendMessage(_groupId, _contentType, _content) {
        return Result.err(InternalError.create("Network failure"));
      },
    };

    const publisher = createSealPublisher(deps);
    const envelope = makeSealEnvelope();
    const result = await publisher.publish("group-1", envelope);

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
    const result = await publisher.publishRevocation("group-1", revocation);

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.message).toContain("Revocation send failed");
    }
  });
});
