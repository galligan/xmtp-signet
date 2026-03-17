import { describe, expect, it } from "bun:test";
import {
  InferenceMode,
  ContentEgressScope,
  RetentionAtProvider,
  HostingMode,
  TrustTier,
  RevocationRules,
  SealSchema,
} from "../seal.js";

describe("InferenceMode", () => {
  it("accepts all valid modes", () => {
    for (const m of ["local", "external", "hybrid", "unknown"]) {
      expect(InferenceMode.safeParse(m).success).toBe(true);
    }
  });

  it("rejects invalid mode", () => {
    expect(InferenceMode.safeParse("other").success).toBe(false);
  });
});

describe("ContentEgressScope", () => {
  it("accepts all valid scopes", () => {
    for (const s of [
      "full-messages",
      "summaries-only",
      "tool-calls-only",
      "none",
      "unknown",
    ]) {
      expect(ContentEgressScope.safeParse(s).success).toBe(true);
    }
  });
});

describe("RetentionAtProvider", () => {
  it("accepts all valid retention values", () => {
    for (const r of ["none", "session", "persistent", "unknown"]) {
      expect(RetentionAtProvider.safeParse(r).success).toBe(true);
    }
  });
});

describe("HostingMode", () => {
  it("accepts all valid hosting modes", () => {
    for (const h of ["local", "self-hosted", "managed"]) {
      expect(HostingMode.safeParse(h).success).toBe(true);
    }
  });
});

describe("TrustTier", () => {
  it("accepts all valid trust tiers", () => {
    for (const t of [
      "unverified",
      "source-verified",
      "reproducibly-verified",
      "runtime-attested",
    ]) {
      expect(TrustTier.safeParse(t).success).toBe(true);
    }
  });
});

describe("RevocationRules", () => {
  it("accepts valid revocation rules", () => {
    const valid = {
      maxTtlSeconds: 3600,
      requireHeartbeat: true,
      ownerCanRevoke: true,
      adminCanRemove: false,
    };
    expect(RevocationRules.safeParse(valid).success).toBe(true);
  });

  it("rejects non-positive maxTtlSeconds", () => {
    const invalid = {
      maxTtlSeconds: 0,
      requireHeartbeat: true,
      ownerCanRevoke: true,
      adminCanRemove: false,
    };
    expect(RevocationRules.safeParse(invalid).success).toBe(false);
  });

  it("rejects non-integer maxTtlSeconds", () => {
    const invalid = {
      maxTtlSeconds: 3600.5,
      requireHeartbeat: true,
      ownerCanRevoke: true,
      adminCanRemove: false,
    };
    expect(RevocationRules.safeParse(invalid).success).toBe(false);
  });
});

function createValidSeal(
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    sealId: "att-001",
    previousSealId: null,
    agentInboxId: "agent-inbox-1",
    ownerInboxId: "owner-inbox-1",
    groupId: "group-1",
    threadScope: null,
    viewMode: "full",
    contentTypes: ["xmtp.org/text:1.0"],
    grantedOps: ["send", "reply"],
    toolScopes: [],
    inferenceMode: "external",
    inferenceProviders: ["openai"],
    contentEgressScope: "full-messages",
    retentionAtProvider: "session",
    hostingMode: "managed",
    trustTier: "unverified",
    buildProvenanceRef: null,
    verifierStatementRef: null,
    sessionKeyFingerprint: null,
    policyHash: "abc123",
    heartbeatInterval: 30,
    issuedAt: "2024-01-01T00:00:00Z",
    expiresAt: "2024-01-01T01:00:00Z",
    revocationRules: {
      maxTtlSeconds: 3600,
      requireHeartbeat: true,
      ownerCanRevoke: true,
      adminCanRemove: false,
    },
    issuer: "signet-identity-1",
    ...overrides,
  };
}

describe("SealSchema", () => {
  it("accepts a valid full seal", () => {
    const result = SealSchema.safeParse(createValidSeal());
    expect(result.success).toBe(true);
  });

  it("has exactly 25 fields", () => {
    const keys = Object.keys(SealSchema.shape);
    expect(keys).toHaveLength(25);
  });

  it("defaults heartbeatInterval to 30", () => {
    const input = createValidSeal();
    delete input["heartbeatInterval"];
    const result = SealSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.heartbeatInterval).toBe(30);
    }
  });

  it("rejects undefined for nullable fields (must be explicit null)", () => {
    const input = createValidSeal();
    delete input["buildProvenanceRef"];
    expect(SealSchema.safeParse(input).success).toBe(false);
  });

  it("accepts null for all nullable fields", () => {
    const result = SealSchema.safeParse(
      createValidSeal({
        previousSealId: null,
        threadScope: null,
        buildProvenanceRef: null,
        verifierStatementRef: null,
        sessionKeyFingerprint: null,
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects invalid datetime format", () => {
    expect(
      SealSchema.safeParse(createValidSeal({ issuedAt: "not-a-date" })).success,
    ).toBe(false);
  });

  it("rejects invalid viewMode", () => {
    expect(
      SealSchema.safeParse(createValidSeal({ viewMode: "bad" })).success,
    ).toBe(false);
  });

  it("rejects invalid content type in contentTypes array", () => {
    expect(
      SealSchema.safeParse(createValidSeal({ contentTypes: ["invalid"] }))
        .success,
    ).toBe(false);
  });
});
