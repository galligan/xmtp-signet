import { describe, expect, test } from "bun:test";
import type { ScopeSetType, PermissionScopeType } from "@xmtp/signet-schemas";
import { computePolicyHash } from "../policy-hash.js";

const baseScopes: ScopeSetType = {
  allow: ["send", "reply", "read-messages"] as PermissionScopeType[],
  deny: [] as PermissionScopeType[],
};

describe("computePolicyHash", () => {
  test("returns a string", () => {
    const hash = computePolicyHash(baseScopes);
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });

  test("same input produces same hash", () => {
    const hash1 = computePolicyHash(baseScopes);
    const hash2 = computePolicyHash(baseScopes);
    expect(hash1).toBe(hash2);
  });

  test("different key order produces same hash (canonical)", () => {
    const reordered: ScopeSetType = {
      deny: baseScopes.deny,
      allow: baseScopes.allow,
    };
    const hash1 = computePolicyHash(baseScopes);
    const hash2 = computePolicyHash(reordered);
    expect(hash1).toBe(hash2);
  });

  test("different allow scopes produce different hash", () => {
    const different: ScopeSetType = {
      allow: ["send"] as PermissionScopeType[],
      deny: [] as PermissionScopeType[],
    };
    const hash1 = computePolicyHash(baseScopes);
    const hash2 = computePolicyHash(different);
    expect(hash1).not.toBe(hash2);
  });

  test("different deny scopes produce different hash", () => {
    const different: ScopeSetType = {
      allow: baseScopes.allow,
      deny: ["forward-to-provider"] as PermissionScopeType[],
    };
    const hash1 = computePolicyHash(baseScopes);
    const hash2 = computePolicyHash(different);
    expect(hash1).not.toBe(hash2);
  });

  test("reordered allow scopes produce the same hash", () => {
    const first: ScopeSetType = {
      allow: ["send", "reply", "react"] as PermissionScopeType[],
      deny: [] as PermissionScopeType[],
    };
    const second: ScopeSetType = {
      allow: ["react", "send", "reply"] as PermissionScopeType[],
      deny: [] as PermissionScopeType[],
    };
    expect(computePolicyHash(first)).toBe(computePolicyHash(second));
  });

  test("reordered deny scopes produce the same hash", () => {
    const first: ScopeSetType = {
      allow: [] as PermissionScopeType[],
      deny: ["send", "reply"] as PermissionScopeType[],
    };
    const second: ScopeSetType = {
      allow: [] as PermissionScopeType[],
      deny: ["reply", "send"] as PermissionScopeType[],
    };
    expect(computePolicyHash(first)).toBe(computePolicyHash(second));
  });
});
