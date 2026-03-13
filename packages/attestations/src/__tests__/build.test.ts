import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { buildAttestation } from "../build.js";
import { validInput } from "./fixtures.js";

describe("buildAttestation", () => {
  test("builds attestation from valid input with null previousAttestationId", () => {
    const result = buildAttestation(validInput(), null);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    expect(result.value.attestation.previousAttestationId).toBeNull();
  });

  test("generates attestation ID with att_ prefix", () => {
    const result = buildAttestation(validInput(), null);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    expect(result.value.attestation.attestationId).toMatch(
      /^att_[0-9a-f]{32}$/,
    );
  });

  test("chains to previous attestation when provided", () => {
    const result = buildAttestation(validInput(), "att_previous123");
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    expect(result.value.attestation.previousAttestationId).toBe(
      "att_previous123",
    );
  });

  test("sets issuedAt to current time", () => {
    const before = new Date();
    const result = buildAttestation(validInput(), null);
    const after = new Date();
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    const issuedAt = new Date(result.value.attestation.issuedAt);
    expect(issuedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(issuedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test("sets expiresAt to 24 hours after issuedAt by default", () => {
    const result = buildAttestation(validInput(), null);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    const issued = new Date(result.value.attestation.issuedAt).getTime();
    const expires = new Date(result.value.attestation.expiresAt).getTime();
    expect(expires - issued).toBe(86400 * 1000);
  });

  test("respects custom ttlSeconds", () => {
    const result = buildAttestation(validInput(), null, 3600);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    const issued = new Date(result.value.attestation.issuedAt).getTime();
    const expires = new Date(result.value.attestation.expiresAt).getTime();
    expect(expires - issued).toBe(3600 * 1000);
  });

  test("maps view mode from input", () => {
    const result = buildAttestation(validInput(), null);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    expect(result.value.attestation.viewMode).toBe("full");
  });

  test("maps content types from view config", () => {
    const result = buildAttestation(validInput(), null);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    expect(result.value.attestation.contentTypes).toEqual([
      "xmtp.org/text:1.0",
    ]);
  });

  test("maps grantedOps from grant config", () => {
    const result = buildAttestation(validInput(), null);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    expect(result.value.attestation.grantedOps).toContain("messaging:send");
    expect(result.value.attestation.grantedOps).toContain("messaging:reply");
  });

  test("maps toolScopes from grant config", () => {
    const input = validInput({
      grant: {
        ...validInput().grant,
        tools: {
          scopes: [{ toolId: "search", allowed: true, parameters: null }],
        },
      },
    });
    const result = buildAttestation(input, null);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    expect(result.value.attestation.toolScopes).toEqual(["search"]);
  });

  test("produces serialized bytes of the attestation", () => {
    const result = buildAttestation(validInput(), null);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    expect(result.value.serialized).toBeInstanceOf(Uint8Array);
    expect(result.value.serialized.length).toBeGreaterThan(0);
  });

  test("copies all input fields to attestation", () => {
    const input = validInput({
      inferenceMode: "external",
      inferenceProviders: ["openai"],
      contentEgressScope: "summaries-only",
      retentionAtProvider: "session",
      hostingMode: "managed",
      trustTier: "source-verified",
      buildProvenanceRef: "ref-123",
      verifierStatementRef: "verifier-456",
      sessionKeyFingerprint: "fp-789",
      policyHash: "sha256:xyz",
      heartbeatInterval: 60,
    });
    const result = buildAttestation(input, null);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    const att = result.value.attestation;
    expect(att.inferenceMode).toBe("external");
    expect(att.inferenceProviders).toEqual(["openai"]);
    expect(att.contentEgressScope).toBe("summaries-only");
    expect(att.retentionAtProvider).toBe("session");
    expect(att.hostingMode).toBe("managed");
    expect(att.trustTier).toBe("source-verified");
    expect(att.buildProvenanceRef).toBe("ref-123");
    expect(att.verifierStatementRef).toBe("verifier-456");
    expect(att.sessionKeyFingerprint).toBe("fp-789");
    expect(att.policyHash).toBe("sha256:xyz");
    expect(att.heartbeatInterval).toBe(60);
  });

  test("copies revocationRules from input", () => {
    const result = buildAttestation(validInput(), null);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    expect(result.value.attestation.revocationRules).toEqual({
      maxTtlSeconds: 86400,
      requireHeartbeat: true,
      ownerCanRevoke: true,
      adminCanRemove: true,
    });
  });

  test("sets issuer from input", () => {
    const result = buildAttestation(validInput({ issuer: "my-broker" }), null);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    expect(result.value.attestation.issuer).toBe("my-broker");
  });
});
