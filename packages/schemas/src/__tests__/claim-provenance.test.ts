import { describe, expect, it } from "bun:test";
import {
  ClaimProvenance,
  ClaimProvenanceRecord,
  ProvenanceMap,
} from "../claim-provenance.js";

describe("ClaimProvenance", () => {
  it("accepts all valid provenance levels", () => {
    for (const level of ["verified", "observed", "declared"]) {
      expect(ClaimProvenance.safeParse(level).success).toBe(true);
    }
  });

  it("rejects invalid provenance level", () => {
    expect(ClaimProvenance.safeParse("trusted").success).toBe(false);
    expect(ClaimProvenance.safeParse("").success).toBe(false);
  });
});

describe("ClaimProvenanceRecord", () => {
  it("accepts minimal record (source only)", () => {
    const result = ClaimProvenanceRecord.safeParse({ source: "declared" });
    expect(result.success).toBe(true);
  });

  it("accepts full record with attestation metadata", () => {
    const result = ClaimProvenanceRecord.safeParse({
      source: "observed",
      attestedBy: "inspector_a1b2c3d4e5f67890",
      attestedAt: "2026-03-26T12:00:00Z",
      expiresAt: "2026-03-27T12:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts record without expiresAt", () => {
    const result = ClaimProvenanceRecord.safeParse({
      source: "verified",
      attestedBy: "verifier_a1b2c3d4e5f67890",
      attestedAt: "2026-03-26T12:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects record with invalid expiresAt", () => {
    const result = ClaimProvenanceRecord.safeParse({
      source: "verified",
      expiresAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejects record with invalid source", () => {
    const result = ClaimProvenanceRecord.safeParse({ source: "trusted" });
    expect(result.success).toBe(false);
  });

  it("rejects record with invalid datetime", () => {
    const result = ClaimProvenanceRecord.safeParse({
      source: "verified",
      attestedAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });
});

describe("ProvenanceMap", () => {
  it("accepts empty map", () => {
    const result = ProvenanceMap.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts map with multiple entries", () => {
    const result = ProvenanceMap.safeParse({
      inferenceMode: { source: "declared" },
      hostingMode: {
        source: "observed",
        attestedBy: "inspector_a1b2c3d4e5f67890",
        attestedAt: "2026-03-26T12:00:00Z",
      },
      trustTier: {
        source: "verified",
        attestedBy: "verifier_c3d4e5f678901234",
        attestedAt: "2026-03-26T11:00:00Z",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects map with invalid record", () => {
    const result = ProvenanceMap.safeParse({
      inferenceMode: { source: "bogus" },
    });
    expect(result.success).toBe(false);
  });
});
