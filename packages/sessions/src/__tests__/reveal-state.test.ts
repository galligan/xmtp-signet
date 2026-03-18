import { beforeEach, describe, expect, test } from "bun:test";
import { createSessionManager } from "../session-manager.js";
import type { InternalSessionManager } from "../session-manager.js";
import { createTestSessionConfig } from "./fixtures.js";

let manager: InternalSessionManager;

beforeEach(() => {
  manager = createSessionManager({
    defaultTtlSeconds: 60,
    maxConcurrentPerAgent: 3,
    renewalWindowSeconds: 10,
    heartbeatGracePeriod: 3,
  });
});

describe("getRevealState", () => {
  test("returns a reveal state store for an active session", async () => {
    const config = createTestSessionConfig();
    const created = await manager.createSession(config, "fp_abc");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;

    const result = manager.getRevealState(created.value.sessionId);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value).toBeDefined();
    expect(typeof result.value.grant).toBe("function");
    expect(typeof result.value.snapshot).toBe("function");
    expect(typeof result.value.isRevealed).toBe("function");
  });

  test("lazily creates the store on first access", async () => {
    const config = createTestSessionConfig();
    const created = await manager.createSession(config, "fp_abc");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;

    const first = manager.getRevealState(created.value.sessionId);
    const second = manager.getRevealState(created.value.sessionId);
    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    if (!first.isOk() || !second.isOk()) return;

    // Same instance returned on subsequent calls
    expect(first.value).toBe(second.value);
  });

  test("returns NotFoundError for unknown sessionId", () => {
    const result = manager.getRevealState("nonexistent");
    expect(result.isOk()).toBe(false);
    if (result.isOk()) return;
    expect(result.error.category).toBe("not_found");
  });

  test("cleans up reveal state when session is revoked", async () => {
    const config = createTestSessionConfig();
    const created = await manager.createSession(config, "fp_abc");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;

    const sessionId = created.value.sessionId;

    // Access reveal state to create it
    const storeResult = manager.getRevealState(sessionId);
    expect(storeResult.isOk()).toBe(true);

    // Revoke session
    manager.revokeSession(sessionId, "owner-initiated");

    // Reveal state should be cleaned up -- session no longer active
    // getRevealState on a revoked session should still return the store
    // (it exists), but the session is revoked so callers shouldn't use it.
    // The store data itself is cleaned up for garbage collection.
    const afterRevoke = manager.getRevealState(sessionId);
    expect(afterRevoke.isOk()).toBe(true);
    if (!afterRevoke.isOk()) return;

    // Store was cleaned up - snapshot should be empty
    expect(afterRevoke.value.snapshot().activeReveals).toHaveLength(0);
  });

  test("cleans up reveal state when sessions are swept as expired", async () => {
    const config = createTestSessionConfig({ ttlSeconds: 0 });
    const created = await manager.createSession(config, "fp_abc");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;

    const sessionId = created.value.sessionId;

    // Access reveal state to create it
    const storeResult = manager.getRevealState(sessionId);
    expect(storeResult.isOk()).toBe(true);
    if (!storeResult.isOk()) return;

    // Add a reveal grant so we can verify cleanup
    storeResult.value.grant(
      {
        revealId: "r1",
        grantedAt: new Date().toISOString(),
        grantedBy: "admin",
        expiresAt: null,
      },
      {
        revealId: "r1",
        groupId: "group-1",
        scope: "message",
        targetId: "msg-1",
        requestedBy: "admin",
        expiresAt: null,
      },
    );

    // Wait a tick for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Sweep expired sessions
    manager.sweepExpired();

    // Reveal state should be cleaned up
    const afterSweep = manager.getRevealState(sessionId);
    expect(afterSweep.isOk()).toBe(true);
    if (!afterSweep.isOk()) return;
    expect(afterSweep.value.snapshot().activeReveals).toHaveLength(0);
  });
});
