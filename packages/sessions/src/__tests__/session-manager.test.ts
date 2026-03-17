import { describe, expect, test, beforeEach } from "bun:test";
import { createSessionManager } from "../session-manager.js";
import type { InternalSessionManager } from "../session-manager.js";
import { createTestSessionConfig, baseView, baseGrant } from "./fixtures.js";
import type { ViewConfig } from "@xmtp/signet-schemas";

let manager: InternalSessionManager;

beforeEach(() => {
  manager = createSessionManager({
    defaultTtlSeconds: 60,
    maxConcurrentPerAgent: 3,
    renewalWindowSeconds: 10,
    heartbeatGracePeriod: 3,
  });
});

describe("createSession", () => {
  test("creates a session with correct fields", async () => {
    const config = createTestSessionConfig();
    const result = await manager.createSession(config, "fp_abc123");
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.state).toBe("active");
    expect(result.value.agentInboxId).toBe("agent-inbox-1");
    expect(result.value.sessionKeyFingerprint).toBe("fp_abc123");
    expect(result.value.sessionId).toMatch(/^ses_[0-9a-f]{32}$/);
  });

  test("generates a 43-char base64url token", async () => {
    const config = createTestSessionConfig();
    const result = await manager.createSession(config, "fp_abc123");
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.token).toHaveLength(43);
    expect(result.value.token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("sets correct timestamps", async () => {
    const config = createTestSessionConfig({ ttlSeconds: 120 });
    const before = new Date();
    const result = await manager.createSession(config, "fp_abc");
    const after = new Date();
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    const created = new Date(result.value.issuedAt);
    const expires = new Date(result.value.expiresAt);
    expect(created.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(created.getTime()).toBeLessThanOrEqual(after.getTime());
    const diffMs = expires.getTime() - created.getTime();
    expect(diffMs).toBeGreaterThanOrEqual(119_000);
    expect(diffMs).toBeLessThanOrEqual(121_000);
  });

  test("stores ttlMs in session record", async () => {
    const config = createTestSessionConfig({ ttlSeconds: 120 });
    const result = await manager.createSession(config, "fp_abc");
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.ttlMs).toBe(120_000);
  });
});

describe("session deduplication", () => {
  test("same agent + same policy returns existing session", async () => {
    const config = createTestSessionConfig();
    const s1 = await manager.createSession(config, "fp_1");
    const s2 = await manager.createSession(config, "fp_1");
    expect(s1.isOk()).toBe(true);
    expect(s2.isOk()).toBe(true);
    if (!s1.isOk() || !s2.isOk()) return;
    expect(s1.value.sessionId).toBe(s2.value.sessionId);
    expect(s1.value.token).toBe(s2.value.token);
  });

  test("same agent + different policy creates new session", async () => {
    const config1 = createTestSessionConfig();
    const config2 = createTestSessionConfig({
      view: { ...baseView, mode: "full" },
    });
    const s1 = await manager.createSession(config1, "fp_1");
    const s2 = await manager.createSession(config2, "fp_2");
    expect(s1.isOk()).toBe(true);
    expect(s2.isOk()).toBe(true);
    if (!s1.isOk() || !s2.isOk()) return;
    expect(s1.value.sessionId).not.toBe(s2.value.sessionId);
  });

  test("different agent + same policy creates new session", async () => {
    const config1 = createTestSessionConfig({ agentInboxId: "agent-1" });
    const config2 = createTestSessionConfig({ agentInboxId: "agent-2" });
    const s1 = await manager.createSession(config1, "fp_1");
    const s2 = await manager.createSession(config2, "fp_2");
    expect(s1.isOk()).toBe(true);
    expect(s2.isOk()).toBe(true);
    if (!s1.isOk() || !s2.isOk()) return;
    expect(s1.value.sessionId).not.toBe(s2.value.sessionId);
  });
});

describe("getSessionByToken", () => {
  test("returns session for valid token", async () => {
    const config = createTestSessionConfig();
    const created = await manager.createSession(config, "fp_1");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;
    const lookup = manager.getSessionByToken(created.value.token);
    expect(lookup.isOk()).toBe(true);
    if (!lookup.isOk()) return;
    expect(lookup.value.sessionId).toBe(created.value.sessionId);
  });

  test("returns NotFoundError for unknown token", () => {
    const lookup = manager.getSessionByToken("nonexistent-token");
    expect(lookup.isErr()).toBe(true);
    if (!lookup.isErr()) return;
    expect(lookup.error._tag).toBe("NotFoundError");
  });

  test("returns SessionExpiredError for expired session", async () => {
    const config = createTestSessionConfig({ ttlSeconds: 1 });
    const created = await manager.createSession(config, "fp_1");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;
    await Bun.sleep(1100);
    manager.sweepExpired();
    const lookup = manager.getSessionByToken(created.value.token);
    expect(lookup.isErr()).toBe(true);
    if (!lookup.isErr()) return;
    expect(lookup.error._tag).toBe("SessionExpiredError");
  });

  test("rejects expired sessions even before a sweep runs", async () => {
    const config = createTestSessionConfig({ ttlSeconds: 1 });
    const created = await manager.createSession(config, "fp_1");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;

    await Bun.sleep(1100);

    const lookup = manager.getSessionByToken(created.value.token);
    expect(lookup.isErr()).toBe(true);
    if (!lookup.isErr()) return;
    expect(lookup.error._tag).toBe("SessionExpiredError");

    const byId = manager.getSessionById(created.value.sessionId);
    expect(byId.isOk()).toBe(true);
    if (!byId.isOk()) return;
    expect(byId.value.state).toBe("expired");
  });

  test("returns SessionExpiredError for revoked session", async () => {
    const config = createTestSessionConfig();
    const created = await manager.createSession(config, "fp_1");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;
    manager.revokeSession(created.value.sessionId, "owner-initiated");
    const lookup = manager.getSessionByToken(created.value.token);
    expect(lookup.isErr()).toBe(true);
    if (!lookup.isErr()) return;
    expect(lookup.error._tag).toBe("SessionExpiredError");
  });
});

describe("lookupByToken", () => {
  test("returns session for valid token", async () => {
    const config = createTestSessionConfig();
    const created = await manager.createSession(config, "fp_1");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;
    const lookup = manager.lookupByToken(created.value.token);
    expect(lookup.isOk()).toBe(true);
    if (!lookup.isOk()) return;
    expect(lookup.value.sessionId).toBe(created.value.sessionId);
  });

  test("returns error for invalid token", () => {
    const lookup = manager.lookupByToken("invalid-token");
    expect(lookup.isErr()).toBe(true);
    if (!lookup.isErr()) return;
    expect(lookup.error._tag).toBe("NotFoundError");
  });
});

describe("getSessionById", () => {
  test("returns session for valid ID", async () => {
    const config = createTestSessionConfig();
    const created = await manager.createSession(config, "fp_1");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;
    const lookup = manager.getSessionById(created.value.sessionId);
    expect(lookup.isOk()).toBe(true);
  });

  test("returns NotFoundError for unknown ID", () => {
    const lookup = manager.getSessionById("ses_nonexistent");
    expect(lookup.isErr()).toBe(true);
    if (!lookup.isErr()) return;
    expect(lookup.error._tag).toBe("NotFoundError");
  });
});

describe("getActiveSessions", () => {
  test("returns empty array for agent with no sessions", () => {
    const sessions = manager.getActiveSessions("no-agent");
    expect(sessions).toHaveLength(0);
  });

  test("returns only active sessions", async () => {
    const config1 = createTestSessionConfig({
      view: { ...baseView, mode: "full" },
    });
    const config2 = createTestSessionConfig({
      view: { ...baseView, mode: "thread-only" },
    });
    await manager.createSession(config1, "fp_1");
    const s2 = await manager.createSession(config2, "fp_2");
    expect(s2.isOk()).toBe(true);
    if (!s2.isOk()) return;
    manager.revokeSession(s2.value.sessionId, "owner-initiated");
    const sessions = manager.getActiveSessions("agent-inbox-1");
    expect(sessions).toHaveLength(1);
  });
});

describe("concurrent session limits", () => {
  test("checks concurrent limit before dedup", async () => {
    // Fill to max with 3 distinct policies
    const mgr = createSessionManager({
      defaultTtlSeconds: 60,
      maxConcurrentPerAgent: 3,
      renewalWindowSeconds: 10,
      heartbeatGracePeriod: 3,
    });
    const sessions = [];
    for (let i = 0; i < 3; i++) {
      const c = createTestSessionConfig({
        view: { ...baseView, contentTypes: [`type-${i}`] },
      });
      const r = await mgr.createSession(c, `fp_${i}`);
      expect(r.isOk()).toBe(true);
      if (r.isOk()) sessions.push(r.value);
    }
    // Now create a 4th with the SAME policy as session[0] (the oldest)
    // Concurrent limit should evict session[0] first,
    // then dedup should NOT match (session[0] is now revoked)
    const dupConfig = createTestSessionConfig({
      view: { ...baseView, contentTypes: ["type-0"] },
    });
    const result = await mgr.createSession(dupConfig, "fp_new");
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    // Should be a NEW session, not the old one (which was evicted)
    expect(result.value.sessionId).not.toBe(sessions[0]!.sessionId);
    expect(result.value.sessionKeyFingerprint).toBe("fp_new");
  });

  test("oldest session is revoked when limit exceeded", async () => {
    const configs = Array.from({ length: 4 }, (_, i) =>
      createTestSessionConfig({
        view: {
          ...baseView,
          mode: i % 2 === 0 ? "full" : "redacted",
          contentTypes: [`type-${i}`],
        },
      }),
    );
    const sessions = [];
    for (const config of configs) {
      const result = await manager.createSession(
        config,
        `fp_${sessions.length}`,
      );
      expect(result.isOk()).toBe(true);
      if (result.isOk()) sessions.push(result.value);
    }
    const active = manager.getActiveSessions("agent-inbox-1");
    expect(active).toHaveLength(3);
    // First session should have been evicted
    const firstLookup = manager.getSessionById(sessions[0]!.sessionId);
    expect(firstLookup.isOk()).toBe(true);
    if (!firstLookup.isOk()) return;
    expect(firstLookup.value.state).toBe("revoked");
  });
});

describe("renewSession", () => {
  test("renews session within renewal window", async () => {
    // TTL = 15s, renewal window = 10s, so after 6s it should be in window
    const shortManager = createSessionManager({
      defaultTtlSeconds: 15,
      renewalWindowSeconds: 10,
      maxConcurrentPerAgent: 3,
      heartbeatGracePeriod: 3,
    });
    const config = createTestSessionConfig({ ttlSeconds: 15 });
    const created = await shortManager.createSession(config, "fp_1");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;

    // Wait to enter renewal window
    await Bun.sleep(6_000);
    const renewed = await shortManager.renewSession(created.value.sessionId);
    expect(renewed.isOk()).toBe(true);
    if (!renewed.isOk()) return;
    expect(renewed.value.sessionId).toBe(created.value.sessionId);
    const newExpiry = new Date(renewed.value.expiresAt).getTime();
    const oldExpiry = new Date(created.value.expiresAt).getTime();
    expect(newExpiry).toBeGreaterThan(oldExpiry);
  }, 10_000);

  test("rejects renewal outside window (too early)", async () => {
    const config = createTestSessionConfig({ ttlSeconds: 60 });
    const created = await manager.createSession(config, "fp_1");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;
    const renewed = await manager.renewSession(created.value.sessionId);
    expect(renewed.isErr()).toBe(true);
    if (!renewed.isErr()) return;
    expect(renewed.error._tag).toBe("AuthError");
  });

  test("rejects renewal on revoked session", async () => {
    const config = createTestSessionConfig();
    const created = await manager.createSession(config, "fp_1");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;
    manager.revokeSession(created.value.sessionId, "owner-initiated");
    const renewed = await manager.renewSession(created.value.sessionId);
    expect(renewed.isErr()).toBe(true);
    if (!renewed.isErr()) return;
    expect(renewed.error._tag).toBe("SessionExpiredError");
  });

  test("rejects renewal on expired session", async () => {
    const config = createTestSessionConfig({ ttlSeconds: 1 });
    const created = await manager.createSession(config, "fp_1");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;
    await Bun.sleep(1100);
    manager.sweepExpired();
    const renewed = await manager.renewSession(created.value.sessionId);
    expect(renewed.isErr()).toBe(true);
    if (!renewed.isErr()) return;
    expect(renewed.error._tag).toBe("SessionExpiredError");
  });
});

describe("revokeSession", () => {
  test("sets state to revoked with reason", async () => {
    const config = createTestSessionConfig();
    const created = await manager.createSession(config, "fp_1");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;
    const revoked = manager.revokeSession(
      created.value.sessionId,
      "owner-initiated",
    );
    expect(revoked.isOk()).toBe(true);
    if (!revoked.isOk()) return;
    expect(revoked.value.state).toBe("revoked");
    expect(revoked.value.revocationReason).toBe("owner-initiated");
    expect(revoked.value.revokedAt).not.toBeNull();
  });

  test("returns NotFoundError for unknown session", () => {
    const result = manager.revokeSession("ses_unknown", "owner-initiated");
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error._tag).toBe("NotFoundError");
  });
});

