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

  test("validates initial seal (null previous)", async () => {
    const check = createSealChainCheck();
    const result = await check.execute(createTestVerificationRequest());

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("skip");
      expect(result.value.reason).toContain("structurally valid");
      const evidence = result.value.evidence as Record<string, unknown>;
      expect(evidence["sealId"]).toBe("seal_a1b2c3d4feedbabe");
      expect(evidence["chainValid"]).toBe(true);
      expect(evidence["chainWalked"]).toBe(false);
    }
  });

  test("validates seal with custom valid ids", async () => {
    const check = createSealChainCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        seal: createTestSeal({
          sealId: "seal_beef1234cafefeed",
          chatId: "conv_aabbccddeeff0011",
          operatorId: "op_cafebabefeedbabe",
          credentialId: "cred_deadbeeffeedbabe",
        }),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("skip");
      expect(result.value.reason).toContain("structurally valid");
      const evidence = result.value.evidence as Record<string, unknown>;
      expect(evidence["sealId"]).toBe("seal_beef1234cafefeed");
      expect(evidence["chainValid"]).toBe(true);
      expect(evidence["chainWalked"]).toBe(false);
    }
  });

  test("fails when sealId is empty", async () => {
    const check = createSealChainCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        seal: createTestSeal({
          sealId: "",
        }),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("sealId");
    }
  });

  test("fails when chatId is empty", async () => {
    const check = createSealChainCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        seal: createTestSeal({ chatId: "" }),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("chatId");
    }
  });

  test("fails when operatorId is empty", async () => {
    const check = createSealChainCheck();
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

  test("fails when credentialId is empty", async () => {
    const check = createSealChainCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        seal: createTestSeal({ credentialId: "" }),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("credentialId");
    }
  });
});
