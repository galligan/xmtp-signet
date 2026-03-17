import { Result } from "better-result";
import type {
  Attestation,
  BrokerError,
  RevocationAttestation,
} from "@xmtp-broker/schemas";
import type {
  AttestationSigner,
  AttestationPublisher,
  SignedAttestation,
  SignedRevocationEnvelope,
} from "@xmtp-broker/contracts";
import type { AttestationInput } from "../build.js";
import type { InputResolver } from "../manager.js";
import { canonicalize } from "../canonicalize.js";

/** Creates a valid AttestationInput for testing. */
export function validInput(
  overrides?: Partial<AttestationInput>,
): AttestationInput {
  return {
    agentInboxId: "agent-inbox-1",
    ownerInboxId: "owner-inbox-1",
    groupId: "group-1",
    threadScope: null,
    view: {
      mode: "full",
      threadScopes: [{ groupId: "group-1", threadId: null }],
      contentTypes: ["xmtp.org/text:1.0"],
    },
    grant: {
      messaging: {
        send: true,
        reply: true,
        react: false,
        draftOnly: false,
      },
      groupManagement: {
        addMembers: false,
        removeMembers: false,
        updateMetadata: false,
        inviteUsers: false,
      },
      tools: { scopes: [] },
      egress: {
        storeExcerpts: false,
        useForMemory: false,
        forwardToProviders: false,
        quoteRevealed: false,
        summarize: false,
      },
    },
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
    revocationRules: {
      maxTtlSeconds: 86400,
      requireHeartbeat: true,
      ownerCanRevoke: true,
      adminCanRemove: true,
    },
    issuer: "broker-1",
    ...overrides,
  };
}

/**
 * Creates a mock InputResolver that returns validInput() for any
 * session+group pair. Override-able per call via the overrides map.
 */
export function createTestInputResolver(
  overrides?: Map<string, AttestationInput>,
): InputResolver {
  return async (
    sessionId: string,
    groupId: string,
  ): Promise<Result<AttestationInput, BrokerError>> => {
    const key = `${sessionId}:${groupId}`;
    const input = overrides?.get(key) ?? validInput({ groupId });
    return Result.ok(input);
  };
}

/** Creates a mock AttestationSigner that produces deterministic signatures. */
export function createTestSigner(): AttestationSigner {
  return {
    async sign(
      payload: Attestation,
    ): Promise<Result<SignedAttestation, BrokerError>> {
      const bytes = canonicalize(payload);
      // Simple test signature: base64 of the first 16 bytes of canonical form
      const sig = btoa(
        String.fromCharCode(...new Uint8Array(bytes.slice(0, 16))),
      );
      return Result.ok({
        attestation: payload,
        signature: sig,
        signatureAlgorithm: "Ed25519",
        signerKeyRef: "test-key-ref",
      });
    },
    async signRevocation(
      payload: RevocationAttestation,
    ): Promise<Result<SignedRevocationEnvelope, BrokerError>> {
      const bytes = canonicalize(payload);
      const sig = btoa(
        String.fromCharCode(...new Uint8Array(bytes.slice(0, 16))),
      );
      return Result.ok({
        revocation: payload,
        signature: sig,
        signatureAlgorithm: "Ed25519",
        signerKeyRef: "test-key-ref",
      });
    },
  };
}

/** Creates a mock AttestationPublisher that records published attestations. */
export function createTestPublisher(): AttestationPublisher & {
  readonly published: SignedAttestation[];
  readonly publishedRevocations: SignedRevocationEnvelope[];
} {
  const published: SignedAttestation[] = [];
  const publishedRevocations: SignedRevocationEnvelope[] = [];
  return {
    published,
    publishedRevocations,
    async publish(
      _groupId: string,
      attestation: SignedAttestation,
    ): Promise<Result<void, BrokerError>> {
      published.push(attestation);
      return Result.ok();
    },
    async publishRevocation(
      _groupId: string,
      revocation: SignedRevocationEnvelope,
    ): Promise<Result<void, BrokerError>> {
      publishedRevocations.push(revocation);
      return Result.ok();
    },
  };
}
