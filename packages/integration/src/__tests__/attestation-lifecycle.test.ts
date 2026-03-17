/**
 * Attestation lifecycle integration tests.
 *
 * Validates attestation issuance, chaining, refresh, revocation,
 * and querying through real packages (keys + sessions + attestations).
 */

import { describe, test, expect, afterEach } from "bun:test";
import { Result } from "better-result";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  BrokerError,
  ViewConfig,
  GrantConfig,
} from "@xmtp-broker/schemas";
import type {
  SignedAttestation,
  SignedRevocationEnvelope,
} from "@xmtp-broker/contracts";
import type { AttestationPublisher } from "@xmtp-broker/contracts";
import { createKeyManager, createAttestationSigner } from "@xmtp-broker/keys";
import type { KeyManager } from "@xmtp-broker/keys";
import { createSessionManager } from "@xmtp-broker/sessions";
import type { InternalSessionManager } from "@xmtp-broker/sessions";
import {
  createAttestationManager,
  type AttestationManagerImpl,
} from "@xmtp-broker/attestations";

const GROUP_ID = "attest-group-1";
const AGENT_INBOX_ID = "agent-attest-1";
const IDENTITY_ID = "attest-identity";

function makeView(): ViewConfig {
  return {
    mode: "full",
    threadScopes: [{ groupId: GROUP_ID, threadId: null }],
    contentTypes: ["xmtp.org/text:1.0"],
  };
}

function makeGrant(): GrantConfig {
  return {
    messaging: { send: true, reply: true, react: true, draftOnly: false },
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
  };
}

let km: KeyManager | null = null;
let dataDir = "";

interface TestCtx {
  keyManager: KeyManager;
  sessionManager: InternalSessionManager;
  attestationManager: AttestationManagerImpl;
  published: Array<{ groupId: string; attestation: SignedAttestation }>;
  revokedPublished: Array<{
    groupId: string;
    revocation: SignedRevocationEnvelope;
  }>;
}

async function setup(): Promise<TestCtx> {
  dataDir = await mkdtemp(join(tmpdir(), "xmtp-attest-test-"));
  const kmResult = await createKeyManager({ dataDir });
  if (Result.isError(kmResult)) {
    throw new Error(`Key manager: ${kmResult.error.message}`);
  }
  km = kmResult.value;
  const initResult = await km.initialize();
  if (Result.isError(initResult)) {
    throw new Error(`Initialize root key: ${initResult.error.message}`);
  }
  await km.createOperationalKey(IDENTITY_ID, GROUP_ID);

  const sessionManager = createSessionManager({ defaultTtlSeconds: 300 });
  const signer = createAttestationSigner(km, IDENTITY_ID);

  const published: Array<{
    groupId: string;
    attestation: SignedAttestation;
  }> = [];
  const revokedPublished: Array<{
    groupId: string;
    revocation: SignedRevocationEnvelope;
  }> = [];

  const publisher: AttestationPublisher = {
    async publish(groupId, attestation) {
      published.push({ groupId, attestation });
      return Result.ok(undefined);
    },
    async publishRevocation(groupId, revocation) {
      revokedPublished.push({ groupId, revocation });
      return Result.ok(undefined);
    },
  };

  const attestationManager = createAttestationManager({
    signer,
    publisher,
    resolveInput: async (sessionId, gId) => {
      const session = sessionManager.getSessionById(sessionId);
      if (!session.isOk()) {
        return Result.err(session.error as BrokerError);
      }
      const s = session.value;
      return Result.ok({
        agentInboxId: s.agentInboxId,
        ownerInboxId: "owner-inbox",
        groupId: gId,
        threadScope: null,
        view: s.view,
        grant: s.grant,
        inferenceMode: "local",
        inferenceProviders: [],
        contentEgressScope: "none",
        retentionAtProvider: "none",
        hostingMode: "self-hosted",
        trustTier: km!.trustTier,
        buildProvenanceRef: null,
        verifierStatementRef: null,
        sessionKeyFingerprint: s.sessionKeyFingerprint,
        policyHash: s.policyHash,
        heartbeatInterval: s.heartbeatInterval,
        revocationRules: {
          maxTtlSeconds: 86400,
          requireHeartbeat: true,
          ownerCanRevoke: true,
          adminCanRemove: true,
        },
        issuer: `inbox_${IDENTITY_ID}`,
      });
    },
  });

  return {
    keyManager: km,
    sessionManager,
    attestationManager,
    published,
    revokedPublished,
  };
}

afterEach(async () => {
  if (km) {
    km.close();
    km = null;
  }
  if (dataDir) {
    await rm(dataDir, { recursive: true, force: true });
  }
});

