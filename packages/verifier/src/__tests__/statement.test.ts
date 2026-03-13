import { describe, expect, test } from "bun:test";
import { VerificationStatementSchema } from "../schemas/statement.js";

describe("VerificationStatementSchema", () => {
  const validStatement = {
    statementId: "stmt-001",
    requestId: "req-001",
    verifierInboxId: "verifier-inbox-001",
    brokerInboxId: "broker-inbox-001",
    agentInboxId: "agent-inbox-001",
    verdict: "verified",
    verifiedTier: "source-verified",
    checks: [
      {
        checkId: "schema_compliance",
        verdict: "pass",
        reason: "Valid",
        evidence: null,
      },
    ],
    challengeNonce: "deadbeef".repeat(8),
    issuedAt: "2025-01-15T00:00:00.000Z",
    expiresAt: "2025-01-16T00:00:00.000Z",
    signature: "bW9jay1zaWduYXR1cmU=",
    signatureAlgorithm: "Ed25519" as const,
  };

  test("accepts a valid statement", () => {
    const result = VerificationStatementSchema.safeParse(validStatement);
    expect(result.success).toBe(true);
  });

  test("rejects statement with invalid verdict", () => {
    const result = VerificationStatementSchema.safeParse({
      ...validStatement,
      verdict: "unknown",
    });
    expect(result.success).toBe(false);
  });

  test("rejects statement with wrong signatureAlgorithm", () => {
    const result = VerificationStatementSchema.safeParse({
      ...validStatement,
      signatureAlgorithm: "RSA",
    });
    expect(result.success).toBe(false);
  });

  test("rejects statement missing checks array", () => {
    const { checks: _, ...rest } = validStatement;
    const result = VerificationStatementSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  test("rejects statement with invalid datetime", () => {
    const result = VerificationStatementSchema.safeParse({
      ...validStatement,
      issuedAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });
});
