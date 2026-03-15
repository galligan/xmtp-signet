import { describe, expect, test } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createXmtpSigner } from "../sdk/signer-adapter.js";

describe("createXmtpSigner", () => {
  const testPrivateKey = generatePrivateKey();

  test("returns an EOA signer", () => {
    const signer = createXmtpSigner({ privateKey: testPrivateKey });
    expect(signer.type).toBe("EOA");
  });

  test("getIdentifier returns lowercased Ethereum address", () => {
    const signer = createXmtpSigner({ privateKey: testPrivateKey });
    const account = privateKeyToAccount(testPrivateKey);

    const id = signer.getIdentifier();
    expect(id.identifier).toBe(account.address.toLowerCase());
    expect(id.identifierKind).toBe("Ethereum");
  });

  test("getIdentifier is synchronous", () => {
    const signer = createXmtpSigner({ privateKey: testPrivateKey });
    // SDK allows sync or async; we return sync since viem is sync
    const result = signer.getIdentifier();
    // Should not be a Promise
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toHaveProperty("identifier");
    expect(result).toHaveProperty("identifierKind");
  });

  test("signMessage produces a 65-byte ECDSA signature", async () => {
    const signer = createXmtpSigner({ privateKey: testPrivateKey });
    const sig = await signer.signMessage("test message for signing");
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig.length).toBe(65);
  });

  test("signMessage produces EIP-191 compatible signature", async () => {
    const signer = createXmtpSigner({ privateKey: testPrivateKey });
    const account = privateKeyToAccount(testPrivateKey);

    // Sign the same message with both approaches
    const sig = await signer.signMessage("hello xmtp");
    const viemSig = await account.signMessage({ message: "hello xmtp" });

    // Convert viem hex signature to bytes for comparison
    const { toBytes } = await import("viem");
    const viemSigBytes = toBytes(viemSig);
    expect(sig).toEqual(viemSigBytes);
  });

  test("deterministic signatures for same key and message", async () => {
    const signer = createXmtpSigner({ privateKey: testPrivateKey });
    const sig1 = await signer.signMessage("determinism check");
    const sig2 = await signer.signMessage("determinism check");
    expect(sig1).toEqual(sig2);
  });

  test("different messages produce different signatures", async () => {
    const signer = createXmtpSigner({ privateKey: testPrivateKey });
    const sig1 = await signer.signMessage("message one");
    const sig2 = await signer.signMessage("message two");
    expect(sig1).not.toEqual(sig2);
  });

  test("different keys produce different addresses", () => {
    const key1 = generatePrivateKey();
    const key2 = generatePrivateKey();
    const signer1 = createXmtpSigner({ privateKey: key1 });
    const signer2 = createXmtpSigner({ privateKey: key2 });

    const id1 = signer1.getIdentifier();
    const id2 = signer2.getIdentifier();
    expect(id1.identifier).not.toBe(id2.identifier);
  });
});
