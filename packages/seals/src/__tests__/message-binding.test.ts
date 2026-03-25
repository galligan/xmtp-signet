import { describe, test, expect } from "bun:test";
import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import { InternalError } from "@xmtp/signet-schemas";
import {
  createMessageBinding,
  verifyMessageBinding,
  type BindingSigner,
} from "../message-binding.js";

/**
 * Creates a Web Crypto Ed25519 key pair and returns BindingSigner + verifier
 * callbacks suitable for testing createMessageBinding / verifyMessageBinding.
 */
async function createTestKeys(): Promise<{
  sign: BindingSigner;
  verify: (
    data: Uint8Array,
    signature: Uint8Array,
  ) => Promise<Result<boolean, SignetError>>;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}> {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]);

  const sign: BindingSigner = async (data) => {
    try {
      const sig = await crypto.subtle.sign(
        { name: "Ed25519" },
        keyPair.privateKey,
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      );
      return Result.ok(new Uint8Array(sig));
    } catch (e) {
      return Result.err(
        InternalError.create("signing failed", { cause: String(e) }),
      );
    }
  };

  const verify = async (
    data: Uint8Array,
    signature: Uint8Array,
  ): Promise<Result<boolean, SignetError>> => {
    try {
      const valid = await crypto.subtle.verify(
        { name: "Ed25519" },
        keyPair.publicKey,
        signature.buffer.slice(
          signature.byteOffset,
          signature.byteOffset + signature.byteLength,
        ),
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      );
      return Result.ok(valid);
    } catch (e) {
      return Result.err(
        InternalError.create("verification failed", { cause: String(e) }),
      );
    }
  };

  return {
    sign,
    verify,
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
  };
}

describe("createMessageBinding", () => {
  test("returns binding with correct sealRef and base64 signature", async () => {
    const keys = await createTestKeys();
    const result = await createMessageBinding(
      "msg_001",
      "seal_0000000000000001",
      keys.sign,
    );

    expect(Result.isOk(result)).toBe(true);
    if (!Result.isOk(result)) return;

    expect(result.value.sealRef).toBe("seal_0000000000000001");
    // Signature should be valid base64
    expect(result.value.sealSignature.length).toBeGreaterThan(0);
    expect(() => atob(result.value.sealSignature)).not.toThrow();
  });

  test("returns error when signer fails", async () => {
    const failingSigner: BindingSigner = async () => {
      return Result.err(InternalError.create("key unavailable"));
    };

    const result = await createMessageBinding(
      "msg_001",
      "seal_0000000000000001",
      failingSigner,
    );

    expect(Result.isError(result)).toBe(true);
    if (!Result.isError(result)) return;
    expect(result.error._tag).toBe("InternalError");
  });
});

describe("verifyMessageBinding", () => {
  test("returns true for a valid binding", async () => {
    const keys = await createTestKeys();
    const bindResult = await createMessageBinding(
      "msg_001",
      "seal_0000000000000001",
      keys.sign,
    );
    expect(Result.isOk(bindResult)).toBe(true);
    if (!Result.isOk(bindResult)) return;

    const verifyResult = await verifyMessageBinding(
      bindResult.value,
      "msg_001",
      keys.verify,
    );

    expect(Result.isOk(verifyResult)).toBe(true);
    if (!Result.isOk(verifyResult)) return;
    expect(verifyResult.value).toBe(true);
  });

  test("returns false for wrong public key", async () => {
    const signerKeys = await createTestKeys();
    const wrongKeys = await createTestKeys();

    const bindResult = await createMessageBinding(
      "msg_001",
      "seal_0000000000000001",
      signerKeys.sign,
    );
    expect(Result.isOk(bindResult)).toBe(true);
    if (!Result.isOk(bindResult)) return;

    const verifyResult = await verifyMessageBinding(
      bindResult.value,
      "msg_001",
      wrongKeys.verify,
    );

    expect(Result.isOk(verifyResult)).toBe(true);
    if (!Result.isOk(verifyResult)) return;
    expect(verifyResult.value).toBe(false);
  });

  test("returns false for wrong messageId", async () => {
    const keys = await createTestKeys();

    const bindResult = await createMessageBinding(
      "msg_001",
      "seal_0000000000000001",
      keys.sign,
    );
    expect(Result.isOk(bindResult)).toBe(true);
    if (!Result.isOk(bindResult)) return;

    const verifyResult = await verifyMessageBinding(
      bindResult.value,
      "msg_WRONG",
      keys.verify,
    );

    expect(Result.isOk(verifyResult)).toBe(true);
    if (!Result.isOk(verifyResult)) return;
    expect(verifyResult.value).toBe(false);
  });

  test("round-trip: create then verify succeeds", async () => {
    const keys = await createTestKeys();
    const messageId = "msg_roundtrip_42";
    const sealId = "seal_00000099feedbabe";

    const bindResult = await createMessageBinding(messageId, sealId, keys.sign);
    expect(Result.isOk(bindResult)).toBe(true);
    if (!Result.isOk(bindResult)) return;

    // Verify the binding
    const verifyResult = await verifyMessageBinding(
      bindResult.value,
      messageId,
      keys.verify,
    );
    expect(Result.isOk(verifyResult)).toBe(true);
    if (!Result.isOk(verifyResult)) return;
    expect(verifyResult.value).toBe(true);

    // Same binding, wrong message should fail
    const wrongResult = await verifyMessageBinding(
      bindResult.value,
      "msg_different",
      keys.verify,
    );
    expect(Result.isOk(wrongResult)).toBe(true);
    if (!Result.isOk(wrongResult)) return;
    expect(wrongResult.value).toBe(false);
  });

  test("returns an InternalError for malformed base64 signatures", async () => {
    const keys = await createTestKeys();

    const verifyResult = await verifyMessageBinding(
      {
        sealRef: "seal_0000000000000001",
        sealSignature: "%%%not-base64%%%",
      },
      "msg_001",
      keys.verify,
    );

    expect(Result.isError(verifyResult)).toBe(true);
    if (!Result.isError(verifyResult)) return;
    expect(verifyResult.error._tag).toBe("InternalError");
  });
});