async function createSession(
  ctx: TestCtx,
): Promise<{ sessionId: string; token: string }> {
  const result = await ctx.sessionManager.createSession(
    { agentInboxId: AGENT_INBOX_ID, view: makeView(), grant: makeGrant() },
    "test-session-fp",
  );
  if (!result.isOk()) throw new Error(result.error.message);
  return { sessionId: result.value.sessionId, token: result.value.token };
}

describe("attestation-lifecycle", () => {
  test("issue attestation -- signed with operational key", async () => {
    const ctx = await setup();
    const { sessionId } = await createSession(ctx);

    const issueResult = await ctx.attestationManager.issue(sessionId, GROUP_ID);
    expect(issueResult.isOk()).toBe(true);
    if (!issueResult.isOk()) return;

    const signed = issueResult.value;
    expect(signed.attestation.attestationId).toBeTruthy();
    expect(signed.attestation.agentInboxId).toBe(AGENT_INBOX_ID);
    expect(signed.attestation.groupId).toBe(GROUP_ID);
    expect(signed.signature).toBeTruthy();
    expect(signed.signatureAlgorithm).toBe("Ed25519");
    expect(signed.signerKeyRef).toBeTruthy();

    // Published to group
    expect(ctx.published.length).toBe(1);
    expect(ctx.published[0]!.groupId).toBe(GROUP_ID);
  });

  test("first attestation has null previousAttestationId", async () => {
    const ctx = await setup();
    const { sessionId } = await createSession(ctx);

    const issueResult = await ctx.attestationManager.issue(sessionId, GROUP_ID);
    expect(issueResult.isOk()).toBe(true);
    if (!issueResult.isOk()) return;

    expect(issueResult.value.attestation.previousAttestationId).toBeNull();
  });

  test("refresh creates chained attestation", async () => {
    const ctx = await setup();
    const { sessionId } = await createSession(ctx);

    const firstResult = await ctx.attestationManager.issue(sessionId, GROUP_ID);
    expect(firstResult.isOk()).toBe(true);
    if (!firstResult.isOk()) return;

    const firstId = firstResult.value.attestation.attestationId;

    const refreshResult = await ctx.attestationManager.refresh(firstId);
    expect(refreshResult.isOk()).toBe(true);
    if (!refreshResult.isOk()) return;

    const refreshed = refreshResult.value;
    // New attestation chains to previous
    expect(refreshed.attestation.previousAttestationId).toBe(firstId);
    // New attestation has different ID
    expect(refreshed.attestation.attestationId).not.toBe(firstId);
    // Published twice (original + refresh)
    expect(ctx.published.length).toBe(2);
  });

  test("revoke attestation produces signed revocation", async () => {
    const ctx = await setup();
    const { sessionId } = await createSession(ctx);

    const issueResult = await ctx.attestationManager.issue(sessionId, GROUP_ID);
    expect(issueResult.isOk()).toBe(true);
    if (!issueResult.isOk()) return;

    const attestationId = issueResult.value.attestation.attestationId;

    const revokeResult = await ctx.attestationManager.revoke(
      attestationId,
      "owner-initiated",
    );
    expect(revokeResult.isOk()).toBe(true);

    // Revocation published
    expect(ctx.revokedPublished.length).toBe(1);
    expect(ctx.revokedPublished[0]!.groupId).toBe(GROUP_ID);
    expect(ctx.revokedPublished[0]!.revocation.revocation.reason).toBe(
      "owner-initiated",
    );
    expect(ctx.revokedPublished[0]!.revocation.signature).toBeTruthy();
  });

  test("query current attestation returns latest", async () => {
    const ctx = await setup();
    const { sessionId } = await createSession(ctx);

    const issueResult = await ctx.attestationManager.issue(sessionId, GROUP_ID);
    expect(issueResult.isOk()).toBe(true);
    if (!issueResult.isOk()) return;

    const currentResult = await ctx.attestationManager.current(
      AGENT_INBOX_ID,
      GROUP_ID,
    );
    expect(currentResult.isOk()).toBe(true);
    if (!currentResult.isOk()) return;
    expect(currentResult.value).not.toBeNull();
    expect(currentResult.value!.attestation.attestationId).toBe(
      issueResult.value.attestation.attestationId,
    );
  });

  test("query after revocation returns null", async () => {
    const ctx = await setup();
    const { sessionId } = await createSession(ctx);

    const issueResult = await ctx.attestationManager.issue(sessionId, GROUP_ID);
    expect(issueResult.isOk()).toBe(true);
    if (!issueResult.isOk()) return;

    await ctx.attestationManager.revoke(
      issueResult.value.attestation.attestationId,
      "owner-initiated",
    );

    const currentResult = await ctx.attestationManager.current(
      AGENT_INBOX_ID,
      GROUP_ID,
    );
    expect(currentResult.isOk()).toBe(true);
    if (!currentResult.isOk()) return;
    expect(currentResult.value).toBeNull();
  });
});
