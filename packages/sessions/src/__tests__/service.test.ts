import { beforeEach, describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { InternalError } from "@xmtp/signet-schemas";
import { createSessionService } from "../service.js";
import { createSessionManager } from "../session-manager.js";
import type { InternalSessionManager } from "../session-manager.js";
import { createTestSessionConfig } from "./fixtures.js";

describe("createSessionService", () => {
  let manager: InternalSessionManager;
  let issued: string[];
  let service: ReturnType<typeof createSessionService>;

  beforeEach(() => {
    manager = createSessionManager({
      defaultTtlSeconds: 60,
      maxConcurrentPerAgent: 3,
      renewalWindowSeconds: 10,
      heartbeatGracePeriod: 3,
    });
    issued = [];
    service = createSessionService({
      manager,
      keyManager: {
        async issueSessionKey(sessionId, ttlSeconds) {
          issued.push(`${sessionId}:${ttlSeconds}`);
          return Result.ok({ fingerprint: `fp_${sessionId}` });
        },
      },
    });
  });

  test("issues bearer credentials with session metadata", async () => {
    const result = await service.issue(createTestSessionConfig());
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.token).toHaveLength(43);
    expect(result.value.session.sessionId).toMatch(/^ses_[0-9a-f]{32}$/);
    expect(result.value.session.sessionKeyFingerprint).toBe(
      `fp_${result.value.session.sessionId}`,
    );
    expect(issued).toEqual([`${result.value.session.sessionId}:3600`]);
  });

  test("reuses an existing matching active session without issuing a new key", async () => {
    const config = createTestSessionConfig();
    const first = await service.issue(config);
    const second = await service.issue(config);

    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    if (!first.isOk() || !second.isOk()) return;

    expect(second.value.token).toBe(first.value.token);
    expect(second.value.session.sessionId).toBe(first.value.session.sessionId);
    expect(issued).toHaveLength(1);
  });

  test("lists public session records without exposing bearer tokens", async () => {
    const issuedSession = await service.issue(createTestSessionConfig());
    expect(issuedSession.isOk()).toBe(true);
    if (!issuedSession.isOk()) return;

    const listed = await service.list("agent-inbox-1");
    expect(listed.isOk()).toBe(true);
    if (!listed.isOk()) return;

    expect(listed.value).toHaveLength(1);
    expect(listed.value[0]?.sessionId).toBe(
      issuedSession.value.session.sessionId,
    );
    expect("token" in listed.value[0]!).toBe(false);
  });

  test("reports whether a session is active", async () => {
    const issuedSession = await service.issue(createTestSessionConfig());
    expect(issuedSession.isOk()).toBe(true);
    if (!issuedSession.isOk()) return;

    const active = await service.isActive(
      issuedSession.value.session.sessionId,
    );
    expect(active.isOk()).toBe(true);
    if (!active.isOk()) return;
    expect(active.value).toBe(true);

    await service.revoke(
      issuedSession.value.session.sessionId,
      "owner-initiated",
    );

    const revoked = await service.isActive(
      issuedSession.value.session.sessionId,
    );
    expect(revoked.isOk()).toBe(true);
    if (!revoked.isOk()) return;
    expect(revoked.value).toBe(false);
  });

  test("propagates session-key issuance errors", async () => {
    const failing = createSessionService({
      manager,
      keyManager: {
        async issueSessionKey() {
          return Result.err(InternalError.create("session key failed"));
        },
      },
    });

    const result = await failing.issue(createTestSessionConfig());
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.message).toContain("session key failed");
  });
});
