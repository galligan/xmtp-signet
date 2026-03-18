import { describe, test, expect } from "bun:test";
import { createRevealStateStore } from "../reveal-state.js";
import type {
  ContentTypeId,
  RevealGrant,
  RevealRequest,
} from "@xmtp/signet-schemas";

function makeRequest(overrides?: Partial<RevealRequest>): RevealRequest {
  return {
    revealId: "rev-1",
    groupId: "group-1",
    scope: "message",
    targetId: "msg-1",
    requestedBy: "owner-1",
    expiresAt: null,
    ...overrides,
  };
}

function makeGrant(overrides?: Partial<RevealGrant>): RevealGrant {
  return {
    revealId: "rev-1",
    grantedAt: "2024-01-01T00:00:00Z",
    grantedBy: "owner-1",
    expiresAt: null,
    ...overrides,
  };
}

describe("RevealStateStore", () => {
  test("grant and query: message scope", () => {
    const store = createRevealStateStore();
    store.grant(
      makeGrant(),
      makeRequest({ scope: "message", targetId: "msg-1" }),
    );

    expect(
      store.isRevealed(
        "msg-1",
        "group-1",
        null,
        "sender-1",
        "xmtp.org/text:1.0" as ContentTypeId,
        "2024-01-01T00:00:00Z",
      ),
    ).toBe(true);
  });

  test("message scope does not match different message", () => {
    const store = createRevealStateStore();
    store.grant(
      makeGrant(),
      makeRequest({ scope: "message", targetId: "msg-1" }),
    );

    expect(
      store.isRevealed(
        "msg-2",
        "group-1",
        null,
        "sender-1",
        "xmtp.org/text:1.0" as ContentTypeId,
        "2024-01-01T00:00:00Z",
      ),
    ).toBe(false);
  });

  test("thread scope reveals all messages in thread", () => {
    const store = createRevealStateStore();
    store.grant(
      makeGrant({ revealId: "rev-thread" }),
      makeRequest({
        revealId: "rev-thread",
        scope: "thread",
        targetId: "thread-1",
      }),
    );

    expect(
      store.isRevealed(
        "msg-1",
        "group-1",
        "thread-1",
        "sender-1",
        "xmtp.org/text:1.0" as ContentTypeId,
        "2024-01-01T00:00:00Z",
      ),
    ).toBe(true);

    expect(
      store.isRevealed(
        "msg-2",
        "group-1",
        "thread-1",
        "sender-2",
        "xmtp.org/text:1.0" as ContentTypeId,
        "2024-01-01T00:00:00Z",
      ),
    ).toBe(true);

    // Different thread not revealed
    expect(
      store.isRevealed(
        "msg-3",
        "group-1",
        "thread-2",
        "sender-1",
        "xmtp.org/text:1.0" as ContentTypeId,
        "2024-01-01T00:00:00Z",
      ),
    ).toBe(false);
  });

  test("sender scope reveals all messages from sender in group", () => {
    const store = createRevealStateStore();
    store.grant(
      makeGrant({ revealId: "rev-sender" }),
      makeRequest({
        revealId: "rev-sender",
        scope: "sender",
        targetId: "sender-1",
      }),
    );

    expect(
      store.isRevealed(
        "msg-1",
        "group-1",
        null,
        "sender-1",
        "xmtp.org/text:1.0" as ContentTypeId,
        "2024-01-01T00:00:00Z",
      ),
    ).toBe(true);

    expect(
      store.isRevealed(
        "msg-2",
        "group-1",
        null,
        "sender-2",
        "xmtp.org/text:1.0" as ContentTypeId,
        "2024-01-01T00:00:00Z",
      ),
    ).toBe(false);
  });

  test("content-type scope reveals all messages of that type in group", () => {
    const store = createRevealStateStore();
    store.grant(
      makeGrant({ revealId: "rev-ct" }),
      makeRequest({
        revealId: "rev-ct",
        scope: "content-type",
        targetId: "xmtp.org/text:1.0",
      }),
    );

    expect(
      store.isRevealed(
        "msg-1",
        "group-1",
        null,
        "sender-1",
        "xmtp.org/text:1.0" as ContentTypeId,
        "2024-01-01T00:00:00Z",
      ),
    ).toBe(true);

    expect(
      store.isRevealed(
        "msg-2",
        "group-1",
        null,
        "sender-1",
        "xmtp.org/reaction:1.0" as ContentTypeId,
        "2024-01-01T00:00:00Z",
      ),
    ).toBe(false);
  });

  test("expired reveal returns false from isRevealed and is cleaned by expireStale", () => {
    const store = createRevealStateStore();
    const pastDate = "2024-01-01T00:00:00Z";
    store.grant(
      makeGrant({ expiresAt: pastDate }),
      makeRequest({ expiresAt: pastDate }),
    );

    // isRevealed checks expiry inline -- already-expired grant returns false
    expect(
      store.isRevealed(
        "msg-1",
        "group-1",
        null,
        "sender-1",
        "xmtp.org/text:1.0" as ContentTypeId,
        "2024-01-01T00:00:00Z",
      ),
    ).toBe(false);

    // expireStale removes the entry from the store entirely
    const removed = store.expireStale(new Date("2025-01-01T00:00:00Z"));
    expect(removed).toBe(1);

    // Still false after cleanup
    expect(
      store.isRevealed(
        "msg-1",
        "group-1",
        null,
        "sender-1",
        "xmtp.org/text:1.0" as ContentTypeId,
        "2024-01-01T00:00:00Z",
      ),
    ).toBe(false);
  });

  test("permanent reveal (expiresAt null) is not expired", () => {
    const store = createRevealStateStore();
    store.grant(makeGrant({ expiresAt: null }), makeRequest());

    const removed = store.expireStale(new Date("2099-01-01T00:00:00Z"));
    expect(removed).toBe(0);

    expect(
      store.isRevealed(
        "msg-1",
        "group-1",
        null,
        "sender-1",
        "xmtp.org/text:1.0" as ContentTypeId,
        "2024-01-01T00:00:00Z",
      ),
    ).toBe(true);
  });

  test("snapshot and restore round-trip preserves isRevealed behavior", () => {
    const store = createRevealStateStore();
    store.grant(
      makeGrant(),
      makeRequest({ scope: "message", targetId: "msg-1", groupId: "group-1" }),
    );
    store.grant(
      makeGrant({ revealId: "rev-thread" }),
      makeRequest({
        revealId: "rev-thread",
        scope: "thread",
        targetId: "thread-1",
        groupId: "group-1",
      }),
    );

    const snapshot = store.snapshot();
    expect(snapshot.activeReveals.length).toBe(2);

    const store2 = createRevealStateStore();
    store2.restore(snapshot);

    // After restore, isRevealed must still work correctly
    expect(
      store2.isRevealed(
        "msg-1",
        "group-1",
        null,
        "sender-1",
        "xmtp.org/text:1.0" as ContentTypeId,
        "2024-01-01T00:00:00Z",
      ),
    ).toBe(true);

    expect(
      store2.isRevealed(
        "msg-99",
        "group-1",
        "thread-1",
        "sender-1",
        "xmtp.org/text:1.0" as ContentTypeId,
        "2024-01-01T00:00:00Z",
      ),
    ).toBe(true);

    // Non-matching still returns false
    expect(
      store2.isRevealed(
        "msg-99",
        "group-1",
        null,
        "sender-1",
        "xmtp.org/text:1.0" as ContentTypeId,
        "2024-01-01T00:00:00Z",
      ),
    ).toBe(false);
  });

  test("snapshot includes request data for each reveal", () => {
    const store = createRevealStateStore();
    store.grant(
      makeGrant(),
      makeRequest({ groupId: "group-1", scope: "sender", targetId: "s-1" }),
    );

    const snapshot = store.snapshot();
    expect(snapshot.activeReveals.length).toBe(1);
    const entry = snapshot.activeReveals[0];
    expect(entry).toBeDefined();
    expect(entry!.request.groupId).toBe("group-1");
    expect(entry!.request.scope).toBe("sender");
    expect(entry!.request.targetId).toBe("s-1");
  });

  test("isRevealed returns false for expired grant without calling expireStale", () => {
    const store = createRevealStateStore();
    const pastDate = "2020-01-01T00:00:00Z";
    store.grant(
      makeGrant({ expiresAt: pastDate }),
      makeRequest({ scope: "message", targetId: "msg-1" }),
    );

    // The grant is expired — isRevealed should check expiry inline
    expect(
      store.isRevealed(
        "msg-1",
        "group-1",
        null,
        "sender-1",
        "xmtp.org/text:1.0" as ContentTypeId,
        "2024-01-01T00:00:00Z",
      ),
    ).toBe(false);
  });

  test("isRevealed returns true for non-expired grant with future expiry", () => {
    const store = createRevealStateStore();
    const futureDate = "2099-01-01T00:00:00Z";
    store.grant(
      makeGrant({ expiresAt: futureDate }),
      makeRequest({ scope: "message", targetId: "msg-1" }),
    );

    expect(
      store.isRevealed(
        "msg-1",
        "group-1",
        null,
        "sender-1",
        "xmtp.org/text:1.0" as ContentTypeId,
        "2024-01-01T00:00:00Z",
      ),
    ).toBe(true);
  });

  test("grant scoped to different group does not match", () => {
    const store = createRevealStateStore();
    store.grant(
      makeGrant(),
      makeRequest({ groupId: "group-2", scope: "message", targetId: "msg-1" }),
    );

    expect(
      store.isRevealed(
        "msg-1",
        "group-1",
        null,
        "sender-1",
        "xmtp.org/text:1.0" as ContentTypeId,
        "2024-01-01T00:00:00Z",
      ),
    ).toBe(false);
  });

  test("time-window scope reveals messages within the window", () => {
    const store = createRevealStateStore();
    store.grant(
      {
        revealId: "r1",
        grantedAt: "2024-01-01T00:00:00Z",
        grantedBy: "owner",
        expiresAt: null,
      },
      {
        revealId: "r1",
        groupId: "g1",
        scope: "time-window",
        targetId: "2024-01-01T10:00:00Z|2024-01-01T12:00:00Z",
        requestedBy: "owner",
        expiresAt: null,
      },
    );
    // Inside window
    expect(
      store.isRevealed(
        "m1",
        "g1",
        null,
        "s1",
        "xmtp.org/text:1.0",
        "2024-01-01T11:00:00Z",
      ),
    ).toBe(true);
    // Before window
    expect(
      store.isRevealed(
        "m2",
        "g1",
        null,
        "s1",
        "xmtp.org/text:1.0",
        "2024-01-01T09:00:00Z",
      ),
    ).toBe(false);
    // After window
    expect(
      store.isRevealed(
        "m3",
        "g1",
        null,
        "s1",
        "xmtp.org/text:1.0",
        "2024-01-01T13:00:00Z",
      ),
    ).toBe(false);
  });
});
