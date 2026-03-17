import { describe, expect, test } from "bun:test";
import type { ViewConfig } from "@xmtp/signet-schemas";
import { checkMateriality } from "../materiality.js";
import { baseView, baseGrant, createTestGrant } from "./fixtures.js";

describe("checkMateriality", () => {
  describe("view mode escalation (material)", () => {
    test("redacted -> full is material", () => {
      const oldView: ViewConfig = { ...baseView, mode: "redacted" };
      const newView: ViewConfig = { ...baseView, mode: "full" };
      const result = checkMateriality(oldView, baseGrant, newView, baseGrant);
      expect(result.isMaterial).toBe(true);
      expect(result.changedFields).toContain("view.mode");
    });

    test("redacted -> thread-only is material", () => {
      const oldView: ViewConfig = { ...baseView, mode: "redacted" };
      const newView: ViewConfig = { ...baseView, mode: "thread-only" };
      const result = checkMateriality(oldView, baseGrant, newView, baseGrant);
      expect(result.isMaterial).toBe(true);
    });

    test("summary-only -> full is material", () => {
      const oldView: ViewConfig = { ...baseView, mode: "summary-only" };
      const newView: ViewConfig = { ...baseView, mode: "full" };
      const result = checkMateriality(oldView, baseGrant, newView, baseGrant);
      expect(result.isMaterial).toBe(true);
    });

    test("summary-only -> thread-only is material", () => {
      const oldView: ViewConfig = { ...baseView, mode: "summary-only" };
      const newView: ViewConfig = { ...baseView, mode: "thread-only" };
      const result = checkMateriality(oldView, baseGrant, newView, baseGrant);
      expect(result.isMaterial).toBe(true);
    });

    test("reveal-only -> full is material", () => {
      const oldView: ViewConfig = { ...baseView, mode: "reveal-only" };
      const newView: ViewConfig = { ...baseView, mode: "full" };
      const result = checkMateriality(oldView, baseGrant, newView, baseGrant);
      expect(result.isMaterial).toBe(true);
    });

    test("reveal-only -> redacted is material", () => {
      const oldView: ViewConfig = { ...baseView, mode: "reveal-only" };
      const newView: ViewConfig = { ...baseView, mode: "redacted" };
      const result = checkMateriality(oldView, baseGrant, newView, baseGrant);
      expect(result.isMaterial).toBe(true);
    });

    test("thread-only -> full is material", () => {
      const oldView: ViewConfig = { ...baseView, mode: "thread-only" };
      const newView: ViewConfig = { ...baseView, mode: "full" };
      const result = checkMateriality(oldView, baseGrant, newView, baseGrant);
      expect(result.isMaterial).toBe(true);
    });
  });

  describe("view mode reduction (non-material)", () => {
    test("full -> redacted is non-material", () => {
      const oldView: ViewConfig = { ...baseView, mode: "full" };
      const newView: ViewConfig = { ...baseView, mode: "redacted" };
      const result = checkMateriality(oldView, baseGrant, newView, baseGrant);
      expect(result.isMaterial).toBe(false);
    });

    test("full -> thread-only is non-material", () => {
      const oldView: ViewConfig = { ...baseView, mode: "full" };
      const newView: ViewConfig = { ...baseView, mode: "thread-only" };
      const result = checkMateriality(oldView, baseGrant, newView, baseGrant);
      expect(result.isMaterial).toBe(false);
    });

    test("redacted -> reveal-only is non-material", () => {
      const oldView: ViewConfig = { ...baseView, mode: "redacted" };
      const newView: ViewConfig = { ...baseView, mode: "reveal-only" };
      const result = checkMateriality(oldView, baseGrant, newView, baseGrant);
      expect(result.isMaterial).toBe(false);
    });

    test("same mode is non-material", () => {
      const result = checkMateriality(baseView, baseGrant, baseView, baseGrant);
      expect(result.isMaterial).toBe(false);
      expect(result.changedFields).toHaveLength(0);
    });
  });

  describe("grant escalation (material)", () => {
    test("messaging.send false -> true is material", () => {
      const newGrant = createTestGrant({
        messaging: { ...baseGrant.messaging, send: true },
      });
      const result = checkMateriality(baseView, baseGrant, baseView, newGrant);
      expect(result.isMaterial).toBe(true);
      expect(result.changedFields).toContain("grant.messaging.send");
    });

    test("messaging.draftOnly true -> false is material", () => {
      const newGrant = createTestGrant({
        messaging: { ...baseGrant.messaging, draftOnly: false },
      });
      const result = checkMateriality(baseView, baseGrant, baseView, newGrant);
      expect(result.isMaterial).toBe(true);
      expect(result.changedFields).toContain("grant.messaging.draftOnly");
    });

    test("groupManagement.addMembers false -> true is material", () => {
      const newGrant = createTestGrant({
        groupManagement: {
          ...baseGrant.groupManagement,
          addMembers: true,
        },
      });
      const result = checkMateriality(baseView, baseGrant, baseView, newGrant);
      expect(result.isMaterial).toBe(true);
      expect(result.changedFields).toContain(
        "grant.groupManagement.addMembers",
      );
    });

    test("egress.storeExcerpts false -> true is material", () => {
      const newGrant = createTestGrant({
        egress: { ...baseGrant.egress, storeExcerpts: true },
      });
      const result = checkMateriality(baseView, baseGrant, baseView, newGrant);
      expect(result.isMaterial).toBe(true);
      expect(result.changedFields).toContain("grant.egress.storeExcerpts");
    });

    test("new tool scope added is material", () => {
      const newGrant = createTestGrant({
        tools: {
          scopes: [{ toolId: "tool-1", allowed: true, parameters: null }],
        },
      });
      const result = checkMateriality(baseView, baseGrant, baseView, newGrant);
      expect(result.isMaterial).toBe(true);
      expect(result.changedFields).toContain("grant.tools.scopes");
    });

    test("tool allowed false -> true is material", () => {
      const oldGrant = createTestGrant({
        tools: {
          scopes: [{ toolId: "tool-1", allowed: false, parameters: null }],
        },
      });
      const newGrant = createTestGrant({
        tools: {
          scopes: [{ toolId: "tool-1", allowed: true, parameters: null }],
        },
      });
      const result = checkMateriality(baseView, oldGrant, baseView, newGrant);
      expect(result.isMaterial).toBe(true);
      expect(result.changedFields).toContain("grant.tools.scopes");
    });
  });

  describe("grant reduction (non-material)", () => {
    test("messaging.send true -> false is non-material", () => {
      const oldGrant = createTestGrant({
        messaging: { ...baseGrant.messaging, send: true },
      });
      const result = checkMateriality(baseView, oldGrant, baseView, baseGrant);
      expect(result.isMaterial).toBe(false);
    });

    test("egress.storeExcerpts true -> false is non-material", () => {
      const oldGrant = createTestGrant({
        egress: { ...baseGrant.egress, storeExcerpts: true },
      });
      const result = checkMateriality(baseView, oldGrant, baseView, baseGrant);
      expect(result.isMaterial).toBe(false);
    });
  });

  describe("non-material changes", () => {
    test("adding thread scopes is non-material", () => {
      const newView: ViewConfig = {
        ...baseView,
        threadScopes: [
          ...baseView.threadScopes,
          { groupId: "group-2", threadId: "thread-1" },
        ],
      };
      const result = checkMateriality(baseView, baseGrant, newView, baseGrant);
      expect(result.isMaterial).toBe(false);
    });

    test("adding content types is non-material", () => {
      const newView: ViewConfig = {
        ...baseView,
        contentTypes: [...baseView.contentTypes, "reaction"],
      };
      const result = checkMateriality(baseView, baseGrant, newView, baseGrant);
      expect(result.isMaterial).toBe(false);
    });

    test("messaging.react false -> true is non-material", () => {
      const newGrant = createTestGrant({
        messaging: { ...baseGrant.messaging, react: true },
      });
      const result = checkMateriality(baseView, baseGrant, baseView, newGrant);
      expect(result.isMaterial).toBe(false);
    });

    test("messaging.reply false -> true is non-material", () => {
      const newGrant = createTestGrant({
        messaging: { ...baseGrant.messaging, reply: true },
      });
      const result = checkMateriality(baseView, baseGrant, baseView, newGrant);
      expect(result.isMaterial).toBe(false);
    });
  });

  describe("multiple changes", () => {
    test("material + non-material = material", () => {
      const newView: ViewConfig = {
        ...baseView,
        mode: "full",
        contentTypes: [...baseView.contentTypes, "reaction"],
      };
      const result = checkMateriality(baseView, baseGrant, newView, baseGrant);
      expect(result.isMaterial).toBe(true);
      expect(result.changedFields).toContain("view.mode");
    });

    test("reason is null when non-material", () => {
      const result = checkMateriality(baseView, baseGrant, baseView, baseGrant);
      expect(result.reason).toBeNull();
    });

    test("reason is set when material", () => {
      const newView: ViewConfig = { ...baseView, mode: "full" };
      const result = checkMateriality(baseView, baseGrant, newView, baseGrant);
      expect(result.reason).not.toBeNull();
      expect(typeof result.reason).toBe("string");
    });
  });
});
