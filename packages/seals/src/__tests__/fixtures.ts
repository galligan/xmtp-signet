import { Result } from "better-result";
import type { Seal, SignetError, RevocationSeal } from "@xmtp/signet-schemas";
import type {
  SealStamper,
  SealPublisher,
  SealEnvelope,
  SignedRevocationEnvelope,
} from "@xmtp/signet-contracts";
import type { SealInput } from "../build.js";
import type { InputResolver } from "../manager.js";
import { canonicalize } from "../canonicalize.js";

/** Creates a valid SealInput for testing. */
export function validInput(overrides?: Partial<SealInput>): SealInput {
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
    issuer: "signet-1",
    ...overrides,
  };
}

/**
 * Creates a mock InputResolver that returns validInput() for any
 * session+group pair. Override-able per call via the overrides map.
 */
export function createTestInputResolver(
  overrides?: Map<string, SealInput>,
): InputResolver {
  return async (
    sessionId: string,
    groupId: string,
  ): Promise<Result<SealInput, SignetError>> => {
    const key = `${sessionId}:${groupId}`;
    const input = overrides?.get(key) ?? validInput({ groupId });
    return Result.ok(input);
  };
}

/** Creates a mock SealStamper that produces deterministic signatures. */
export function createTestSigner(): SealStamper {
  return {
    async sign(payload: Seal): Promise<Result<SealEnvelope, SignetError>> {
      const bytes = canonicalize(payload);
      // Simple test signature: base64 of the first 16 bytes of canonical form
      const sig = btoa(
        String.fromCharCode(...new Uint8Array(bytes.slice(0, 16))),
      );
      return Result.ok({
        seal: payload,
        signature: sig,
        signatureAlgorithm: "Ed25519",
        signerKeyRef: "test-key-ref",
      });
    },
    async signRevocation(
      payload: RevocationSeal,
    ): Promise<Result<SignedRevocationEnvelope, SignetError>> {
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

/** Creates a mock SealPublisher that records published seals. */
export function createTestPublisher(): SealPublisher & {
  readonly published: SealEnvelope[];
  readonly publishedRevocations: SignedRevocationEnvelope[];
} {
  const published: SealEnvelope[] = [];
  const publishedRevocations: SignedRevocationEnvelope[] = [];
  return {
    published,
    publishedRevocations,
    async publish(
      _groupId: string,
      seal: SealEnvelope,
    ): Promise<Result<void, SignetError>> {
      published.push(seal);
      return Result.ok();
    },
    async publishRevocation(
      _groupId: string,
      revocation: SignedRevocationEnvelope,
    ): Promise<Result<void, SignetError>> {
      publishedRevocations.push(revocation);
      return Result.ok();
    },
  };
}