describe("revokeAllSessions", () => {
  test("revokes all active sessions for an agent", async () => {
    const config1 = createTestSessionConfig({
      view: { ...baseView, mode: "full" },
    });
    const config2 = createTestSessionConfig({
      view: { ...baseView, mode: "thread-only" },
    });
    await manager.createSession(config1, "fp_1");
    await manager.createSession(config2, "fp_2");
    const revoked = manager.revokeAllSessions(
      "agent-inbox-1",
      "owner-initiated",
    );
    expect(revoked).toHaveLength(2);
    const active = manager.getActiveSessions("agent-inbox-1");
    expect(active).toHaveLength(0);
  });
});

describe("recordHeartbeat", () => {
  test("updates lastHeartbeat timestamp", async () => {
    const config = createTestSessionConfig();
    const created = await manager.createSession(config, "fp_1");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;
    await Bun.sleep(50);
    const result = manager.recordHeartbeat(created.value.sessionId);
    expect(result.isOk()).toBe(true);
    const lookup = manager.getSessionById(created.value.sessionId);
    expect(lookup.isOk()).toBe(true);
    if (!lookup.isOk()) return;
    const hbTime = new Date(lookup.value.lastHeartbeat).getTime();
    const createdTime = new Date(created.value.issuedAt).getTime();
    expect(hbTime).toBeGreaterThanOrEqual(createdTime);
  });

  test("fails on non-active session", async () => {
    const config = createTestSessionConfig();
    const created = await manager.createSession(config, "fp_1");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;
    manager.revokeSession(created.value.sessionId, "owner-initiated");
    const result = manager.recordHeartbeat(created.value.sessionId);
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error._tag).toBe("SessionExpiredError");
  });

  test("fails on unknown session", () => {
    const result = manager.recordHeartbeat("ses_unknown");
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error._tag).toBe("NotFoundError");
  });
});

