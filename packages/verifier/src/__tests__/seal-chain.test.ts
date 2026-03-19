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
    const result = await check.execute(
      createTestVerificationRequest({
        seal: createTestSeal({
          previousSealId: null,
        }),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("skip");
      expect(result.value.reason).toContain("Initial seal");
      const evidence = result.value.evidence as Record<string, unknown>;
      expect(evidence["isInitial"]).toBe(true);
      expect(evidence["chainWalked"]).toBe(false);
    }
  });

  test("validates seal with valid previous ID", async () => {
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
      expect(result.value.verdict).toBe("skip");
      expect(result.value.reason).toContain("structurally valid");
      const evidence = result.value.evidence as Record<string, unknown>;
      expect(evidence["previousSealId"]).toBe("att-001");
      expect(evidence["chainWalked"]).toBe(false);
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

  test("fails when groupId is empty", async () => {
    const check = createSealChainCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        seal: createTestSeal({ groupId: "" }),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("groupId");
    }
  });

  test("fails when agentInboxId is empty", async () => {
    const check = createSealChainCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        seal: createTestSeal({ agentInboxId: "" }),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("agentInboxId");
    }
  });
});
