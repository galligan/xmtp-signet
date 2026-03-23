import { describe, expect, it } from "bun:test";
import {
  CredentialStatus,
  CredentialConfig,
  CredentialIssuer,
  CredentialRecord,
  CredentialToken,
  IssuedCredential,
} from "../credential.js";

// -- CredentialStatus -------------------------------------------------------

describe("CredentialStatus", () => {
  it("accepts 'pending'", () => {
    expect(CredentialStatus.safeParse("pending").success).toBe(true);
  });

  it("accepts 'active'", () => {
    expect(CredentialStatus.safeParse("active").success).toBe(true);
  });

  it("accepts 'expired'", () => {
    expect(CredentialStatus.safeParse("expired").success).toBe(true);
  });

  it("accepts 'revoked'", () => {
    expect(CredentialStatus.safeParse("revoked").success).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(CredentialStatus.safeParse("unknown").success).toBe(false);
  });
});

// -- CredentialConfig -------------------------------------------------------

const validConfig = {
  operatorId: "op_abcd1234feedbabe",
  chatIds: ["conv_abcd1234feedbabe"],
  ttlSeconds: 3600,
};

describe("CredentialConfig", () => {
  it("accepts minimal valid config", () => {
    const result = CredentialConfig.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it("accepts config with policyId", () => {
    const result = CredentialConfig.safeParse({
      ...validConfig,
      policyId: "policy_abcd1234feedbabe",
    });
    expect(result.success).toBe(true);
  });

  it("accepts config with inline allow and deny", () => {
    const result = CredentialConfig.safeParse({
      ...validConfig,
      allow: ["send", "react"],
      deny: ["leave"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts config without ttlSeconds for runtime defaulting", () => {
    const result = CredentialConfig.safeParse({
      operatorId: "op_abcd1234feedbabe",
      chatIds: ["conv_abcd1234feedbabe"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ttlSeconds).toBeUndefined();
    }
  });

  it("rejects empty chatIds array", () => {
    const result = CredentialConfig.safeParse({
      ...validConfig,
      chatIds: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid operatorId prefix", () => {
    const result = CredentialConfig.safeParse({
      ...validConfig,
      operatorId: "cred_abcd1234feedbabe",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid conversationId prefix in chatIds", () => {
    const result = CredentialConfig.safeParse({
      ...validConfig,
      chatIds: ["op_abcd1234feedbabe"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid policyId prefix", () => {
    const result = CredentialConfig.safeParse({
      ...validConfig,
      policyId: "op_abcd1234feedbabe",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid scope in allow", () => {
    const result = CredentialConfig.safeParse({
      ...validConfig,
      allow: ["not-a-scope"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid scope in deny", () => {
    const result = CredentialConfig.safeParse({
      ...validConfig,
      deny: ["not-a-scope"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative ttlSeconds", () => {
    const result = CredentialConfig.safeParse({
      ...validConfig,
      ttlSeconds: -100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero ttlSeconds", () => {
    const result = CredentialConfig.safeParse({
      ...validConfig,
      ttlSeconds: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer ttlSeconds", () => {
    const result = CredentialConfig.safeParse({
      ...validConfig,
      ttlSeconds: 3.5,
    });
    expect(result.success).toBe(false);
  });
});

// -- CredentialRecord -------------------------------------------------------

const validRecord = {
  id: "cred_abcd1234feedbabe",
  config: validConfig,
  inboxIds: ["inbox_abcd1234feedbabe"],
  status: "active",
  issuedAt: "2024-01-01T00:00:00Z",
  expiresAt: "2024-01-01T01:00:00Z",
  issuedBy: "owner",
};

describe("CredentialIssuer", () => {
  it("accepts owner", () => {
    expect(CredentialIssuer.safeParse("owner").success).toBe(true);
  });

  it("accepts operator issuer ids", () => {
    expect(CredentialIssuer.safeParse("op_deadbeeffeedbabe").success).toBe(true);
  });

  it("rejects unrelated resource ids", () => {
    expect(CredentialIssuer.safeParse("cred_deadbeeffeedbabe").success).toBe(false);
  });
});

describe("CredentialRecord", () => {
  it("accepts valid record", () => {
    const result = CredentialRecord.safeParse(validRecord);
    expect(result.success).toBe(true);
  });

  it("accepts operator issuers", () => {
    const result = CredentialRecord.safeParse({
      ...validRecord,
      issuedBy: "op_deadbeeffeedbabe",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid credential id prefix", () => {
    const result = CredentialRecord.safeParse({
      ...validRecord,
      id: "op_abcd1234feedbabe",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status", () => {
    const result = CredentialRecord.safeParse({
      ...validRecord,
      status: "unknown",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid inbox id prefix in inboxIds", () => {
    const result = CredentialRecord.safeParse({
      ...validRecord,
      inboxIds: ["op_abcd1234feedbabe"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid datetime for issuedAt", () => {
    const result = CredentialRecord.safeParse({
      ...validRecord,
      issuedAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid datetime for expiresAt", () => {
    const result = CredentialRecord.safeParse({
      ...validRecord,
      expiresAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid issuedBy value", () => {
    const result = CredentialRecord.safeParse({
      ...validRecord,
      issuedBy: "cred_abcd1234feedbabe",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing config", () => {
    const { config: _, ...noConfig } = validRecord;
    const result = CredentialRecord.safeParse(noConfig);
    expect(result.success).toBe(false);
  });
});

// -- CredentialToken --------------------------------------------------------

const validToken = {
  credentialId: "cred_abcd1234feedbabe",
  operatorId: "op_abcd1234feedbabe",
  fingerprint: "sha256:abc123",
  issuedAt: "2024-01-01T00:00:00Z",
  expiresAt: "2024-01-01T01:00:00Z",
};

describe("CredentialToken", () => {
  it("accepts valid token", () => {
    const result = CredentialToken.safeParse(validToken);
    expect(result.success).toBe(true);
  });

  it("rejects invalid credentialId prefix", () => {
    const result = CredentialToken.safeParse({
      ...validToken,
      credentialId: "op_abcd1234feedbabe",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid operatorId prefix", () => {
    const result = CredentialToken.safeParse({
      ...validToken,
      operatorId: "cred_abcd1234feedbabe",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid datetime for issuedAt", () => {
    const result = CredentialToken.safeParse({
      ...validToken,
      issuedAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid datetime for expiresAt", () => {
    const result = CredentialToken.safeParse({
      ...validToken,
      expiresAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing fingerprint", () => {
    const { fingerprint: _, ...noFp } = validToken;
    const result = CredentialToken.safeParse(noFp);
    expect(result.success).toBe(false);
  });
});

// -- IssuedCredential -------------------------------------------------------

describe("IssuedCredential", () => {
  it("accepts valid issued credential", () => {
    const result = IssuedCredential.safeParse({
      token: "bearer-token-abc123",
      credential: validRecord,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty token string", () => {
    const result = IssuedCredential.safeParse({
      token: "",
      credential: validRecord,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing credential", () => {
    const result = IssuedCredential.safeParse({
      token: "bearer-token-abc123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid credential record", () => {
    const result = IssuedCredential.safeParse({
      token: "bearer-token-abc123",
      credential: { id: "not-valid" },
    });
    expect(result.success).toBe(false);
  });
});
