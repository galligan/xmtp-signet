import type { SealPayloadType } from "@xmtp/signet-schemas";
import type { VerificationRequest } from "../schemas/request.js";
import type { VerifierConfig } from "../config.js";

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
