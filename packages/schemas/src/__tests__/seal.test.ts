import { describe, expect, it } from "bun:test";
import {
  SealPayload,
  SealDelta,
  SealChain,
  MessageSealBinding,
  SealVerificationStatus,
  SealEnvelope,
} from "../seal.js";

describe("SealPayload", () => {
  const valid = {
    sealId: "seal_abc12345feedbabe",
    credentialId: "cred_abc12345feedbabe",
    operatorId: "op_abc12345feedbabe",
    chatId: "conv_abc12345feedbabe",
    scopeMode: "per-chat",
    permissions: {
      allow: ["send", "reply"],
      deny: ["add-member"],
    },
    issuedAt: "2024-01-01T00:00:00Z",
  };

  it("accepts a valid seal payload", () => {
    expect(SealPayload.safeParse(valid).success).toBe(true);
  });

  it("accepts payload with adminAccess", () => {
    const withAdmin = {
      ...valid,
      adminAccess: {
        operatorId: "op_adcd1234feedbabe",
        expiresAt: "2024-01-02T00:00:00Z",
      },
    };
    expect(SealPayload.safeParse(withAdmin).success).toBe(true);
  });

  it("accepts payload without adminAccess", () => {
    const result = SealPayload.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects invalid sealId prefix", () => {
    expect(SealPayload.safeParse({ ...valid, sealId: "bad_id" }).success).toBe(
      false,
    );
  });

  it("rejects invalid credentialId prefix", () => {
    expect(
      SealPayload.safeParse({ ...valid, credentialId: "bad_id" }).success,
    ).toBe(false);
  });

  it("rejects invalid operatorId prefix", () => {
    expect(
      SealPayload.safeParse({ ...valid, operatorId: "bad_id" }).success,
    ).toBe(false);
  });

  it("rejects invalid chatId prefix", () => {
    expect(SealPayload.safeParse({ ...valid, chatId: "bad_id" }).success).toBe(
      false,
    );
  });

  it("rejects invalid scopeMode", () => {
    expect(
      SealPayload.safeParse({ ...valid, scopeMode: "invalid" }).success,
    ).toBe(false);
  });

  it("rejects invalid datetime for issuedAt", () => {
    expect(
      SealPayload.safeParse({ ...valid, issuedAt: "not-a-date" }).success,
    ).toBe(false);
  });

  it("rejects invalid permission scope in permissions.allow", () => {
    expect(
      SealPayload.safeParse({
        ...valid,
        permissions: { allow: ["invalid-scope"], deny: [] },
      }).success,
    ).toBe(false);
  });
});

describe("SealDelta", () => {
  it("accepts valid delta with all fields", () => {
    const valid = {
      added: ["send", "reply"],
      removed: ["add-member"],
      changed: [{ scope: "react", from: "deny", to: "allow" }],
    };
    expect(SealDelta.safeParse(valid).success).toBe(true);
  });

  it("accepts delta with empty arrays", () => {
    const valid = { added: [], removed: [], changed: [] };
    expect(SealDelta.safeParse(valid).success).toBe(true);
  });

  it("rejects invalid scope in added", () => {
    expect(
      SealDelta.safeParse({
        added: ["invalid"],
        removed: [],
        changed: [],
      }).success,
    ).toBe(false);
  });

  it("rejects invalid from/to in changed", () => {
    expect(
      SealDelta.safeParse({
        added: [],
        removed: [],
        changed: [{ scope: "send", from: "invalid", to: "allow" }],
      }).success,
    ).toBe(false);
  });
});

describe("SealChain", () => {
  const payload = {
    sealId: "seal_abc12345feedbabe",
    credentialId: "cred_abc12345feedbabe",
    operatorId: "op_abc12345feedbabe",
    chatId: "conv_abc12345feedbabe",
    scopeMode: "per-chat",
    permissions: { allow: ["send"], deny: [] },
    issuedAt: "2024-01-01T00:00:00Z",
  };

  it("accepts valid chain with no previous seal", () => {
    const valid = {
      current: payload,
      delta: { added: ["send"], removed: [], changed: [] },
    };
    expect(SealChain.safeParse(valid).success).toBe(true);
  });

  it("accepts valid chain with previous seal", () => {
    const previous = {
      ...payload,
      sealId: "seal_beef1234feedbabe",
      permissions: { allow: [], deny: [] },
    };
    const valid = {
      current: payload,
      previous,
      delta: { added: ["send"], removed: [], changed: [] },
    };
    expect(SealChain.safeParse(valid).success).toBe(true);
  });
});

describe("MessageSealBinding", () => {
  it("accepts valid binding", () => {
    const valid = {
      sealRef: "seal_abc12345feedbabe",
      sealSignature: "sig_abc123",
    };
    expect(MessageSealBinding.safeParse(valid).success).toBe(true);
  });

  it("rejects invalid sealRef prefix", () => {
    expect(
      MessageSealBinding.safeParse({
        sealRef: "bad_id",
        sealSignature: "sig",
      }).success,
    ).toBe(false);
  });
});

describe("SealVerificationStatus", () => {
  it("accepts all valid statuses", () => {
    for (const s of ["valid", "superseded", "revoked", "missing"]) {
      expect(SealVerificationStatus.safeParse(s).success).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    expect(SealVerificationStatus.safeParse("invalid").success).toBe(false);
  });
});

describe("SealEnvelope", () => {
  const payload = {
    sealId: "seal_abc12345feedbabe",
    credentialId: "cred_abc12345feedbabe",
    operatorId: "op_abc12345feedbabe",
    chatId: "conv_abc12345feedbabe",
    scopeMode: "per-chat",
    permissions: { allow: ["send"], deny: [] },
    issuedAt: "2024-01-01T00:00:00Z",
  };

  const chain = {
    current: payload,
    delta: { added: ["send"], removed: [], changed: [] },
  };

  it("accepts valid envelope", () => {
    const valid = {
      chain,
      signature: "sig_hex",
      keyId: "key_abc12345feedbabe",
      algorithm: "Ed25519",
    };
    expect(SealEnvelope.safeParse(valid).success).toBe(true);
  });

  it("rejects invalid algorithm", () => {
    expect(
      SealEnvelope.safeParse({
        chain,
        signature: "sig",
        keyId: "key_abc12345feedbabe",
        algorithm: "RSA",
      }).success,
    ).toBe(false);
  });

  it("rejects invalid keyId prefix", () => {
    expect(
      SealEnvelope.safeParse({
        chain,
        signature: "sig",
        keyId: "bad_id",
        algorithm: "Ed25519",
      }).success,
    ).toBe(false);
  });
});
