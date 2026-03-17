import { describe, expect, test } from "bun:test";
import type { ViewConfig, GrantConfig } from "@xmtp/signet-schemas";
import { computePolicyHash } from "../policy-hash.js";

const baseView: ViewConfig = {
  mode: "full",
  threadScopes: [{ groupId: "group-1", threadId: null }],
  contentTypes: ["text"],
};

const baseGrant: GrantConfig = {
  messaging: { send: true, reply: true, react: true, draftOnly: false },
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
};

describe("computePolicyHash", () => {
  test("returns a string", () => {
    const hash = computePolicyHash(baseView, baseGrant);
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });

  test("same input produces same hash", () => {
    const hash1 = computePolicyHash(baseView, baseGrant);
    const hash2 = computePolicyHash(baseView, baseGrant);
    expect(hash1).toBe(hash2);
  });

  test("different key order produces same hash (canonical)", () => {
    // Construct grant with keys in different order
    const reorderedGrant = {
      egress: baseGrant.egress,
      tools: baseGrant.tools,
      groupManagement: baseGrant.groupManagement,
      messaging: baseGrant.messaging,
    } as GrantConfig;

    const hash1 = computePolicyHash(baseView, baseGrant);
    const hash2 = computePolicyHash(baseView, reorderedGrant);
    expect(hash1).toBe(hash2);
  });

  test("different view mode produces different hash", () => {
    const differentView: ViewConfig = { ...baseView, mode: "redacted" };
    const hash1 = computePolicyHash(baseView, baseGrant);
    const hash2 = computePolicyHash(differentView, baseGrant);
    expect(hash1).not.toBe(hash2);
  });

  test("different grant produces different hash", () => {
    const differentGrant: GrantConfig = {
      ...baseGrant,
      messaging: { ...baseGrant.messaging, send: false },
    };
    const hash1 = computePolicyHash(baseView, baseGrant);
    const hash2 = computePolicyHash(baseView, differentGrant);
    expect(hash1).not.toBe(hash2);
  });

  test("reordered content types produce the same hash", () => {
    const firstView: ViewConfig = {
      ...baseView,
      contentTypes: ["text", "alpha", "zeta"],
    };
    const secondView: ViewConfig = {
      ...baseView,
      contentTypes: ["zeta", "text", "alpha"],
    };

    expect(computePolicyHash(firstView, baseGrant)).toBe(
      computePolicyHash(secondView, baseGrant),
    );
  });

  test("reordered thread scopes produce the same hash", () => {
    const firstView: ViewConfig = {
      ...baseView,
      threadScopes: [
        { groupId: "group-2", threadId: "thread-2" },
        { groupId: "group-1", threadId: null },
      ],
    };
    const secondView: ViewConfig = {
      ...baseView,
      threadScopes: [
        { groupId: "group-1", threadId: null },
        { groupId: "group-2", threadId: "thread-2" },
      ],
    };

    expect(computePolicyHash(firstView, baseGrant)).toBe(
      computePolicyHash(secondView, baseGrant),
    );
  });

  test("reordered tool scopes produce the same hash", () => {
    const firstGrant: GrantConfig = {
      ...baseGrant,
      tools: {
        scopes: [
          { toolId: "tool-b", allowed: true, parameters: null },
          { toolId: "tool-a", allowed: false, parameters: null },
        ],
      },
    };
    const secondGrant: GrantConfig = {
      ...baseGrant,
      tools: {
        scopes: [
          { toolId: "tool-a", allowed: false, parameters: null },
          { toolId: "tool-b", allowed: true, parameters: null },
        ],
      },
    };

    expect(computePolicyHash(baseView, firstGrant)).toBe(
      computePolicyHash(baseView, secondGrant),
    );
  });
});
