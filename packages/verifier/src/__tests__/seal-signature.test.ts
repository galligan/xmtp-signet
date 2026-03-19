import { describe, expect, test } from "bun:test";
import { createSealSignatureCheck } from "../checks/seal-signature.js";
import { createTestVerificationRequest, createTestSeal } from "./fixtures.js";

describe("seal_signature check", () => {
  test("skips when no seal provided", async () => {
    const check = createSealSignatureCheck();
    const result = await check.execute(
      createTestVerificationRequest({ seal: null }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("skip");
      expect(result.value.checkId).toBe("seal_signature");
    }
  });

  test("skips when seal has valid structure (v0: no crypto verification)", async () => {
    const check = createSealSignatureCheck();
    const result = await check.execute(createTestVerificationRequest());

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("skip");
    }
  });

  test("fails when seal has empty issuer", async () => {
    const check = createSealSignatureCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        seal: createTestSeal({ issuer: "" }),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("issuer");
    }
  });

  test("fails when agentInboxId does not match", async () => {
    const check = createSealSignatureCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        agentInboxId: "agent-inbox-001",
        seal: createTestSeal({
          agentInboxId: "different-agent",
        }),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("mismatch");
    }
  });
});
