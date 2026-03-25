import { describe, expect, it } from "bun:test";
import {
  RevealScope,
  RevealRequest,
  RevealAccess,
  RevealState,
} from "../reveal.js";

describe("RevealScope", () => {
  it("accepts all valid scopes", () => {
    for (const s of [
      "message",
      "thread",
      "time-window",
      "content-type",
      "sender",
    ]) {
      expect(RevealScope.safeParse(s).success).toBe(true);
    }
  });

  it("rejects invalid scope", () => {
    expect(RevealScope.safeParse("group").success).toBe(false);
  });
});

describe("RevealRequest", () => {
  const valid = {
    revealId: "rev-1",
    groupId: "group-1",
    scope: "message",
    targetId: "msg-123",
    requestedBy: "inbox-1",
    expiresAt: null,
  };

  it("accepts valid reveal request with null expiry", () => {
    expect(RevealRequest.safeParse(valid).success).toBe(true);
  });

  it("accepts valid reveal request with datetime expiry", () => {
    expect(
      RevealRequest.safeParse({
        ...valid,
        expiresAt: "2024-06-01T00:00:00Z",
      }).success,
    ).toBe(true);
  });

  it("rejects missing expiresAt (must be explicit null)", () => {
    const { expiresAt: _, ...rest } = valid;
    expect(RevealRequest.safeParse(rest).success).toBe(false);
  });

  it("rejects invalid scope", () => {
    expect(
      RevealRequest.safeParse({ ...valid, scope: "invalid" }).success,
    ).toBe(false);
  });
});

describe("RevealAccess", () => {
  it("accepts valid access with null expiry", () => {
    const valid = {
      revealId: "rev-1",
      grantedAt: "2024-01-01T00:00:00Z",
      grantedBy: "inbox-2",
      expiresAt: null,
    };
    expect(RevealAccess.safeParse(valid).success).toBe(true);
  });

  it("accepts valid access with datetime expiry", () => {
    const valid = {
      revealId: "rev-1",
      grantedAt: "2024-01-01T00:00:00Z",
      grantedBy: "inbox-2",
      expiresAt: "2024-06-01T00:00:00Z",
    };
    expect(RevealAccess.safeParse(valid).success).toBe(true);
  });
});

describe("RevealState", () => {
  it("accepts empty active reveals", () => {
    expect(RevealState.safeParse({ activeReveals: [] }).success).toBe(true);
  });

  it("accepts active reveals with valid access records", () => {
    const valid = {
      activeReveals: [
        {
          revealId: "rev-1",
          grantedAt: "2024-01-01T00:00:00Z",
          grantedBy: "inbox-2",
          expiresAt: null,
        },
      ],
    };
    expect(RevealState.safeParse(valid).success).toBe(true);
  });
});
