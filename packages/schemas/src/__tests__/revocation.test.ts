import { describe, expect, it } from "bun:test";
import {
  AgentRevocationReason,
  SessionRevocationReason,
  RevocationSeal,
} from "../revocation.js";

describe("AgentRevocationReason", () => {
  it("accepts all valid reasons", () => {
    for (const r of [
      "owner-initiated",
      "session-expired",
      "admin-removed",
      "heartbeat-timeout",
      "policy-violation",
    ]) {
      expect(AgentRevocationReason.safeParse(r).success).toBe(true);
    }
  });

  it("rejects invalid reason", () => {
    expect(AgentRevocationReason.safeParse("unknown").success).toBe(false);
  });
});

describe("SessionRevocationReason", () => {
  it("accepts all valid reasons", () => {
    for (const r of [
      "owner-initiated",
      "session-expired",
      "heartbeat-timeout",
      "policy-violation",
      "reauthorization-required",
    ]) {
      expect(SessionRevocationReason.safeParse(r).success).toBe(true);
    }
  });

  it("rejects admin-removed (agent-only reason)", () => {
    expect(SessionRevocationReason.safeParse("admin-removed").success).toBe(
      false,
    );
  });
});

describe("RevocationSeal", () => {
  const valid = {
    sealId: "rev-att-1",
    previousSealId: "att-001",
    agentInboxId: "agent-1",
    groupId: "group-1",
    reason: "owner-initiated",
    revokedAt: "2024-01-01T00:00:00Z",
    issuer: "signet-1",
  };

  it("accepts valid revocation seal", () => {
    expect(RevocationSeal.safeParse(valid).success).toBe(true);
  });

  it("rejects invalid reason", () => {
    expect(
      RevocationSeal.safeParse({ ...valid, reason: "invalid" }).success,
    ).toBe(false);
  });

  it("rejects invalid datetime", () => {
    expect(
      RevocationSeal.safeParse({ ...valid, revokedAt: "bad" }).success,
    ).toBe(false);
  });

  it("requires previousSealId as non-nullable string", () => {
    expect(
      RevocationSeal.safeParse({
        ...valid,
        previousSealId: null,
      }).success,
    ).toBe(false);
  });
});
