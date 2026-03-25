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

  test("skips when seal has valid structure (signature verification deferred)", async () => {
    const check = createSealSignatureCheck();
    const result = await check.execute(createTestVerificationRequest());

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("skip");
    }
  });

  test("fails when operatorId is empty", async () => {
    const check = createSealSignatureCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        seal: createTestSeal({ operatorId: "" }),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("operatorId");
    }
  });

  test("fails when issuedAt is non-canonical", async () => {
    const check = createSealSignatureCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        seal: createTestSeal({
          issuedAt: "2025-01-15T00:00:00Z",
        }),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("issuedAt");
    }
  });
});
