import { describe, test, expect } from "bun:test";
import { Result } from "better-result";
import { NotFoundError } from "@xmtp/signet-schemas";
import type { ScopeSetType, SignetError } from "@xmtp/signet-schemas";
import { createScopeGuard } from "../scope-guard.js";
import type { CredentialScopeLookup } from "../scope-guard.js";

function makeLookup(scopes: ScopeSetType): CredentialScopeLookup {
  return async () => Result.ok(scopes);
}

function makeFailingLookup(error: SignetError): CredentialScopeLookup {
  return async () => Result.err(error);
}

describe("createScopeGuard", () => {
  describe("check", () => {
    test("returns true for a scope in allow and not in deny", async () => {
      const guard = createScopeGuard(
        makeLookup({ allow: ["send", "read-messages"], deny: [] }),
      );
      const result = await guard.check("send", "cred-1");
      expect(result.isOk()).toBe(true);
      expect(result.value).toBe(true);
    });

    test("returns false for a scope in both allow and deny (deny wins)", async () => {
      const guard = createScopeGuard(
        makeLookup({ allow: ["send", "read-messages"], deny: ["send"] }),
      );
      const result = await guard.check("send", "cred-1");
      expect(result.isOk()).toBe(true);
      expect(result.value).toBe(false);
    });

    test("returns false for a scope not in allow", async () => {
      const guard = createScopeGuard(
        makeLookup({ allow: ["read-messages"], deny: [] }),
      );
      const result = await guard.check("send", "cred-1");
      expect(result.isOk()).toBe(true);
      expect(result.value).toBe(false);
    });

    test("returns false when allow and deny are both empty", async () => {
      const guard = createScopeGuard(makeLookup({ allow: [], deny: [] }));
      const result = await guard.check("send", "cred-1");
      expect(result.isOk()).toBe(true);
      expect(result.value).toBe(false);
    });

    test("propagates lookup error", async () => {
      const error = NotFoundError.create("credential", "cred-bad");
      const guard = createScopeGuard(makeFailingLookup(error));
      const result = await guard.check("send", "cred-bad");
      expect(result.isErr()).toBe(true);
      expect(result.error).toBe(error);
    });

    test("passes credentialId to the lookup function", async () => {
      const lookupIds: string[] = [];
      const guard = createScopeGuard(async (credentialId) => {
        lookupIds.push(credentialId);
        return Result.ok({ allow: ["send"], deny: [] });
      });
      await guard.check("send", "cred-42");
      expect(lookupIds).toEqual(["cred-42"]);
    });
  });

  describe("effectiveScopes", () => {
    test("returns the scope set from the lookup", async () => {
      const scopes: ScopeSetType = {
        allow: ["send", "read-messages"],
        deny: ["react"],
      };
      const guard = createScopeGuard(makeLookup(scopes));
      const result = await guard.effectiveScopes("cred-1");
      expect(result.isOk()).toBe(true);
      expect(result.value).toEqual(scopes);
    });

    test("propagates lookup error", async () => {
      const error = NotFoundError.create("credential", "cred-bad");
      const guard = createScopeGuard(makeFailingLookup(error));
      const result = await guard.effectiveScopes("cred-bad");
      expect(result.isErr()).toBe(true);
      expect(result.error).toBe(error);
    });
  });
});