describe("sweepExpired", () => {
  test("marks expired sessions with state expired, no revokedAt", async () => {
    const config = createTestSessionConfig({ ttlSeconds: 1 });
    const created = await manager.createSession(config, "fp_1");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;
    await Bun.sleep(1100);
    const swept = manager.sweepExpired();
    expect(swept).toHaveLength(1);
    expect(swept[0]!.state).toBe("expired");
    // Expiry is distinct from revocation: no revokedAt or revocationReason
    expect(swept[0]!.revokedAt).toBeNull();
    expect(swept[0]!.revocationReason).toBeNull();
  });

  test("does not sweep active sessions", async () => {
    const config = createTestSessionConfig({ ttlSeconds: 3600 });
    await manager.createSession(config, "fp_1");
    const swept = manager.sweepExpired();
    expect(swept).toHaveLength(0);
  });

  test("revokes sessions with heartbeat timeout", async () => {
    // heartbeatInterval=1s, gracePeriod=1s => timeout after 2s of no heartbeat
    const hbManager = createSessionManager({
      defaultTtlSeconds: 3600,
      maxConcurrentPerAgent: 3,
      renewalWindowSeconds: 10,
      heartbeatGracePeriod: 1,
    });
    const config = createTestSessionConfig({ heartbeatInterval: 1 });
    const created = await hbManager.createSession(config, "fp_1");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;
    // Wait past heartbeat + grace period
    await Bun.sleep(2100);
    const swept = hbManager.sweepExpired();
    expect(swept).toHaveLength(1);
    expect(swept[0]!.state).toBe("revoked");
    expect(swept[0]!.revocationReason).toBe("heartbeat-timeout");
    expect(swept[0]!.revokedAt).not.toBeNull();
  });

  test("does not timeout sessions with recent heartbeat", async () => {
    const hbManager = createSessionManager({
      defaultTtlSeconds: 3600,
      maxConcurrentPerAgent: 3,
      renewalWindowSeconds: 10,
      heartbeatGracePeriod: 1,
    });
    const config = createTestSessionConfig({ heartbeatInterval: 1 });
    const created = await hbManager.createSession(config, "fp_1");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;
    // Send a heartbeat within the window
    await Bun.sleep(500);
    hbManager.recordHeartbeat(created.value.sessionId);
    await Bun.sleep(500);
    const swept = hbManager.sweepExpired();
    expect(swept).toHaveLength(0);
  });
});

