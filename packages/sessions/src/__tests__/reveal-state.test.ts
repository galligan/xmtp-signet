import { beforeEach, describe, expect, test } from "bun:test";
import { createCredentialManager } from "../credential-manager.js";
import type { InternalCredentialManager } from "../credential-manager.js";
import { createTestCredentialConfig } from "./fixtures.js";

let manager: InternalCredentialManager;

beforeEach(() => {
  manager = createCredentialManager({
    defaultTtlSeconds: 60,
    maxConcurrentPerOperator: 3,
    renewalWindowSeconds: 10,
    heartbeatGracePeriod: 3,
  });
});

describe("getRevealState", () => {
  test("returns a reveal state store for an active credential", async () => {
    const config = createTestCredentialConfig();
    const created = await manager.issueCredential(config);
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;

    const result = manager.getRevealState(created.value.credentialId);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value).toBeDefined();
    expect(typeof result.value.grant).toBe("function");
    expect(typeof result.value.snapshot).toBe("function");
    expect(typeof result.value.isRevealed).toBe("function");
  });

  test("lazily creates the store on first access", async () => {
    const config = createTestCredentialConfig();
    const created = await manager.issueCredential(config);
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;

    const first = manager.getRevealState(created.value.credentialId);
    const second = manager.getRevealState(created.value.credentialId);
    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    if (!first.isOk() || !second.isOk()) return;

    expect(first.value).toBe(second.value);
  });

  test("returns NotFoundError for unknown credentialId", () => {
    const result = manager.getRevealState("nonexistent");
    expect(result.isOk()).toBe(false);
    if (result.isOk()) return;
    expect(result.error.category).toBe("not_found");
  });

  test("cleans up reveal state when credential is revoked", async () => {
    const config = createTestCredentialConfig();
    const created = await manager.issueCredential(config);
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;

    const credentialId = created.value.credentialId;

    const storeResult = manager.getRevealState(credentialId);
    expect(storeResult.isOk()).toBe(true);

    manager.revokeCredential(credentialId, "owner-initiated");

    const afterRevoke = manager.getRevealState(credentialId);
    expect(afterRevoke.isOk()).toBe(true);
    if (!afterRevoke.isOk()) return;

    expect(afterRevoke.value.snapshot().activeReveals).toHaveLength(0);
  });

  test("cleans up reveal state when credentials are swept as expired", async () => {
    const config = createTestCredentialConfig({ ttlSeconds: 0 });
    const created = await manager.issueCredential(config);
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;

    const credentialId = created.value.credentialId;

    const storeResult = manager.getRevealState(credentialId);
    expect(storeResult.isOk()).toBe(true);
    if (!storeResult.isOk()) return;

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

    await new Promise((resolve) => setTimeout(resolve, 10));

    manager.sweepExpired();

    const afterSweep = manager.getRevealState(credentialId);
    expect(afterSweep.isOk()).toBe(true);
    if (!afterSweep.isOk()) return;
    expect(afterSweep.value.snapshot().activeReveals).toHaveLength(0);
  });
});
