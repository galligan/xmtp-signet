import type { Seal } from "@xmtp/signet-schemas";
import type { VerificationRequest } from "../schemas/request.js";
import type { VerifierConfig } from "../config.js";

const BASE_TIME = new Date("2025-01-15T00:00:00.000Z");

export function createTestSeal(overrides?: Partial<Seal>): Seal {
  return {
    sealId: "att-001",
    previousSealId: null,
    agentInboxId: "agent-inbox-001",
    ownerInboxId: "owner-inbox-001",
    groupId: "group-001",
    threadScope: null,
    viewMode: "full",
    contentTypes: ["xmtp.org/text:1.0"],
    grantedOps: ["send"],
    toolScopes: [],
    inferenceMode: "local",
    inferenceProviders: [],
    contentEgressScope: "none",
    retentionAtProvider: "none",
    hostingMode: "self-hosted",
    trustTier: "source-verified",
    buildProvenanceRef: null,
    verifierStatementRef: null,
    sessionKeyFingerprint: null,
    policyHash: "abc123",
    heartbeatInterval: 30,
    issuedAt: BASE_TIME.toISOString(),
    expiresAt: new Date(BASE_TIME.getTime() + 86_400_000).toISOString(),
    revocationRules: {
      maxTtlSeconds: 86400,
      requireHeartbeat: false,
      ownerCanRevoke: true,
      adminCanRemove: true,
    },
    issuer: "signet-signer-001",
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
