import type { SealEnvelopeType, SealPayloadType } from "@xmtp/signet-schemas";
import type { VerificationRequest } from "../schemas/request.js";
import type { VerifierConfig } from "../config.js";
import { canonicalize } from "../canonicalize.js";

const BASE_TIME = new Date("2025-01-15T00:00:00.000Z");

/** Creates a test seal payload matching the v1 SealPayload schema. */
export function createTestSeal(
  overrides?: Partial<SealPayloadType>,
): SealPayloadType {
  return {
    sealId: "seal_a1b2c3d4feedbabe",
    credentialId: "cred_abc12345feedbabe",
    operatorId: "op_deadbeeffeedbabe",
    chatId: "conv_c0ffee12feedbabe",
    scopeMode: "per-chat",
    permissions: {
      allow: ["send", "read-messages"],
      deny: [],
    },
    issuedAt: BASE_TIME.toISOString(),
    ...overrides,
  };
}

export function createTestVerificationRequest(
  overrides?: Partial<VerificationRequest>,
): VerificationRequest {
  return {
    requestId: "req-001",
    agentInboxId: "agent-inbox-001",
    signetInboxId: "signet-inbox-001",
    groupId: "group-001",
    seal: createTestSeal(),
    artifactDigest:
      "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    buildProvenanceBundle: null,
    sourceRepoUrl: "https://github.com/xmtp/xmtp-signet",
    releaseTag: null,
    requestedTier: "source-verified",
    challengeNonce: "deadbeef".repeat(8),
    ...overrides,
  };
}

export function createTestSealEnvelope(
  overrides?: Partial<SealEnvelopeType>,
): SealEnvelopeType {
  return {
    chain: {
      current: createTestSeal(),
      delta: { added: [], removed: [], changed: [] },
    },
    signature: "bW9jay1zaWduYXR1cmU=",
    keyId: "key_12345678feedbabe",
    algorithm: "Ed25519",
    ...overrides,
  };
}

export async function createSignedTestSealEnvelope(
  overrides?: Partial<SealPayloadType>,
): Promise<{ envelope: SealEnvelopeType; publicKeyHex: string }> {
  const payload = createTestSeal(overrides);
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]);

  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    keyPair.privateKey,
    canonicalize(payload),
  );

  return {
    envelope: createTestSealEnvelope({
      chain: {
        current: payload,
        delta: { added: [], removed: [], changed: [] },
      },
      signature: Buffer.from(signature).toString("base64"),
      keyId: Buffer.from(rawPublicKey).toString("hex"),
    }),
    publicKeyHex: Buffer.from(rawPublicKey).toString("hex"),
  };
}

export function createTestConfig(
  overrides?: Partial<VerifierConfig>,
): VerifierConfig {
  return {
    verifierInboxId: "verifier-inbox-001",
    sourceRepoUrl: "https://github.com/xmtp/xmtp-verifier",
    statementTtlSeconds: 86400,
    maxRequestsPerRequesterPerHour: 10,
    ...overrides,
  };
}

/** A mock signer that returns a deterministic base64 "signature". */
export async function mockSign(_bytes: Uint8Array): Promise<string> {
  return "bW9jay1zaWduYXR1cmU="; // base64("mock-signature")
}

/** Creates a mock fetch that returns configured responses. */
export function createTestFetcher(
  responses: Record<string, { status: number; ok?: boolean }>,
): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    const config = responses[url];
    if (config === undefined) {
      return new Response(null, { status: 404 });
    }

    return new Response(null, {
      status: config.status,
      // Response.ok is based on status 200-299
    });
  }) as unknown as typeof fetch;
}
