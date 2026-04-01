import { describe, expect, test } from "bun:test";
import { createSealSignatureCheck } from "../checks/seal-signature.js";
import {
  createSignedTestSealEnvelope,
  createTestVerificationRequest,
  createTestSeal,
} from "./fixtures.js";

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

  test("skips when seal has valid structure but no local envelope is available", async () => {
    const check = createSealSignatureCheck();
    const result = await check.execute(createTestVerificationRequest());

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("skip");
    }
  });

  test("passes when a matching envelope and signer public key are provided", async () => {
    const check = createSealSignatureCheck();
    const signed = await createSignedTestSealEnvelope();
    const result = await check.execute(
      createTestVerificationRequest({
        seal: signed.envelope.chain.current,
        sealEnvelope: signed.envelope,
        sealPublicKey: signed.publicKeyHex,
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("pass");
      expect(result.value.reason).toContain("verified");
    }
  });

  test("fails when the envelope signature does not verify", async () => {
    const check = createSealSignatureCheck();
    const signed = await createSignedTestSealEnvelope();
    const result = await check.execute(
      createTestVerificationRequest({
        seal: signed.envelope.chain.current,
        sealEnvelope: {
          ...signed.envelope,
          signature: Buffer.from("tampered-signature").toString("base64"),
        },
        sealPublicKey: signed.publicKeyHex,
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("verification failed");
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
