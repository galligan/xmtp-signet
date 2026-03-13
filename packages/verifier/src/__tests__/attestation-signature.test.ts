import { describe, expect, test } from "bun:test";
import { createAttestationSignatureCheck } from "../checks/attestation-signature.js";
import {
  createTestVerificationRequest,
  createTestAttestation,
} from "./fixtures.js";

describe("attestation_signature check", () => {
  test("skips when no attestation provided", async () => {
    const check = createAttestationSignatureCheck();
    const result = await check.execute(
      createTestVerificationRequest({ attestation: null }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("skip");
      expect(result.value.checkId).toBe("attestation_signature");
    }
  });

  test("skips when attestation has valid structure (v0: no crypto verification)", async () => {
    const check = createAttestationSignatureCheck();
    const result = await check.execute(createTestVerificationRequest());

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("skip");
    }
  });

  test("fails when attestation has empty issuer", async () => {
    const check = createAttestationSignatureCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        attestation: createTestAttestation({ issuer: "" }),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("issuer");
    }
  });

  test("fails when agentInboxId does not match", async () => {
    const check = createAttestationSignatureCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        agentInboxId: "agent-inbox-001",
        attestation: createTestAttestation({
          agentInboxId: "different-agent",
        }),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("does not match");
    }
  });
});
