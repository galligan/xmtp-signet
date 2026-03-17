import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import type { Seal, SignetError } from "@xmtp/signet-schemas";
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
    test("creates and publishes an seal for a new agent+group", async () => {
      const { manager, publisher } = createTestManager();
      const result = await manager.issue("session-1", "group-1");
      expect(Result.isOk(result)).toBe(true);
      expect(publisher.published.length).toBe(1);
    });

    test("returns the signed seal on success", async () => {
      const { manager } = createTestManager();
      const result = await manager.issue("session-1", "group-1");
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) return;
      expect(result.value.seal.sealId).toMatch(/^att_[0-9a-f]{32}$/);
      expect(result.value.signature).toBeTruthy();
      expect(result.value.signatureAlgorithm).toBe("Ed25519");
    });

    test("first seal has null previousSealId", async () => {
      const { manager } = createTestManager();
      const result = await manager.issue("session-1", "group-1");
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) return;
      expect(result.value.seal.previousSealId).toBeNull();
    });

    test("second seal chains when input has material changes", async () => {
      // First call uses default input, second uses different inferenceMode
      // but inferenceMode is NOT a material field, so we need a material change
      const overrides = new Map<string, SealInput>();
      overrides.set("session-1:group-1", validInput());

      const { manager } = createTestManager(overrides);
      const first = await manager.issue("session-1", "group-1");
      expect(Result.isOk(first)).toBe(true);
      if (Result.isError(first)) return;

      // Change to a material field (view mode)
      overrides.set(
        "session-1:group-1",
        validInput({
          view: {
            mode: "redacted",
            threadScopes: [{ groupId: "group-1", threadId: null }],
            contentTypes: ["xmtp.org/text:1.0"],
          },
        }),
      );

      const second = await manager.issue("session-1", "group-1");
      expect(Result.isOk(second)).toBe(true);
      if (Result.isError(second)) return;
      expect(second.value.seal.previousSealId).toBe(first.value.seal.sealId);
    });

    test("tracks current seal ID per agent+group", async () => {
      const { manager } = createTestManager();
      await manager.issue("session-1", "group-1");
      const current = await manager.current("agent-inbox-1", "group-1");
      expect(Result.isOk(current)).toBe(true);
      if (Result.isError(current)) return;
      expect(current.value).not.toBeNull();
      expect(current.value?.seal.sealId).toMatch(/^att_[0-9a-f]{32}$/);
    });

    test("different groups have independent chains", async () => {
      const { manager } = createTestManager();
      const g1 = await manager.issue("session-1", "group-1");
      const g2 = await manager.issue("session-2", "group-2");
      expect(Result.isOk(g1)).toBe(true);
      expect(Result.isOk(g2)).toBe(true);
      if (Result.isError(g1) || Result.isError(g2)) return;
      // Both are first in their chain
      expect(g1.value.seal.previousSealId).toBeNull();
      expect(g2.value.seal.previousSealId).toBeNull();
    });

    test("rejects issue for revoked agent+group", async () => {
      const { manager } = createTestManager();
      const issued = await manager.issue("session-1", "group-1");
      expect(Result.isOk(issued)).toBe(true);
      if (Result.isError(issued)) return;

      await manager.revoke(issued.value.seal.sealId, "owner-initiated");

      const result = await manager.issue("session-1", "group-1");
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) return;
      expect(result.error._tag).toBe("SealError");
    });
  });

  describe("materiality", () => {
    test("returns existing seal when input has no material changes", async () => {
      const { manager, publisher } = createTestManager();
      const first = await manager.issue("session-1", "group-1");
      expect(Result.isOk(first)).toBe(true);
      if (Result.isError(first)) return;

      // Same input again -- no material change
      const second = await manager.issue("session-1", "group-1");
      expect(Result.isOk(second)).toBe(true);
      if (Result.isError(second)) return;

      // Should return the same seal without publishing a new one
      expect(second.value.seal.sealId).toBe(first.value.seal.sealId);
      expect(publisher.published.length).toBe(1);
    });

    test("creates new seal when view mode changes", async () => {
      const overrides = new Map<string, SealInput>();
      overrides.set("session-1:group-1", validInput());

      const { manager, publisher } = createTestManager(overrides);
      const first = await manager.issue("session-1", "group-1");
      expect(Result.isOk(first)).toBe(true);

      // Material change: view mode
      overrides.set(
        "session-1:group-1",
        validInput({
          view: {
            mode: "redacted",
            threadScopes: [{ groupId: "group-1", threadId: null }],
            contentTypes: ["xmtp.org/text:1.0"],
          },
        }),
      );

      const second = await manager.issue("session-1", "group-1");
      expect(Result.isOk(second)).toBe(true);
      if (Result.isError(second) || Result.isError(first)) return;
      expect(second.value.seal.sealId).not.toBe(first.value.seal.sealId);
      expect(publisher.published.length).toBe(2);
    });

    test("creates new seal when grant changes", async () => {
      const overrides = new Map<string, SealInput>();
      overrides.set("session-1:group-1", validInput());

      const { manager, publisher } = createTestManager(overrides);
      await manager.issue("session-1", "group-1");

      // Material change: messaging grant
      overrides.set(
        "session-1:group-1",
        validInput({
          grant: {
            messaging: {
              send: true,
              reply: true,
              react: true, // changed
              draftOnly: false,
            },
            groupManagement: {
              addMembers: false,
              removeMembers: false,
              updateMetadata: false,
              inviteUsers: false,
            },
            tools: { scopes: [] },
            egress: {
              storeExcerpts: false,
              useForMemory: false,
              forwardToProviders: false,
              quoteRevealed: false,
              summarize: false,
            },
          },
        }),
      );

      const second = await manager.issue("session-1", "group-1");
      expect(Result.isOk(second)).toBe(true);
      expect(publisher.published.length).toBe(2);
    });

    test("creates new seal when content types change", async () => {
      const overrides = new Map<string, SealInput>();
      overrides.set("session-1:group-1", validInput());

      const { manager, publisher } = createTestManager(overrides);
      await manager.issue("session-1", "group-1");

      // Material change: content types
      overrides.set(
        "session-1:group-1",
        validInput({
          view: {
            mode: "full",
            threadScopes: [{ groupId: "group-1", threadId: null }],
            contentTypes: ["xmtp.org/text:1.0", "xmtp.org/reaction:1.0"],
          },
        }),
      );

      const second = await manager.issue("session-1", "group-1");
      expect(Result.isOk(second)).toBe(true);
      expect(publisher.published.length).toBe(2);
    });

    test("creates new seal when signed metadata changes", async () => {
      const overrides = new Map<string, SealInput>();
      overrides.set("session-1:group-1", validInput());

      const { manager, publisher } = createTestManager(overrides);
      const first = await manager.issue("session-1", "group-1");
      expect(Result.isOk(first)).toBe(true);
      if (Result.isError(first)) return;

      overrides.set(
        "session-1:group-1",
        validInput({ verifierStatementRef: "verifier-statement-002" }),
      );

      const second = await manager.issue("session-1", "group-1");
      expect(Result.isOk(second)).toBe(true);
      if (Result.isError(second)) return;
      expect(second.value.seal.sealId).not.toBe(first.value.seal.sealId);
      expect(publisher.published.length).toBe(2);
    });

    test("always creates first seal even with no previous", async () => {
      const { manager, publisher } = createTestManager();
      const result = await manager.issue("session-1", "group-1");
      expect(Result.isOk(result)).toBe(true);
      expect(publisher.published.length).toBe(1);
    });
  });

  describe("refresh", () => {
    test("renews an seal with same material fields and new timestamps", async () => {
      const { manager } = createTestManager();
      const issued = await manager.issue("session-1", "group-1");
      expect(Result.isOk(issued)).toBe(true);
      if (Result.isError(issued)) return;

      const refreshed = await manager.refresh(issued.value.seal.sealId);
      expect(Result.isOk(refreshed)).toBe(true);
      if (Result.isError(refreshed)) return;

      // New ID, chains to previous
      expect(refreshed.value.seal.sealId).not.toBe(issued.value.seal.sealId);
      expect(refreshed.value.seal.previousSealId).toBe(
        issued.value.seal.sealId,
      );

      // Same material fields
      expect(refreshed.value.seal.viewMode).toBe(issued.value.seal.viewMode);
      expect(refreshed.value.seal.grantedOps).toEqual(
        issued.value.seal.grantedOps,
      );
    });

    test("returns error for unknown seal ID", async () => {
      const { manager } = createTestManager();
      const result = await manager.refresh("att_unknown");
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) return;
      expect(result.error._tag).toBe("SealError");
    });

    test("refresh is rejected after revoke", async () => {
      const { manager, publisher } = createTestManager();

      // 1. Issue an seal
      const issued = await manager.issue("session-1", "group-1");
      expect(Result.isOk(issued)).toBe(true);
      if (Result.isError(issued)) return;
      const sealId = issued.value.seal.sealId;

      // 2. Revoke it
      const revoked = await manager.revoke(sealId, "owner-initiated");
      expect(Result.isOk(revoked)).toBe(true);
      const publishCountAfterRevoke = publisher.published.length;

      // 3. Attempt refresh -- should fail
      const refreshed = await manager.refresh(sealId);
      expect(Result.isError(refreshed)).toBe(true);
      if (Result.isOk(refreshed)) return;
      expect(refreshed.error._tag).toBe("SealError");

      // 4. Confirm no new publish occurred
      expect(publisher.published.length).toBe(publishCountAfterRevoke);
    });

    test("refresh rejects historical seals once a newer head exists", async () => {
      const overrides = new Map<string, SealInput>();
      overrides.set("session-1:group-1", validInput());

      const { manager, publisher } = createTestManager(overrides);
      const first = await manager.issue("session-1", "group-1");
      expect(Result.isOk(first)).toBe(true);
      if (Result.isError(first)) return;

      overrides.set(
        "session-1:group-1",
        validInput({ verifierStatementRef: "verifier-statement-002" }),
      );

      const second = await manager.issue("session-1", "group-1");
      expect(Result.isOk(second)).toBe(true);
      if (Result.isError(second)) return;

      const refreshed = await manager.refresh(first.value.seal.sealId);
      expect(Result.isError(refreshed)).toBe(true);
      expect(publisher.published.length).toBe(2);

      const current = await manager.current("agent-inbox-1", "group-1");
      expect(Result.isOk(current)).toBe(true);
      if (Result.isError(current)) return;
      expect(current.value?.seal.sealId).toBe(second.value.seal.sealId);
    });
  });

  describe("revoke", () => {
    test("publishes a revocation to the group", async () => {
      const { manager, publisher } = createTestManager();
      const issued = await manager.issue("session-1", "group-1");
      expect(Result.isOk(issued)).toBe(true);
      if (Result.isError(issued)) return;

      const result = await manager.revoke(
        issued.value.seal.sealId,
        "owner-initiated",
      );
      expect(Result.isOk(result)).toBe(true);
      expect(publisher.publishedRevocations.length).toBe(1);
    });

    test("marks agent+group as revoked (terminal)", async () => {
      const { manager } = createTestManager();
      const issued = await manager.issue("session-1", "group-1");
      expect(Result.isOk(issued)).toBe(true);
      if (Result.isError(issued)) return;

      await manager.revoke(issued.value.seal.sealId, "owner-initiated");

      // Current should return null after revocation
      const current = await manager.current("agent-inbox-1", "group-1");
      expect(Result.isOk(current)).toBe(true);
      if (Result.isError(current)) return;
      expect(current.value).toBeNull();
    });

    test("returns error for unknown seal ID", async () => {
      const { manager } = createTestManager();
      const result = await manager.revoke("att_unknown", "owner-initiated");
      expect(Result.isError(result)).toBe(true);
    });

    test("returns error for already-revoked seal", async () => {
      const { manager } = createTestManager();
      const issued = await manager.issue("session-1", "group-1");
      expect(Result.isOk(issued)).toBe(true);
      if (Result.isError(issued)) return;

      await manager.revoke(issued.value.seal.sealId, "owner-initiated");
      const result = await manager.revoke(
        issued.value.seal.sealId,
        "owner-initiated",
      );
      expect(Result.isError(result)).toBe(true);
    });

    test("validates revocation against schema", async () => {
      // The revoke method now validates via RevocationSeal.safeParse.
      // Since the manager builds a valid revocation internally, this is
      // exercised implicitly by the other revoke tests passing.
      // This test confirms the validation path exists by checking
      // that a successful revoke produces a well-formed revocation.
      const { manager, publisher } = createTestManager();
      const issued = await manager.issue("session-1", "group-1");
      expect(Result.isOk(issued)).toBe(true);
      if (Result.isError(issued)) return;

      const result = await manager.revoke(
        issued.value.seal.sealId,
        "owner-initiated",
      );
      expect(Result.isOk(result)).toBe(true);

      const revocation = publisher.publishedRevocations[0];
      expect(revocation).toBeDefined();
      expect(revocation?.revocation.reason).toBe("owner-initiated");
      expect(revocation?.revocation.previousSealId).toBe(
        issued.value.seal.sealId,
      );
    });
  });

  describe("current", () => {
    test("returns null for unknown agent+group", async () => {
      const { manager } = createTestManager();
      const result = await manager.current("unknown-agent", "unknown-group");
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) return;
      expect(result.value).toBeNull();
    });

    test("returns latest seal for known agent+group", async () => {
      const overrides = new Map<string, SealInput>();
      overrides.set("session-1:group-1", validInput());

      const { manager } = createTestManager(overrides);
      await manager.issue("session-1", "group-1");

      // Material change so we get a new seal
      overrides.set(
        "session-1:group-1",
        validInput({
          view: {
            mode: "redacted",
            threadScopes: [{ groupId: "group-1", threadId: null }],
            contentTypes: ["xmtp.org/text:1.0"],
          },
        }),
      );
      const second = await manager.issue("session-1", "group-1");
      expect(Result.isOk(second)).toBe(true);
      if (Result.isError(second)) return;

      const current = await manager.current("agent-inbox-1", "group-1");
      expect(Result.isOk(current)).toBe(true);
      if (Result.isError(current)) return;
      expect(current.value?.seal.sealId).toBe(second.value.seal.sealId);
    });
  });

  describe("expiry and renewal", () => {
    test("default TTL is 24 hours", async () => {
      const { manager } = createTestManager();
      const result = await manager.issue("session-1", "group-1");
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) return;
      const issued = new Date(result.value.seal.issuedAt).getTime();
      const expires = new Date(result.value.seal.expiresAt).getTime();
      expect(expires - issued).toBe(86400 * 1000);
    });

    test("needsRenewal returns true when past 75% of TTL", () => {
      const { manager } = createTestManager();
      // 24h TTL, 75% = 18h. Create an seal issued 19h ago.
      const now = Date.now();
      const issuedAt = new Date(now - 19 * 60 * 60 * 1000).toISOString();
      const expiresAt = new Date(now + 5 * 60 * 60 * 1000).toISOString();
      const att = {
        sealId: "att_test",
        issuedAt,
        expiresAt,
      } as Seal;
      expect(manager.needsRenewal(att)).toBe(true);
    });

    test("needsRenewal returns false when before 75% of TTL", () => {
      const { manager } = createTestManager();
      const now = Date.now();
      const issuedAt = new Date(now - 1 * 60 * 60 * 1000).toISOString();
      const expiresAt = new Date(now + 23 * 60 * 60 * 1000).toISOString();
      const att = {
        sealId: "att_test",
        issuedAt,
        expiresAt,
      } as Seal;
      expect(manager.needsRenewal(att)).toBe(false);
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
      const result = await manager.issue("session-1", "group-1");
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
      const result = await manager.issue("session-1", "group-1");
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) return;
      expect(result.error._tag).toBe("InternalError");
    });
  });
});
