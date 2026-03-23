import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Result } from "better-result";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createResourceId } from "@xmtp/signet-schemas";
import { createKeyManager, type KeyManager } from "../key-manager.js";
import { createSealStamper } from "../seal-stamper.js";
import type { SealStamper } from "@xmtp/signet-contracts";
import type { RevocationSeal, SealPayloadType } from "@xmtp/signet-schemas";

function makeTestSeal(): SealPayloadType {
  return {
    sealId: "seal_12345678",
    credentialId: "cred_12345678",
    operatorId: "op_12345678",
    chatId: "conv_12345678",
    scopeMode: "per-chat",
    permissions: {
      allow: ["send", "reply"],
      deny: [],
    },
    issuedAt: new Date().toISOString(),
  };
}

describe("SealStamper", () => {
  let dataDir: string;
  let manager: KeyManager;
  let signer: SealStamper;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "as-test-"));
    const result = await createKeyManager({ dataDir });
    if (Result.isError(result)) throw new Error("setup failed");
    manager = result.value;
    await manager.createOperationalKey("agent-1", null);
    signer = createSealStamper(manager, "agent-1");
  });

  afterEach(() => {
    manager.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe("sign", () => {
    test("signs a seal and returns a sealed envelope", async () => {
      const seal = makeTestSeal();
      const result = await signer.sign(seal);
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("sign failed");

      const signed = result.value;
      const opKey = manager.getOperationalKey("agent-1");
      if (Result.isError(opKey)) throw new Error("missing operational key");
      expect(signed.chain.current).toEqual(seal);
      expect(signed.chain.previous).toBeUndefined();
      expect(signed.chain.delta).toEqual({
        added: [],
        removed: [],
        changed: [],
      });
      expect(signed.signature).toBeDefined();
      expect(signed.signature.length).toBeGreaterThan(0);
      expect(signed.algorithm).toBe("Ed25519");
      expect(signed.keyId).toBe(opKey.value.keyId);
    });
  });

  describe("signRevocation", () => {
    test("signs a revocation seal", async () => {
      const revocation: RevocationSeal = {
        sealId: createResourceId("seal"),
        previousSealId: "seal_12345678",
        operatorId: "op_12345678",
        credentialId: "cred_12345678",
        chatId: "conv_12345678",
        reason: "owner-initiated" as const,
        revokedAt: new Date().toISOString(),
        issuer: "signet-1",
      };
      const result = await signer.signRevocation(revocation);
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("sign failed");

      const signed = result.value;
      expect(signed.revocation).toEqual(revocation);
      expect(signed.signature).toBeDefined();
      expect(signed.signatureAlgorithm).toBe("Ed25519");
    });
  });
});