describe("checkMateriality", () => {
  test("delegates to materiality checker", async () => {
    const config = createTestSessionConfig();
    const created = await manager.createSession(config, "fp_1");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;
    const newView: ViewConfig = { ...baseView, mode: "full" };
    const result = manager.checkMateriality(
      created.value.sessionId,
      newView,
      baseGrant,
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.isMaterial).toBe(true);
  });

  test("returns NotFoundError for unknown session", () => {
    const result = manager.checkMateriality("ses_unknown", baseView, baseGrant);
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error._tag).toBe("NotFoundError");
  });

  test("treats reveal-only as narrower than redacted", async () => {
    const config = createTestSessionConfig({
      view: { ...baseView, mode: "redacted" },
    });
    const created = await manager.createSession(config, "fp_1");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;

    const result = manager.checkMateriality(
      created.value.sessionId,
      { ...baseView, mode: "reveal-only" },
      baseGrant,
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.isMaterial).toBe(false);
  });
});

describe("updateSessionPolicy", () => {
  test("updates view and grant on active session", async () => {
    const config = createTestSessionConfig();
    const created = await manager.createSession(config, "fp_1");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;
    const newView: ViewConfig = {
      ...baseView,
      contentTypes: [...baseView.contentTypes, "reaction"],
    };
    const result = manager.updateSessionPolicy(
      created.value.sessionId,
      newView,
      baseGrant,
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.view.contentTypes).toContain("reaction");
  });

  test("fails on non-active session", async () => {
    const config = createTestSessionConfig();
    const created = await manager.createSession(config, "fp_1");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;
    manager.revokeSession(created.value.sessionId, "owner-initiated");
    const result = manager.updateSessionPolicy(
      created.value.sessionId,
      baseView,
      baseGrant,
    );
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error._tag).toBe("SessionExpiredError");
  });
});
