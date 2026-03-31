import { describe, expect, test } from "bun:test";
import { createSealChainCheck } from "../checks/seal-chain.js";
import {
  createTestSealEnvelope,
  createTestVerificationRequest,
  createTestSeal,
} from "./fixtures.js";

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

  test("skips when only payload structure is available", async () => {
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

  test("passes when the local seal envelope chain is structurally valid", async () => {
    const check = createSealChainCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        sealEnvelope: createTestSealEnvelope(),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("pass");
      const evidence = result.value.evidence as Record<string, unknown>;
      expect(evidence["chainValid"]).toBe(true);
    }
  });

  test("fails when the envelope delta does not match the inline previous seal", async () => {
    const previous = createTestSeal({
      sealId: "seal_11111111feedbabe",
      issuedAt: "2025-01-14T00:00:00.000Z",
    });
    const current = createTestSeal({
      sealId: "seal_22222222feedbabe",
      issuedAt: "2025-01-15T00:00:00.000Z",
      permissions: {
        allow: ["send", "reply", "react"],
        deny: [],
      },
    });

    const check = createSealChainCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        seal: current,
        sealEnvelope: createTestSealEnvelope({
          chain: {
            current,
            previous,
            delta: { added: [], removed: [], changed: [] },
          },
        }),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("Delta mismatch");
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
