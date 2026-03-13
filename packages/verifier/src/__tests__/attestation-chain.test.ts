import { describe, expect, test } from "bun:test";
import { createAttestationChainCheck } from "../checks/attestation-chain.js";
import {
  createTestVerificationRequest,
  createTestAttestation,
} from "./fixtures.js";

describe("attestation_chain check", () => {
  test("skips when no attestation provided", async () => {
    const check = createAttestationChainCheck();
    const result = await check.execute(
      createTestVerificationRequest({ attestation: null }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("skip");
      expect(result.value.checkId).toBe("attestation_chain");
    }
  });

  test("passes for initial attestation (null previous)", async () => {
    const check = createAttestationChainCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        attestation: createTestAttestation({
          previousAttestationId: null,
        }),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("pass");
      expect(result.value.reason).toContain("Initial attestation");
    }
  });

  test("passes for attestation with valid previous ID", async () => {
    const check = createAttestationChainCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        attestation: createTestAttestation({
          attestationId: "att-002",
          previousAttestationId: "att-001",
        }),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("pass");
      expect(result.value.reason).toContain("structurally valid");
    }
  });

  test("fails when attestation references itself", async () => {
    const check = createAttestationChainCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        attestation: createTestAttestation({
          attestationId: "att-001",
          previousAttestationId: "att-001",
        }),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("references itself");
    }
  });

  test("includes chain evidence", async () => {
    const check = createAttestationChainCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        attestation: createTestAttestation({
          attestationId: "att-002",
          previousAttestationId: "att-001",
        }),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const evidence = result.value.evidence as Record<string, unknown>;
      expect(evidence["previousId"]).toBe("att-001");
      expect(evidence["chainValid"]).toBe(true);
    }
  });
});
