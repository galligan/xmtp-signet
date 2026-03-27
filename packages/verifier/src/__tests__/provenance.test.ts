import { describe, expect, it } from "bun:test";
import type { VerificationStatement } from "../schemas/statement.js";
import type { VerificationCheck } from "../schemas/check.js";
import { deriveProvenanceMap } from "../provenance.js";

function makeCheck(
  checkId: string,
  verdict: "pass" | "fail" | "skip",
): VerificationCheck {
  return { checkId, verdict, reason: "test", evidence: null };
}

function makeStatement(
  overrides: Partial<VerificationStatement> & {
    checks: VerificationCheck[];
  },
): VerificationStatement {
  return {
    statementId: "stmt-001",
    requestId: "req-001",
    verifierInboxId: "verifier-inbox-001",
    signetInboxId: "signet-inbox-001",
    agentInboxId: "agent-inbox-001",
    verdict: "verified",
    verifiedTier: "source-verified",
    challengeNonce: "deadbeef".repeat(8),
    issuedAt: "2025-01-15T00:00:00.000Z",
    expiresAt: "2025-01-16T00:00:00.000Z",
    signature: "bW9jay1zaWduYXR1cmU=",
    signatureAlgorithm: "Ed25519",
    ...overrides,
  };
}

describe("deriveProvenanceMap", () => {
  it("returns empty map when no checks pass", () => {
    const statement = makeStatement({
      verifiedTier: "unverified",
      checks: [
        makeCheck("build_provenance", "fail"),
        makeCheck("source_available", "skip"),
      ],
    });

    const map = deriveProvenanceMap(statement);
    expect(Object.keys(map)).toHaveLength(0);
  });

  it("maps passing build_provenance to buildProvenance field", () => {
    const statement = makeStatement({
      checks: [makeCheck("build_provenance", "pass")],
    });

    const map = deriveProvenanceMap(statement);
    expect(map["buildProvenance"]).toEqual({
      source: "verified",
      attestedBy: "verifier-inbox-001",
      attestedAt: "2025-01-15T00:00:00.000Z",
      expiresAt: "2025-01-16T00:00:00.000Z",
    });
  });

  it("maps passing source_available to sourceRepo field", () => {
    const statement = makeStatement({
      checks: [makeCheck("source_available", "pass")],
    });

    const map = deriveProvenanceMap(statement);
    expect(map["sourceRepo"]).toEqual({
      source: "verified",
      attestedBy: "verifier-inbox-001",
      attestedAt: "2025-01-15T00:00:00.000Z",
      expiresAt: "2025-01-16T00:00:00.000Z",
    });
  });

  it("maps passing release_signing to releaseSigning field", () => {
    const statement = makeStatement({
      checks: [makeCheck("release_signing", "pass")],
    });

    const map = deriveProvenanceMap(statement);
    expect(map["releaseSigning"]).toEqual({
      source: "verified",
      attestedBy: "verifier-inbox-001",
      attestedAt: "2025-01-15T00:00:00.000Z",
      expiresAt: "2025-01-16T00:00:00.000Z",
    });
  });

  it("includes trustTier when verifiedTier is above unverified", () => {
    const statement = makeStatement({
      verifiedTier: "source-verified",
      checks: [],
    });

    const map = deriveProvenanceMap(statement);
    expect(map["trustTier"]).toEqual({
      source: "verified",
      attestedBy: "verifier-inbox-001",
      attestedAt: "2025-01-15T00:00:00.000Z",
      expiresAt: "2025-01-16T00:00:00.000Z",
    });
  });

  it("excludes trustTier when verifiedTier is unverified", () => {
    const statement = makeStatement({
      verifiedTier: "unverified",
      checks: [],
    });

    const map = deriveProvenanceMap(statement);
    expect(map["trustTier"]).toBeUndefined();
  });

  it("ignores structural checks (seal_signature, seal_chain, schema_compliance)", () => {
    const statement = makeStatement({
      verifiedTier: "unverified",
      checks: [
        makeCheck("seal_signature", "pass"),
        makeCheck("seal_chain", "pass"),
        makeCheck("schema_compliance", "pass"),
      ],
    });

    const map = deriveProvenanceMap(statement);
    expect(Object.keys(map)).toHaveLength(0);
  });

  it("maps multiple passing checks correctly", () => {
    const statement = makeStatement({
      verifiedTier: "source-verified",
      checks: [
        makeCheck("build_provenance", "pass"),
        makeCheck("source_available", "pass"),
        makeCheck("release_signing", "pass"),
        makeCheck("seal_signature", "pass"),
        makeCheck("seal_chain", "pass"),
        makeCheck("schema_compliance", "pass"),
      ],
    });

    const map = deriveProvenanceMap(statement);
    expect(Object.keys(map).sort()).toEqual([
      "buildProvenance",
      "releaseSigning",
      "sourceRepo",
      "trustTier",
    ]);

    // All should have the same verifier attribution
    for (const key of Object.keys(map)) {
      expect(map[key]?.source).toBe("verified");
      expect(map[key]?.attestedBy).toBe("verifier-inbox-001");
    }
  });

  it("only includes fields for passing checks, not failed or skipped", () => {
    const statement = makeStatement({
      verifiedTier: "source-verified",
      checks: [
        makeCheck("build_provenance", "pass"),
        makeCheck("source_available", "fail"),
        makeCheck("release_signing", "skip"),
      ],
    });

    const map = deriveProvenanceMap(statement);
    expect(map["buildProvenance"]).toBeDefined();
    expect(map["sourceRepo"]).toBeUndefined();
    expect(map["releaseSigning"]).toBeUndefined();
    expect(map["trustTier"]).toBeDefined();
  });
});
