import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import type { SealPayloadType, SignetError } from "@xmtp/signet-schemas";
import { InternalError } from "@xmtp/signet-schemas";
import { createSealManager } from "../manager.js";
import type { SealInput } from "../build.js";
import {
  validInput,
  createTestSigner,
  createTestPublisher,
  createTestInputResolver,
} from "./fixtures.js";

function createTestManager(inputOverrides?: Map<string, SealInput>) {
  const signer = createTestSigner();
  const publisher = createTestPublisher();
  const resolveInput = createTestInputResolver(inputOverrides);
  const manager = createSealManager({
    signer,
    publisher,
    resolveInput,
  });
  return { manager, signer, publisher };
}

describe("SealManager", () => {
  describe("issue", () => {
    test("creates and publishes a seal for a new credential+chat", async () => {
      const { manager, publisher } = createTestManager();
      const result = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(result)).toBe(true);
      expect(publisher.published.length).toBe(1);
    });

    test("returns the signed seal envelope on success", async () => {
      const { manager } = createTestManager();
      const result = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) return;
      expect(result.value.chain.current.sealId).toMatch(/^seal_[0-9a-f]{16}$/);
      expect(result.value.signature).toBeTruthy();
      expect(result.value.algorithm).toBe("Ed25519");
    });

    test("preserves the bypassed marker on the issued seal payload", async () => {
      const overrides = new Map<string, SealInput>();
      overrides.set(
        "cred_abcd1234feedbabe:conv_abcd1234feedbabe",
        validInput({ bypassed: true }),
      );

      const { manager } = createTestManager(overrides);
      const result = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );

      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) return;
      expect(result.value.chain.current.bypassed).toBe(true);
    });

    test("first seal has no previous payload", async () => {
      const { manager } = createTestManager();
      const result = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) return;
      expect(result.value.chain.previous).toBeUndefined();
    });

    test("second seal chains when input has material changes", async () => {
      const overrides = new Map<string, SealInput>();
      overrides.set(
        "cred_abcd1234feedbabe:conv_abcd1234feedbabe",
        validInput(),
      );

      const { manager } = createTestManager(overrides);
      const first = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(first)).toBe(true);
      if (Result.isError(first)) return;

      // Material change: permissions
      overrides.set(
        "cred_abcd1234feedbabe:conv_abcd1234feedbabe",
        validInput({
          permissions: {
            allow: ["send", "reply", "react"],
            deny: [],
          },
        }),
      );

      const second = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(second)).toBe(true);
      if (Result.isError(second)) return;
      expect(second.value.chain.previous).toBeDefined();
      expect(second.value.chain.previous?.sealId).toBe(
        first.value.chain.current.sealId,
      );
    });

    test("tracks current seal per credential+chat", async () => {
      const { manager } = createTestManager();
      await manager.issue("cred_abcd1234feedbabe", "conv_abcd1234feedbabe");
      const current = await manager.current(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(current)).toBe(true);
      if (Result.isError(current)) return;
      expect(current.value).not.toBeNull();
      expect(current.value?.chain.current.sealId).toMatch(
        /^seal_[0-9a-f]{16}$/,
      );
    });

    test("keeps separate current seals for different credentials on the same operator+chat", async () => {
      const overrides = new Map<string, SealInput>();
      overrides.set(
        "cred_abcd1234feedbabe:conv_abcd1234feedbabe",
        validInput({ operatorId: "op_a11ce001feedbabe" }),
      );
      overrides.set(
        "cred_dcba4321feedbabe:conv_abcd1234feedbabe",
        validInput({
          operatorId: "op_a11ce001feedbabe",
          permissions: {
            allow: ["send", "react"],
            deny: [],
          },
        }),
      );

      const { manager } = createTestManager(overrides);
      const first = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      const second = await manager.issue(
        "cred_dcba4321feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(first)).toBe(true);
      expect(Result.isOk(second)).toBe(true);
      if (Result.isError(first) || Result.isError(second)) return;

      const currentA = await manager.current(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      const currentB = await manager.current(
        "cred_dcba4321feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(currentA)).toBe(true);
      expect(Result.isOk(currentB)).toBe(true);
      if (Result.isError(currentA) || Result.isError(currentB)) return;

      expect(currentA.value?.chain.current.credentialId).toBe(
        "cred_abcd1234feedbabe",
      );
      expect(currentB.value?.chain.current.credentialId).toBe(
        "cred_dcba4321feedbabe",
      );
      expect(currentA.value?.chain.current.sealId).not.toBe(
        currentB.value?.chain.current.sealId,
      );
    });

    test("different chats have independent chains", async () => {
      const { manager } = createTestManager();
      const g1 = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      const g2 = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_efab5678feedbabe",
      );
      expect(Result.isOk(g1)).toBe(true);
      expect(Result.isOk(g2)).toBe(true);
      if (Result.isError(g1) || Result.isError(g2)) return;
      // Both are first in their chain
      expect(g1.value.chain.previous).toBeUndefined();
      expect(g2.value.chain.previous).toBeUndefined();
    });

    test("rejects issue for revoked operator+chat", async () => {
      const { manager } = createTestManager();
      const issued = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(issued)).toBe(true);
      if (Result.isError(issued)) return;

      await manager.revoke(
        issued.value.chain.current.sealId,
        "owner-initiated",
      );

      const result = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) return;
      expect(result.error._tag).toBe("SealError");
    });
  });

  describe("inspection", () => {
    test("lists active current seals and supports filtering", async () => {
      const overrides = new Map<string, SealInput>();
      overrides.set(
        "cred_abcd1234feedbabe:conv_abcd1234feedbabe",
        validInput(),
      );
      overrides.set(
        "cred_dcba4321feedbabe:conv_feedfacefeedbabe",
        validInput({
          operatorId: "op_dcba4321feedbabe",
        }),
      );

      const { manager } = createTestManager(overrides);
      await manager.issue("cred_abcd1234feedbabe", "conv_abcd1234feedbabe");
      await manager.issue("cred_dcba4321feedbabe", "conv_feedfacefeedbabe");

      const all = await manager.list();
      expect(Result.isOk(all)).toBe(true);
      if (Result.isError(all)) return;
      expect(all.value).toHaveLength(2);

      const byCredential = await manager.list({
        credentialId: "cred_abcd1234feedbabe",
      });
      expect(Result.isOk(byCredential)).toBe(true);
      if (Result.isError(byCredential)) return;
      expect(byCredential.value).toHaveLength(1);
      expect(byCredential.value[0]?.chain.current.chatId).toBe(
        "conv_abcd1234feedbabe",
      );

      const byChat = await manager.list({ chatId: "conv_feedfacefeedbabe" });
      expect(Result.isOk(byChat)).toBe(true);
      if (Result.isError(byChat)) return;
      expect(byChat.value).toHaveLength(1);
      expect(byChat.value[0]?.chain.current.credentialId).toBe(
        "cred_dcba4321feedbabe",
      );
    });

    test("looks up a seal by ID", async () => {
      const { manager } = createTestManager();
      const issued = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(issued)).toBe(true);
      if (Result.isError(issued)) return;

      const lookedUp = await manager.lookup(issued.value.chain.current.sealId);
      expect(Result.isOk(lookedUp)).toBe(true);
      if (Result.isError(lookedUp)) return;
      expect(lookedUp.value.chain.current.sealId).toBe(
        issued.value.chain.current.sealId,
      );
    });

    test("returns chain history newest-first", async () => {
      const overrides = new Map<string, SealInput>();
      overrides.set(
        "cred_abcd1234feedbabe:conv_abcd1234feedbabe",
        validInput(),
      );

      const { manager } = createTestManager(overrides);
      const first = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(first)).toBe(true);
      if (Result.isError(first)) return;

      overrides.set(
        "cred_abcd1234feedbabe:conv_abcd1234feedbabe",
        validInput({
          permissions: {
            allow: ["send", "reply", "react"],
            deny: [],
          },
        }),
      );

      const second = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(second)).toBe(true);
      if (Result.isError(second)) return;

      const history = await manager.history(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(history)).toBe(true);
      if (Result.isError(history)) return;
      expect(history.value).toHaveLength(2);
      expect(history.value[0]?.chain.current.sealId).toBe(
        second.value.chain.current.sealId,
      );
      expect(history.value[1]?.chain.current.sealId).toBe(
        first.value.chain.current.sealId,
      );
    });
  });

  describe("materiality", () => {
    test("returns existing seal when input has no material changes", async () => {
      const { manager, publisher } = createTestManager();
      const first = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(first)).toBe(true);
      if (Result.isError(first)) return;

      // Same input again -- no material change
      const second = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(second)).toBe(true);
      if (Result.isError(second)) return;

      // Should return the same seal without publishing a new one
      expect(second.value.chain.current.sealId).toBe(
        first.value.chain.current.sealId,
      );
      expect(publisher.published.length).toBe(1);
    });

    test("creates new seal when permissions change", async () => {
      const overrides = new Map<string, SealInput>();
      overrides.set(
        "cred_abcd1234feedbabe:conv_abcd1234feedbabe",
        validInput(),
      );

      const { manager, publisher } = createTestManager(overrides);
      const first = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(first)).toBe(true);

      // Material change: permissions
      overrides.set(
        "cred_abcd1234feedbabe:conv_abcd1234feedbabe",
        validInput({
          permissions: {
            allow: ["send", "reply", "react"],
            deny: [],
          },
        }),
      );

      const second = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(second)).toBe(true);
      if (Result.isError(second) || Result.isError(first)) return;
      expect(second.value.chain.current.sealId).not.toBe(
        first.value.chain.current.sealId,
      );
      expect(publisher.published.length).toBe(2);
    });

    test("creates new seal when scopeMode changes", async () => {
      const overrides = new Map<string, SealInput>();
      overrides.set(
        "cred_abcd1234feedbabe:conv_abcd1234feedbabe",
        validInput(),
      );

      const { manager, publisher } = createTestManager(overrides);
      await manager.issue("cred_abcd1234feedbabe", "conv_abcd1234feedbabe");

      overrides.set(
        "cred_abcd1234feedbabe:conv_abcd1234feedbabe",
        validInput({ scopeMode: "shared" }),
      );

      const second = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(second)).toBe(true);
      expect(publisher.published.length).toBe(2);
    });

    test("creates new seal when operator disclosures change", async () => {
      const overrides = new Map<string, SealInput>();
      overrides.set(
        "cred_abcd1234feedbabe:conv_abcd1234feedbabe",
        validInput({
          operatorDisclosures: {
            inferenceMode: "cloud",
            inferenceProviders: ["openai"],
            contentEgressScope: "provider-only",
            hostingMode: "cloud",
          },
        }),
      );

      const { manager, publisher } = createTestManager(overrides);
      const first = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(first)).toBe(true);

      overrides.set(
        "cred_abcd1234feedbabe:conv_abcd1234feedbabe",
        validInput({
          operatorDisclosures: {
            inferenceMode: "local",
            contentEgressScope: "none",
            hostingMode: "self-hosted",
          },
        }),
      );

      const second = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(second)).toBe(true);
      if (Result.isError(first) || Result.isError(second)) return;
      expect(second.value.chain.current.sealId).not.toBe(
        first.value.chain.current.sealId,
      );
      expect(publisher.published.length).toBe(2);
    });

    test("creates new seal when provenance map changes", async () => {
      const overrides = new Map<string, SealInput>();
      overrides.set(
        "cred_abcd1234feedbabe:conv_abcd1234feedbabe",
        validInput({
          trustTier: "source-verified",
          operatorDisclosures: {
            inferenceMode: "cloud",
          },
          provenanceMap: {
            inferenceMode: { source: "declared" },
          },
        }),
      );

      const { manager, publisher } = createTestManager(overrides);
      const first = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(first)).toBe(true);

      overrides.set(
        "cred_abcd1234feedbabe:conv_abcd1234feedbabe",
        validInput({
          trustTier: "source-verified",
          operatorDisclosures: {
            inferenceMode: "cloud",
          },
          provenanceMap: {
            inferenceMode: {
              source: "observed",
              attestedBy: "inspector_a1b2c3d4e5f67890",
              attestedAt: "2026-03-27T00:00:00Z",
            },
          },
        }),
      );

      const second = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(second)).toBe(true);
      if (Result.isError(first) || Result.isError(second)) return;
      expect(second.value.chain.current.sealId).not.toBe(
        first.value.chain.current.sealId,
      );
      expect(publisher.published.length).toBe(2);
    });

    test("creates new seal when trust tier changes", async () => {
      const overrides = new Map<string, SealInput>();
      overrides.set(
        "cred_abcd1234feedbabe:conv_abcd1234feedbabe",
        validInput({
          trustTier: "source-verified",
          provenanceMap: {
            trustTier: {
              source: "verified",
              attestedBy: "verifier_a1b2c3d4e5f67890",
              attestedAt: "2026-03-27T00:00:00Z",
            },
          },
        }),
      );

      const { manager, publisher } = createTestManager(overrides);
      const first = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(first)).toBe(true);

      overrides.set(
        "cred_abcd1234feedbabe:conv_abcd1234feedbabe",
        validInput({
          trustTier: "runtime-attested",
          provenanceMap: {
            trustTier: {
              source: "verified",
              attestedBy: "verifier_a1b2c3d4e5f67890",
              attestedAt: "2026-03-27T01:00:00Z",
            },
          },
        }),
      );

      const second = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(second)).toBe(true);
      if (Result.isError(first) || Result.isError(second)) return;
      expect(second.value.chain.current.sealId).not.toBe(
        first.value.chain.current.sealId,
      );
      expect(publisher.published.length).toBe(2);
    });

    test("always creates first seal even with no previous", async () => {
      const { manager, publisher } = createTestManager();
      const result = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(result)).toBe(true);
      expect(publisher.published.length).toBe(1);
    });
  });

  describe("refresh", () => {
    test("renews a seal with same fields and new timestamps", async () => {
      const { manager } = createTestManager();
      const issued = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(issued)).toBe(true);
      if (Result.isError(issued)) return;

      const refreshed = await manager.refresh(
        issued.value.chain.current.sealId,
      );
      expect(Result.isOk(refreshed)).toBe(true);
      if (Result.isError(refreshed)) return;

      // New ID, chains to previous
      expect(refreshed.value.chain.current.sealId).not.toBe(
        issued.value.chain.current.sealId,
      );
      expect(refreshed.value.chain.previous?.sealId).toBe(
        issued.value.chain.current.sealId,
      );

      // Same material fields
      expect(refreshed.value.chain.current.permissions).toEqual(
        issued.value.chain.current.permissions,
      );
    });

    test("returns error for unknown seal ID", async () => {
      const { manager } = createTestManager();
      const result = await manager.refresh("seal_unknown1");
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) return;
      expect(result.error._tag).toBe("SealError");
    });

    test("refresh is rejected after revoke", async () => {
      const { manager, publisher } = createTestManager();

      const issued = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(issued)).toBe(true);
      if (Result.isError(issued)) return;
      const sealId = issued.value.chain.current.sealId;

      const revoked = await manager.revoke(sealId, "owner-initiated");
      expect(Result.isOk(revoked)).toBe(true);
      const publishCountAfterRevoke = publisher.published.length;

      const refreshed = await manager.refresh(sealId);
      expect(Result.isError(refreshed)).toBe(true);
      if (Result.isOk(refreshed)) return;
      expect(refreshed.error._tag).toBe("SealError");

      expect(publisher.published.length).toBe(publishCountAfterRevoke);
    });

    test("refresh rejects historical seals once a newer head exists", async () => {
      const overrides = new Map<string, SealInput>();
      overrides.set(
        "cred_abcd1234feedbabe:conv_abcd1234feedbabe",
        validInput(),
      );

      const { manager, publisher } = createTestManager(overrides);
      const first = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(first)).toBe(true);
      if (Result.isError(first)) return;

      overrides.set(
        "cred_abcd1234feedbabe:conv_abcd1234feedbabe",
        validInput({
          permissions: {
            allow: ["send", "reply", "react"],
            deny: [],
          },
        }),
      );

      const second = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(second)).toBe(true);
      if (Result.isError(second)) return;

      const refreshed = await manager.refresh(first.value.chain.current.sealId);
      expect(Result.isError(refreshed)).toBe(true);
      expect(publisher.published.length).toBe(2);

      const current = await manager.current(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(current)).toBe(true);
      if (Result.isError(current)) return;
      expect(current.value?.chain.current.sealId).toBe(
        second.value.chain.current.sealId,
      );
    });
  });

  describe("revoke", () => {
    test("publishes a revocation to the chat", async () => {
      const { manager, publisher } = createTestManager();
      const issued = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(issued)).toBe(true);
      if (Result.isError(issued)) return;

      const result = await manager.revoke(
        issued.value.chain.current.sealId,
        "owner-initiated",
      );
      expect(Result.isOk(result)).toBe(true);
      expect(publisher.publishedRevocations.length).toBe(1);
    });

    test("marks credential+chat as revoked (terminal)", async () => {
      const { manager } = createTestManager();
      const issued = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(issued)).toBe(true);
      if (Result.isError(issued)) return;

      await manager.revoke(
        issued.value.chain.current.sealId,
        "owner-initiated",
      );

      const current = await manager.current(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(current)).toBe(true);
      if (Result.isError(current)) return;
      expect(current.value).toBeNull();
    });

    test("returns error for unknown seal ID", async () => {
      const { manager } = createTestManager();
      const result = await manager.revoke("seal_unknown1", "owner-initiated");
      expect(Result.isError(result)).toBe(true);
    });

    test("returns error for already-revoked seal", async () => {
      const { manager } = createTestManager();
      const issued = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(issued)).toBe(true);
      if (Result.isError(issued)) return;

      await manager.revoke(
        issued.value.chain.current.sealId,
        "owner-initiated",
      );
      const result = await manager.revoke(
        issued.value.chain.current.sealId,
        "owner-initiated",
      );
      expect(Result.isError(result)).toBe(true);
    });

    test("validates revocation against schema", async () => {
      const { manager, publisher } = createTestManager();
      const issued = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(issued)).toBe(true);
      if (Result.isError(issued)) return;

      const result = await manager.revoke(
        issued.value.chain.current.sealId,
        "owner-initiated",
      );
      expect(Result.isOk(result)).toBe(true);

      const revocation = publisher.publishedRevocations[0];
      expect(revocation).toBeDefined();
      expect(revocation?.revocation.reason).toBe("owner-initiated");
      expect(revocation?.revocation.previousSealId).toBe(
        issued.value.chain.current.sealId,
      );
    });
  });

  describe("current", () => {
    test("returns null for unknown credential+chat", async () => {
      const { manager } = createTestManager();
      const result = await manager.current("cred_unknown1", "conv_unknown1");
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) return;
      expect(result.value).toBeNull();
    });

    test("returns latest seal for known credential+chat", async () => {
      const overrides = new Map<string, SealInput>();
      overrides.set(
        "cred_abcd1234feedbabe:conv_abcd1234feedbabe",
        validInput(),
      );

      const { manager } = createTestManager(overrides);
      await manager.issue("cred_abcd1234feedbabe", "conv_abcd1234feedbabe");

      // Material change so we get a new seal
      overrides.set(
        "cred_abcd1234feedbabe:conv_abcd1234feedbabe",
        validInput({
          permissions: {
            allow: ["send", "reply", "react"],
            deny: [],
          },
        }),
      );
      const second = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(second)).toBe(true);
      if (Result.isError(second)) return;

      const current = await manager.current(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isOk(current)).toBe(true);
      if (Result.isError(current)) return;
      expect(current.value?.chain.current.sealId).toBe(
        second.value.chain.current.sealId,
      );
    });
  });

  describe("renewal", () => {
    test("needsRenewal returns true when past 75% of default TTL", () => {
      const { manager } = createTestManager();
      // Default TTL = 24h, 75% = 18h. Create a payload issued 19h ago.
      const now = Date.now();
      const issuedAt = new Date(now - 19 * 60 * 60 * 1000).toISOString();
      const payload = {
        sealId: "seal_test0001",
        credentialId: "cred_abcd1234feedbabe",
        operatorId: "op_abcd1234feedbabe",
        chatId: "conv_abcd1234feedbabe",
        scopeMode: "per-chat" as const,
        permissions: { allow: [], deny: [] },
        issuedAt,
      } satisfies SealPayloadType;
      expect(manager.needsRenewal(payload)).toBe(true);
    });

    test("needsRenewal returns false when before 75% of default TTL", () => {
      const { manager } = createTestManager();
      const now = Date.now();
      const issuedAt = new Date(now - 1 * 60 * 60 * 1000).toISOString();
      const payload = {
        sealId: "seal_test0001",
        credentialId: "cred_abcd1234feedbabe",
        operatorId: "op_abcd1234feedbabe",
        chatId: "conv_abcd1234feedbabe",
        scopeMode: "per-chat" as const,
        permissions: { allow: [], deny: [] },
        issuedAt,
      } satisfies SealPayloadType;
      expect(manager.needsRenewal(payload)).toBe(false);
    });
  });

  describe("signer failure", () => {
    test("propagates signer errors", async () => {
      const publisher = createTestPublisher();
      const failingSigner = {
        async sign(): Promise<Result<never, SignetError>> {
          return Result.err(InternalError.create("Key unavailable"));
        },
        async signRevocation(): Promise<Result<never, SignetError>> {
          return Result.err(InternalError.create("Key unavailable"));
        },
      };
      const resolveInput = createTestInputResolver();
      const manager = createSealManager({
        signer: failingSigner,
        publisher,
        resolveInput,
      });
      const result = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) return;
      expect(result.error._tag).toBe("InternalError");
    });
  });

  describe("publisher failure", () => {
    test("propagates publisher errors", async () => {
      const signer = createTestSigner();
      const failingPublisher = {
        async publish(): Promise<Result<never, SignetError>> {
          return Result.err(InternalError.create("XMTP send failed"));
        },
        async publishRevocation(): Promise<Result<never, SignetError>> {
          return Result.err(InternalError.create("XMTP send failed"));
        },
      };
      const resolveInput = createTestInputResolver();
      const manager = createSealManager({
        signer,
        publisher: failingPublisher,
        resolveInput,
      });
      const result = await manager.issue(
        "cred_abcd1234feedbabe",
        "conv_abcd1234feedbabe",
      );
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) return;
      expect(result.error._tag).toBe("InternalError");
    });
  });
});
