/**
 * Seal lifecycle integration tests.
 *
 * Validates seal issuance, chaining, refresh, revocation,
 * and querying through real packages (keys + sessions + seals).
 */

import { describe, test, expect, afterEach } from "bun:test";
import { Result } from "better-result";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  SignetError,
  ViewConfig,
  GrantConfig,
} from "@xmtp/signet-schemas";
import type {
  SealEnvelope,
  SignedRevocationEnvelope,
  SealPublisher,
} from "@xmtp/signet-contracts";
import { createKeyManager, createSealStamper } from "@xmtp/signet-keys";
import type { KeyManager } from "@xmtp/signet-keys";
import { createSessionManager } from "@xmtp/signet-sessions";
import type { InternalSessionManager } from "@xmtp/signet-sessions";
import { createSealManager, type SealManagerImpl } from "@xmtp/signet-seals";

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
  sealManager: SealManagerImpl;
  published: Array<{ groupId: string; seal: SealEnvelope }>;
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
  const signer = createSealStamper(km, IDENTITY_ID);

  const published: Array<{
    groupId: string;
    seal: SealEnvelope;
  }> = [];
  const revokedPublished: Array<{
    groupId: string;
    revocation: SignedRevocationEnvelope;
  }> = [];

  const publisher: SealPublisher = {
    async publish(groupId, seal) {
      published.push({ groupId, seal });
      return Result.ok(undefined);
    },
    async publishRevocation(groupId, revocation) {
      revokedPublished.push({ groupId, revocation });
      return Result.ok(undefined);
    },
  };

  const sealManager = createSealManager({
    signer,
    publisher,
    resolveInput: async (sessionId, gId) => {
      const session = sessionManager.getSessionById(sessionId);
      if (!session.isOk()) {
        return Result.err(session.error as SignetError);
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
    sealManager,
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

describe("seal-lifecycle", () => {
  test("issue seal -- signed with operational key", async () => {
    const ctx = await setup();
    const { sessionId } = await createSession(ctx);

    const issueResult = await ctx.sealManager.issue(sessionId, GROUP_ID);
    expect(issueResult.isOk()).toBe(true);
    if (!issueResult.isOk()) return;

    const signed = issueResult.value;
    expect(signed.seal.sealId).toBeTruthy();
    expect(signed.seal.agentInboxId).toBe(AGENT_INBOX_ID);
    expect(signed.seal.groupId).toBe(GROUP_ID);
    expect(signed.signature).toBeTruthy();
    expect(signed.signatureAlgorithm).toBe("Ed25519");
    expect(signed.signerKeyRef).toBeTruthy();

    // Published to group
    expect(ctx.published.length).toBe(1);
    expect(ctx.published[0]!.groupId).toBe(GROUP_ID);
  });

  test("first seal has null previousSealId", async () => {
    const ctx = await setup();
    const { sessionId } = await createSession(ctx);

    const issueResult = await ctx.sealManager.issue(sessionId, GROUP_ID);
    expect(issueResult.isOk()).toBe(true);
    if (!issueResult.isOk()) return;

    expect(issueResult.value.seal.previousSealId).toBeNull();
  });

  test("refresh creates chained seal", async () => {
    const ctx = await setup();
    const { sessionId } = await createSession(ctx);

    const firstResult = await ctx.sealManager.issue(sessionId, GROUP_ID);
    expect(firstResult.isOk()).toBe(true);
    if (!firstResult.isOk()) return;

    const firstId = firstResult.value.seal.sealId;

    const refreshResult = await ctx.sealManager.refresh(firstId);
    expect(refreshResult.isOk()).toBe(true);
    if (!refreshResult.isOk()) return;

    const refreshed = refreshResult.value;
    // New seal chains to previous
    expect(refreshed.seal.previousSealId).toBe(firstId);
    // New seal has different ID
    expect(refreshed.seal.sealId).not.toBe(firstId);
    // Published twice (original + refresh)
    expect(ctx.published.length).toBe(2);
  });

  test("revoke seal produces signed revocation", async () => {
    const ctx = await setup();
    const { sessionId } = await createSession(ctx);

    const issueResult = await ctx.sealManager.issue(sessionId, GROUP_ID);
    expect(issueResult.isOk()).toBe(true);
    if (!issueResult.isOk()) return;

    const sealId = issueResult.value.seal.sealId;

    const revokeResult = await ctx.sealManager.revoke(
      sealId,
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

  test("query current seal returns latest", async () => {
    const ctx = await setup();
    const { sessionId } = await createSession(ctx);

    const issueResult = await ctx.sealManager.issue(sessionId, GROUP_ID);
    expect(issueResult.isOk()).toBe(true);
    if (!issueResult.isOk()) return;

    const currentResult = await ctx.sealManager.current(
      AGENT_INBOX_ID,
      GROUP_ID,
    );
    expect(currentResult.isOk()).toBe(true);
    if (!currentResult.isOk()) return;
    expect(currentResult.value).not.toBeNull();
    expect(currentResult.value!.seal.sealId).toBe(
      issueResult.value.seal.sealId,
    );
  });

  test("query after revocation returns null", async () => {
    const ctx = await setup();
    const { sessionId } = await createSession(ctx);

    const issueResult = await ctx.sealManager.issue(sessionId, GROUP_ID);
    expect(issueResult.isOk()).toBe(true);
    if (!issueResult.isOk()) return;

    await ctx.sealManager.revoke(
      issueResult.value.seal.sealId,
      "owner-initiated",
    );

    const currentResult = await ctx.sealManager.current(
      AGENT_INBOX_ID,
      GROUP_ID,
    );
    expect(currentResult.isOk()).toBe(true);
    if (!currentResult.isOk()) return;
    expect(currentResult.value).toBeNull();
  });
});
