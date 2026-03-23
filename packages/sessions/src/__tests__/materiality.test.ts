import { describe, expect, test } from "bun:test";
import type { ScopeSetType, PermissionScopeType } from "@xmtp/signet-schemas";
import { checkMateriality } from "../materiality.js";

const baseScopes: ScopeSetType = {
  allow: ["read-messages", "list-conversations"] as PermissionScopeType[],
  deny: [] as PermissionScopeType[],
};

describe("checkMateriality", () => {
  describe("scope escalation (material)", () => {
    test("adding a new allow scope is material", () => {
      const newScopes: ScopeSetType = {
        allow: [
          "read-messages",
          "list-conversations",
          "send",
        ] as PermissionScopeType[],
        deny: [],
      };
      const result = checkMateriality(baseScopes, newScopes);
      expect(result.isMaterial).toBe(true);
      expect(result.delta.added).toContain("send");
      expect(result.requiresReauthorization).toBe(true);
    });

    test("moving a scope from deny to allow is material", () => {
      const oldScopes: ScopeSetType = {
        allow: ["read-messages"] as PermissionScopeType[],
        deny: ["send"] as PermissionScopeType[],
      };
      const newScopes: ScopeSetType = {
        allow: ["read-messages", "send"] as PermissionScopeType[],
        deny: [] as PermissionScopeType[],
      };
      const result = checkMateriality(oldScopes, newScopes);
      expect(result.isMaterial).toBe(true);
      expect(result.delta.changed).toHaveLength(1);
      expect(result.delta.changed[0]?.from).toBe("deny");
      expect(result.delta.changed[0]?.to).toBe("allow");
      expect(result.requiresReauthorization).toBe(true);
    });

    test("removing a deny override from an allowed scope is material", () => {
      const oldScopes: ScopeSetType = {
        allow: ["send"] as PermissionScopeType[],
        deny: ["send"] as PermissionScopeType[],
      };
      const newScopes: ScopeSetType = {
        allow: ["send"] as PermissionScopeType[],
        deny: [] as PermissionScopeType[],
      };
      const result = checkMateriality(oldScopes, newScopes);
      expect(result.isMaterial).toBe(true);
      expect(result.delta.changed).toEqual([
        { scope: "send", from: "deny", to: "allow" },
      ]);
      expect(result.requiresReauthorization).toBe(true);
    });

    test("adding multiple scopes is material", () => {
      const newScopes: ScopeSetType = {
        allow: [
          "read-messages",
          "list-conversations",
          "send",
          "reply",
          "react",
        ] as PermissionScopeType[],
        deny: [],
      };
      const result = checkMateriality(baseScopes, newScopes);
      expect(result.isMaterial).toBe(true);
      expect(result.delta.added).toHaveLength(3);
      expect(result.requiresReauthorization).toBe(true);
    });
  });

  describe("scope reduction (material but no reauth)", () => {
    test("removing an allow scope is material but does not require reauth", () => {
      const newScopes: ScopeSetType = {
        allow: ["read-messages"] as PermissionScopeType[],
        deny: [] as PermissionScopeType[],
      };
      const result = checkMateriality(baseScopes, newScopes);
      expect(result.isMaterial).toBe(true);
      expect(result.delta.removed).toContain("list-conversations");
      expect(result.requiresReauthorization).toBe(false);
    });

    test("moving a scope from allow to deny is material but no reauth", () => {
      const newScopes: ScopeSetType = {
        allow: ["read-messages"] as PermissionScopeType[],
        deny: ["list-conversations"] as PermissionScopeType[],
      };
      const result = checkMateriality(baseScopes, newScopes);
      expect(result.isMaterial).toBe(true);
      expect(result.delta.changed).toHaveLength(1);
      expect(result.delta.changed[0]?.from).toBe("allow");
      expect(result.delta.changed[0]?.to).toBe("deny");
      expect(result.requiresReauthorization).toBe(false);
    });
  });

  describe("no change (non-material)", () => {
    test("identical scopes are non-material", () => {
      const result = checkMateriality(baseScopes, baseScopes);
      expect(result.isMaterial).toBe(false);
      expect(result.delta.added).toHaveLength(0);
      expect(result.delta.removed).toHaveLength(0);
      expect(result.delta.changed).toHaveLength(0);
    });

    test("reason is null when non-material", () => {
      const result = checkMateriality(baseScopes, baseScopes);
      expect(result.reason).toBeNull();
    });
  });

  describe("reason string", () => {
    test("reason is set when material", () => {
      const newScopes: ScopeSetType = {
        allow: [
          "read-messages",
          "list-conversations",
          "send",
        ] as PermissionScopeType[],
        deny: [],
      };
      const result = checkMateriality(baseScopes, newScopes);
      expect(result.reason).not.toBeNull();
      expect(typeof result.reason).toBe("string");
    });
  });
});
