import { describe, expect, it } from "bun:test";
import {
  AgentRevocationReason,
  CredentialRevocationReason,
  RevocationSeal,
} from "../revocation.js";

describe("AgentRevocationReason", () => {
  it("accepts all valid reasons", () => {
    for (const r of [
      "owner-initiated",
      "credential-expired",
      "admin-removed",
      "heartbeat-timeout",
      "policy-violation",
    ]) {
      expect(AgentRevocationReason.safeParse(r).success).toBe(true);
    }
  });

  it("rejects session-expired (replaced by credential-expired)", () => {
    expect(AgentRevocationReason.safeParse("session-expired").success).toBe(
      false,
    );
  });

  it("rejects invalid reason", () => {
    expect(AgentRevocationReason.safeParse("unknown").success).toBe(false);
  });
});

describe("CredentialRevocationReason", () => {
  it("accepts all valid reasons", () => {
    for (const r of [
      "owner-initiated",
      "credential-expired",
      "heartbeat-timeout",
      "policy-violation",
      "reauthorization-required",
    ]) {
      expect(CredentialRevocationReason.safeParse(r).success).toBe(true);
    }
  });

  it("rejects session-expired (replaced by credential-expired)", () => {
    expect(
      CredentialRevocationReason.safeParse("session-expired").success,
    ).toBe(false);
  });

  it("rejects admin-removed (agent-only reason)", () => {
    expect(CredentialRevocationReason.safeParse("admin-removed").success).toBe(
      false,
    );
  });
});

describe("RevocationSeal", () => {
  const valid = {
    sealId: "seal_fedc1234deadbeef",
    previousSealId: "seal_abc12345fedcba98",
    operatorId: "op_abc12345fedcba98",
    credentialId: "cred_abc12345fedcba98",
    chatId: "conv_abc12345fedcba98",
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

  it("rejects invalid sealId prefix", () => {
    expect(
      RevocationSeal.safeParse({ ...valid, sealId: "bad_id" }).success,
    ).toBe(false);
  });

  it("rejects invalid previousSealId prefix", () => {
    expect(
      RevocationSeal.safeParse({ ...valid, previousSealId: "bad_id" }).success,
    ).toBe(false);
  });

  it("rejects invalid operatorId prefix", () => {
    expect(
      RevocationSeal.safeParse({ ...valid, operatorId: "bad_id" }).success,
    ).toBe(false);
  });

  it("rejects invalid credentialId prefix", () => {
    expect(
      RevocationSeal.safeParse({ ...valid, credentialId: "bad_id" }).success,
    ).toBe(false);
  });

  it("rejects invalid chatId prefix", () => {
    expect(
      RevocationSeal.safeParse({ ...valid, chatId: "bad_id" }).success,
    ).toBe(false);
  });

  it("requires previousSealId as non-nullable string", () => {
    expect(
      RevocationSeal.safeParse({ ...valid, previousSealId: null }).success,
    ).toBe(false);
  });
});
