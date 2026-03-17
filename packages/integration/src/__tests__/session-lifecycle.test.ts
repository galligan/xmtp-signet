/**
 * Session lifecycle integration tests.
 *
 * Validates session issuance, lookup, heartbeat, expiry,
 * revocation, and materiality checks through real SessionManager.
 */

import { describe, test, expect } from "bun:test";
import { createSessionManager } from "@xmtp/signet-sessions";
import type { ViewConfig, GrantConfig } from "@xmtp/signet-schemas";

function makeView(mode: ViewConfig["mode"] = "full"): ViewConfig {
  return {
    mode,
    threadScopes: [{ groupId: "group-1", threadId: null }],
    contentTypes: ["xmtp.org/text:1.0", "xmtp.org/reaction:1.0"],
  };
}

function makeGrant(overrides?: Partial<GrantConfig["messaging"]>): GrantConfig {
  return {
    messaging: {
      send: true,
      reply: true,
      react: true,
      draftOnly: false,
      ...overrides,
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
  };
}

describe("session-lifecycle", () => {
  test("issue session returns token and correct view/grant/expiry", async () => {
    const sm = createSessionManager({ defaultTtlSeconds: 60 });

    const result = await sm.createSession(
      {
        agentInboxId: "agent-1",
        view: makeView(),
        grant: makeGrant(),
        ttlSeconds: 60,
      },
      "session-key-fp",
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const session = result.value;
    expect(session.sessionId).toBeTruthy();
    expect(session.token).toBeTruthy();
    expect(session.agentInboxId).toBe("agent-1");
    expect(session.view.mode).toBe("full");
    expect(session.grant.messaging.send).toBe(true);
    expect(session.sessionKeyFingerprint).toBe("session-key-fp");
    expect(session.state).toBe("active");

    // Expiry is approximately 60s in the future
    const expiresAt = new Date(session.expiresAt).getTime();
    const now = Date.now();
    expect(expiresAt - now).toBeGreaterThan(55_000);
    expect(expiresAt - now).toBeLessThan(65_000);
  });

  test("lookup session by ID returns matching record", async () => {
    const sm = createSessionManager();

    const createResult = await sm.createSession(
      { agentInboxId: "agent-2", view: makeView(), grant: makeGrant() },
      "fp-2",
    );
    expect(createResult.isOk()).toBe(true);
    if (!createResult.isOk()) return;

    const lookupResult = sm.getSessionById(createResult.value.sessionId);
    expect(lookupResult.isOk()).toBe(true);
    if (!lookupResult.isOk()) return;

    expect(lookupResult.value.agentInboxId).toBe("agent-2");
    expect(lookupResult.value.sessionKeyFingerprint).toBe("fp-2");
  });

  test("lookup session by token returns matching record", async () => {
    const sm = createSessionManager();

    const createResult = await sm.createSession(
      { agentInboxId: "agent-3", view: makeView(), grant: makeGrant() },
      "fp-3",
    );
    expect(createResult.isOk()).toBe(true);
    if (!createResult.isOk()) return;

    const tokenResult = sm.getSessionByToken(createResult.value.token);
    expect(tokenResult.isOk()).toBe(true);
    if (!tokenResult.isOk()) return;

    expect(tokenResult.value.sessionId).toBe(createResult.value.sessionId);
  });

  test("heartbeat keeps session alive", async () => {
    const sm = createSessionManager();

    const createResult = await sm.createSession(
      { agentInboxId: "agent-4", view: makeView(), grant: makeGrant() },
      "fp-4",
    );
    expect(createResult.isOk()).toBe(true);
    if (!createResult.isOk()) return;

    const sessionId = createResult.value.sessionId;
    const firstHb = createResult.value.lastHeartbeat;

    // Small delay so timestamps differ
    await new Promise((r) => setTimeout(r, 10));

    const hbResult = sm.recordHeartbeat(sessionId);
    expect(hbResult.isOk()).toBe(true);

    const afterHb = sm.getSessionById(sessionId);
    expect(afterHb.isOk()).toBe(true);
    if (!afterHb.isOk()) return;
    // Heartbeat timestamp should be updated
    expect(afterHb.value.lastHeartbeat).not.toBe(firstHb);
  });

  test("expired session returns SessionExpiredError on token lookup", async () => {
    const sm = createSessionManager({ defaultTtlSeconds: 1 });

    const createResult = await sm.createSession(
      {
        agentInboxId: "agent-5",
        view: makeView(),
        grant: makeGrant(),
        ttlSeconds: 1,
      },
      "fp-5",
    );
    expect(createResult.isOk()).toBe(true);
    if (!createResult.isOk()) return;

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 1_100));

    const lookupResult = sm.getSessionByToken(createResult.value.token);
    expect(lookupResult.isErr()).toBe(true);
    if (!lookupResult.isErr()) return;
    expect(lookupResult.error._tag).toBe("SessionExpiredError");
  });

  test("revoke session causes immediate invalidation", async () => {
    const sm = createSessionManager();

    const createResult = await sm.createSession(
      { agentInboxId: "agent-6", view: makeView(), grant: makeGrant() },
      "fp-6",
    );
    expect(createResult.isOk()).toBe(true);
    if (!createResult.isOk()) return;

    const sessionId = createResult.value.sessionId;
    const revokeResult = sm.revokeSession(sessionId, "owner-initiated");
    expect(revokeResult.isOk()).toBe(true);
    if (!revokeResult.isOk()) return;
    expect(revokeResult.value.state).toBe("revoked");

    // Token lookup fails
    const tokenResult = sm.getSessionByToken(createResult.value.token);
    expect(tokenResult.isErr()).toBe(true);

    // Heartbeat fails
    const hbResult = sm.recordHeartbeat(sessionId);
    expect(hbResult.isErr()).toBe(true);
  });

  test("materiality check detects privilege escalation", async () => {
    const sm = createSessionManager();

    const createResult = await sm.createSession(
      {
        agentInboxId: "agent-7",
        view: makeView("redacted"),
        grant: makeGrant({ send: false }),
      },
      "fp-7",
    );
    expect(createResult.isOk()).toBe(true);
    if (!createResult.isOk()) return;

    // Escalate view mode: redacted -> full
    const checkResult = sm.checkMateriality(
      createResult.value.sessionId,
      makeView("full"),
      makeGrant({ send: false }),
    );
    expect(checkResult.isOk()).toBe(true);
    if (!checkResult.isOk()) return;
    expect(checkResult.value.isMaterial).toBe(true);

    // Escalate grant: send false -> true
    const grantCheckResult = sm.checkMateriality(
      createResult.value.sessionId,
      makeView("redacted"),
      makeGrant({ send: true }),
    );
    expect(grantCheckResult.isOk()).toBe(true);
    if (!grantCheckResult.isOk()) return;
    expect(grantCheckResult.value.isMaterial).toBe(true);

    // No change: same policy
    const noChangeResult = sm.checkMateriality(
      createResult.value.sessionId,
      makeView("redacted"),
      makeGrant({ send: false }),
    );
    expect(noChangeResult.isOk()).toBe(true);
    if (!noChangeResult.isOk()) return;
    expect(noChangeResult.value.isMaterial).toBe(false);
  });
});
