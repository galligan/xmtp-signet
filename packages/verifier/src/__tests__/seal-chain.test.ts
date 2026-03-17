import { describe, expect, test } from "bun:test";
import { createSealChainCheck } from "../checks/seal-chain.js";
import { createTestVerificationRequest, createTestSeal } from "./fixtures.js";

describe("seal_chain check", () => {
  test("skips when no seal provided", async () => {
    const check = createSealChainCheck();
    const result = await check.execute(
      createTestVerificationRequest({ seal: null }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("skip");
      expect(result.value.checkId).toBe("seal_chain");
    }
  });

  test("passes for initial seal (null previous)", async () => {
    const check = createSealChainCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        seal: createTestSeal({
          previousSealId: null,
        }),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("pass");
      expect(result.value.reason).toContain("Initial seal");
    }
  });

  test("passes for seal with valid previous ID", async () => {
    const check = createSealChainCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        seal: createTestSeal({
          sealId: "att-002",
          previousSealId: "att-001",
        }),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("pass");
      expect(result.value.reason).toContain("structurally valid");
    }
  });

  test("fails when seal references itself", async () => {
    const check = createSealChainCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        seal: createTestSeal({
          sealId: "att-001",
          previousSealId: "att-001",
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
    const check = createSealChainCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        seal: createTestSeal({
          sealId: "att-002",
          previousSealId: "att-001",
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
