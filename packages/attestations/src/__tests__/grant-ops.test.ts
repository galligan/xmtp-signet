import { describe, expect, test } from "bun:test";
import type { GrantConfig } from "@xmtp-broker/schemas";
import { grantConfigToOps, grantConfigToToolScopes } from "../grant-ops.js";

function makeGrant(
  overrides?: Partial<{
    messaging: Partial<GrantConfig["messaging"]>;
    groupManagement: Partial<GrantConfig["groupManagement"]>;
    egress: Partial<GrantConfig["egress"]>;
    tools: Partial<GrantConfig["tools"]>;
  }>,
): GrantConfig {
  return {
    messaging: {
      send: false,
      reply: false,
      react: false,
      draftOnly: false,
      ...overrides?.messaging,
    },
    groupManagement: {
      addMembers: false,
      removeMembers: false,
      updateMetadata: false,
      inviteUsers: false,
      ...overrides?.groupManagement,
    },
    egress: {
      storeExcerpts: false,
      useForMemory: false,
      forwardToProviders: false,
      quoteRevealed: false,
      summarize: false,
      ...overrides?.egress,
    },
    tools: {
      scopes: [],
      ...overrides?.tools,
    },
  };
}

describe("grantConfigToOps", () => {
  test("returns empty array when all grants are false", () => {
    const ops = grantConfigToOps(makeGrant());
    expect(ops).toEqual([]);
  });

  test("includes messaging:send when send is true", () => {
    const ops = grantConfigToOps(makeGrant({ messaging: { send: true } }));
    expect(ops).toContain("messaging:send");
  });

  test("includes messaging:reply when reply is true", () => {
    const ops = grantConfigToOps(makeGrant({ messaging: { reply: true } }));
    expect(ops).toContain("messaging:reply");
  });

  test("includes messaging:react when react is true", () => {
    const ops = grantConfigToOps(makeGrant({ messaging: { react: true } }));
    expect(ops).toContain("messaging:react");
  });

  test("includes messaging:draft_only when draftOnly is true", () => {
    const ops = grantConfigToOps(makeGrant({ messaging: { draftOnly: true } }));
    expect(ops).toContain("messaging:draft_only");
  });

  test("includes group:add_members when addMembers is true", () => {
    const ops = grantConfigToOps(
      makeGrant({ groupManagement: { addMembers: true } }),
    );
    expect(ops).toContain("group:add_members");
  });

  test("includes group:remove_members when removeMembers is true", () => {
    const ops = grantConfigToOps(
      makeGrant({ groupManagement: { removeMembers: true } }),
    );
    expect(ops).toContain("group:remove_members");
  });

  test("includes group:update_metadata when updateMetadata is true", () => {
    const ops = grantConfigToOps(
      makeGrant({ groupManagement: { updateMetadata: true } }),
    );
    expect(ops).toContain("group:update_metadata");
  });

  test("includes group:invite_users when inviteUsers is true", () => {
    const ops = grantConfigToOps(
      makeGrant({ groupManagement: { inviteUsers: true } }),
    );
    expect(ops).toContain("group:invite_users");
  });

  test("includes egress:forward_to_providers when forwardToProviders is true", () => {
    const ops = grantConfigToOps(
      makeGrant({ egress: { forwardToProviders: true } }),
    );
    expect(ops).toContain("egress:forward_to_providers");
  });

  test("includes egress:store_excerpts when storeExcerpts is true", () => {
    const ops = grantConfigToOps(
      makeGrant({ egress: { storeExcerpts: true } }),
    );
    expect(ops).toContain("egress:store_excerpts");
  });

  test("includes egress:use_for_memory when useForMemory is true", () => {
    const ops = grantConfigToOps(makeGrant({ egress: { useForMemory: true } }));
    expect(ops).toContain("egress:use_for_memory");
  });

  test("includes egress:quote_revealed when quoteRevealed is true", () => {
    const ops = grantConfigToOps(
      makeGrant({ egress: { quoteRevealed: true } }),
    );
    expect(ops).toContain("egress:quote_revealed");
  });

  test("includes egress:summarize when summarize is true", () => {
    const ops = grantConfigToOps(makeGrant({ egress: { summarize: true } }));
    expect(ops).toContain("egress:summarize");
  });

  test("includes multiple ops when multiple grants are true", () => {
    const ops = grantConfigToOps(
      makeGrant({
        messaging: { send: true, reply: true },
        egress: { forwardToProviders: true },
      }),
    );
    expect(ops).toContain("messaging:send");
    expect(ops).toContain("messaging:reply");
    expect(ops).toContain("egress:forward_to_providers");
    expect(ops).not.toContain("messaging:react");
  });
});

describe("grantConfigToToolScopes", () => {
  test("returns empty array when no tool scopes defined", () => {
    const scopes = grantConfigToToolScopes(makeGrant());
    expect(scopes).toEqual([]);
  });

  test("returns tool IDs for allowed tools", () => {
    const scopes = grantConfigToToolScopes(
      makeGrant({
        tools: {
          scopes: [
            { toolId: "search", allowed: true, parameters: null },
            { toolId: "calculator", allowed: true, parameters: null },
          ],
        },
      }),
    );
    expect(scopes).toEqual(["search", "calculator"]);
  });

  test("excludes disallowed tools", () => {
    const scopes = grantConfigToToolScopes(
      makeGrant({
        tools: {
          scopes: [
            { toolId: "search", allowed: true, parameters: null },
            { toolId: "dangerous", allowed: false, parameters: null },
          ],
        },
      }),
    );
    expect(scopes).toContain("search");
    expect(scopes).not.toContain("dangerous");
  });
});
