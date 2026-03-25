import { describe, test, expect } from "bun:test";
import { validateGroupManagement } from "../permissions/validate-group-management.js";
import { Result } from "better-result";
import {
  createFullScopes,
  createEmptyScopes,
  createChatIds,
} from "./fixtures.js";

describe("validateGroupManagement", () => {
  const scopeNames = [
    "add-member",
    "remove-member",
    "update-name",
    "update-description",
    "update-image",
    "invite",
  ] as const;

  for (const scope of scopeNames) {
    test(`succeeds when ${scope} scope is allowed`, () => {
      const result = validateGroupManagement(
        scope,
        { groupId: "group-1" },
        createFullScopes(),
        createChatIds("group-1"),
      );
      expect(Result.isOk(result)).toBe(true);
    });

    test(`returns PermissionError when ${scope} scope is denied`, () => {
      const result = validateGroupManagement(
        scope,
        { groupId: "group-1" },
        createEmptyScopes(),
        createChatIds("group-1"),
      );
      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error._tag).toBe("PermissionError");
      }
    });
  }

  test("returns PermissionError when chat is not in scope", () => {
    const result = validateGroupManagement(
      "add-member",
      { groupId: "group-other" },
      createFullScopes(),
      createChatIds("group-1"),
    );
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error._tag).toBe("PermissionError");
    }
  });
});
