import { beforeEach, describe, expect, test } from "bun:test";
import { Result } from "better-result";
import type { RevealGrant } from "@xmtp/signet-schemas";
import type { SessionManager, RevealStateStore } from "@xmtp/signet-contracts";
import { createSessionManager } from "../session-manager.js";
import { createSessionService } from "../service.js";
import { createRevealActions } from "../reveal-actions.js";
import type { RevealActionDeps } from "../reveal-actions.js";
import { createTestSessionConfig } from "./fixtures.js";
import type { InternalSessionManager } from "../session-manager.js";

let manager: InternalSessionManager;
let sessionService: SessionManager;
let deps: RevealActionDeps;
let sessionId: string;

beforeEach(async () => {
  manager = createSessionManager({
    defaultTtlSeconds: 60,
    maxConcurrentPerAgent: 3,
    renewalWindowSeconds: 10,
    heartbeatGracePeriod: 3,
  });

  sessionService = createSessionService({
    manager,
    keyManager: {
      async issueSessionKey(sid) {
        return Result.ok({ fingerprint: `fp_${sid}` });
      },
    },
  });

  deps = { sessionManager: sessionService };

  // Create a session for tests
  const config = createTestSessionConfig({
    view: {
      mode: "redacted",
      threadScopes: [
        { groupId: "group-1", threadId: null },
        { groupId: "group-2", threadId: "thread-1" },
      ],
      contentTypes: ["text"],
    },
  });
  const issued = await sessionService.issue(config);
  expect(issued.isOk()).toBe(true);
  if (!issued.isOk()) throw new Error("Failed to create session");

  // Look up the sessionId
  const sessions = await sessionService.list();
  expect(sessions.isOk()).toBe(true);
  if (!sessions.isOk()) throw new Error("Failed to list sessions");
  const session = sessions.value[0];
  if (!session) throw new Error("No session found");
  sessionId = session.sessionId;
});

describe("reveal.request action", () => {
  test("creates a reveal grant for a group in session scope", async () => {
    const actions = createRevealActions(deps);
    const requestAction = actions.find((a) => a.id === "reveal.request");
    expect(requestAction).toBeDefined();
    if (!requestAction) return;

    const input = {
      sessionId,
      groupId: "group-1",
      scope: "message" as const,
      targetId: "msg-123",
      requestedBy: "member-1",
      expiresAt: null,
    };

    const result = await requestAction.handler(input, stubContext());
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const grant = result.value as RevealGrant;
    expect(grant.revealId).toBeDefined();
    expect(typeof grant.revealId).toBe("string");
    expect(grant.grantedAt).toBeDefined();
    expect(grant.grantedBy).toBe("member-1");
    expect(grant.expiresAt).toBeNull();
  });

  test("rejects a group not in session threadScopes", async () => {
    const actions = createRevealActions(deps);
    const requestAction = actions.find((a) => a.id === "reveal.request");
    expect(requestAction).toBeDefined();
    if (!requestAction) return;

    const input = {
      sessionId,
      groupId: "group-unknown",
      scope: "message" as const,
      targetId: "msg-123",
      requestedBy: "member-1",
      expiresAt: null,
    };

    const result = await requestAction.handler(input, stubContext());
    expect(result.isOk()).toBe(false);
    if (result.isOk()) return;
    expect(result.error.category).toBe("permission");
  });

  test("stores the grant in the session reveal state", async () => {
    const actions = createRevealActions(deps);
    const requestAction = actions.find((a) => a.id === "reveal.request");
    expect(requestAction).toBeDefined();
    if (!requestAction) return;

    await requestAction.handler(
      {
        sessionId,
        groupId: "group-1",
        scope: "message" as const,
        targetId: "msg-1",
        requestedBy: "member-1",
        expiresAt: null,
      },
      stubContext(),
    );

    // Verify via the store
    const storeResult = sessionService.getRevealState(sessionId);
    expect(storeResult.isOk()).toBe(true);
    if (!storeResult.isOk()) return;

    const snapshot = storeResult.value.snapshot();
    expect(snapshot.activeReveals).toHaveLength(1);
    expect(snapshot.activeReveals[0]?.grant.grantedBy).toBe("member-1");
    expect(snapshot.activeReveals[0]?.request.groupId).toBe("group-1");
  });

  test("rejects when session does not exist", async () => {
    const actions = createRevealActions(deps);
    const requestAction = actions.find((a) => a.id === "reveal.request");
    expect(requestAction).toBeDefined();
    if (!requestAction) return;

    const result = await requestAction.handler(
      {
        sessionId: "nonexistent",
        groupId: "group-1",
        scope: "message" as const,
        targetId: "msg-1",
        requestedBy: "member-1",
        expiresAt: null,
      },
      stubContext(),
    );
    expect(result.isOk()).toBe(false);
  });
});

describe("reveal.list action", () => {
  test("returns empty snapshot for session with no reveals", async () => {
    const actions = createRevealActions(deps);
    const listAction = actions.find((a) => a.id === "reveal.list");
    expect(listAction).toBeDefined();
    if (!listAction) return;

    const result = await listAction.handler({ sessionId }, stubContext());
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const snapshot = result.value as { activeReveals: unknown[] };
    expect(snapshot.activeReveals).toHaveLength(0);
  });

  test("returns reveals after granting", async () => {
    const actions = createRevealActions(deps);
    const requestAction = actions.find((a) => a.id === "reveal.request");
    const listAction = actions.find((a) => a.id === "reveal.list");
    expect(requestAction).toBeDefined();
    expect(listAction).toBeDefined();
    if (!requestAction || !listAction) return;

    // Grant two reveals
    await requestAction.handler(
      {
        sessionId,
        groupId: "group-1",
        scope: "message" as const,
        targetId: "msg-1",
        requestedBy: "member-1",
        expiresAt: null,
      },
      stubContext(),
    );
    await requestAction.handler(
      {
        sessionId,
        groupId: "group-2",
        scope: "thread" as const,
        targetId: "thread-1",
        requestedBy: "member-2",
        expiresAt: null,
      },
      stubContext(),
    );

    const result = await listAction.handler({ sessionId }, stubContext());
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const snapshot = result.value as { activeReveals: unknown[] };
    expect(snapshot.activeReveals).toHaveLength(2);
  });

  test("rejects when session does not exist", async () => {
    const actions = createRevealActions(deps);
    const listAction = actions.find((a) => a.id === "reveal.list");
    expect(listAction).toBeDefined();
    if (!listAction) return;

    const result = await listAction.handler(
      { sessionId: "nonexistent" },
      stubContext(),
    );
    expect(result.isOk()).toBe(false);
  });
});

function stubContext() {
  return {
    requestId: "test-req",
    signal: new AbortController().signal,
  };
}
