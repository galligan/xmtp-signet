import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Result } from "better-result";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createKeyManager, type KeyManager } from "../key-manager.js";
import { createSealStamper } from "../seal-stamper.js";
import type { SealStamper } from "@xmtp/signet-contracts";
import type { Seal } from "@xmtp/signet-schemas";

function makeTestSeal(): Seal {
  return {
    version: "0.1.0",
    sealId: "att_test_123",
    agentAddress: "0xabc",
    sessionId: "ses_test",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    inference: {
      mode: "client-side",
      provider: null,
      model: null,
    },
    contentEgress: {
      scope: "none",
      destinations: [],
    },
    retentionAtProvider: "none",
    hostingMode: "self-hosted",
    trustTier: "unverified",
    buildProvenanceRef: null,
    revocationRules: {
      autoRevokeOnSessionEnd: true,
      humanRevocable: true,
      policyChangeRevokes: true,
    },
    extensions: null,
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
      expect(signed.seal).toEqual(seal);
      expect(signed.signature).toBeDefined();
      expect(signed.signature.length).toBeGreaterThan(0);
      expect(signed.signatureAlgorithm).toBe("Ed25519");
      expect(signed.signerKeyRef).toBeDefined();
    });
  });

  describe("signRevocation", () => {
    test("signs a revocation seal", async () => {
      const revocation = {
        sealId: "rev_test_456",
        previousSealId: "att_test_123",
        agentInboxId: "0xabc",
        groupId: "group-1",
        reason: "owner-initiated" as const,
        revokedAt: new Date().toISOString(),
        issuer: "signet",
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
