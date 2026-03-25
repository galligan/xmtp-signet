import { describe, test, expect } from "bun:test";
import { validateSendReaction } from "../permissions/validate-reaction.js";
import { Result } from "better-result";
import {
  createFullScopes,
  createEmptyScopes,
  createChatIds,
} from "./fixtures.js";

describe("validateSendReaction", () => {
  test("succeeds when react scope is allowed and chat is in scope", () => {
    const result = validateSendReaction(
      { groupId: "group-1" },
      createFullScopes(),
      createChatIds("group-1"),
    );
    expect(Result.isOk(result)).toBe(true);
  });

  test("returns PermissionError when react scope is denied", () => {
    const result = validateSendReaction(
      { groupId: "group-1" },
      createEmptyScopes(),
      createChatIds("group-1"),
    );
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error._tag).toBe("PermissionError");
    }
  });

  test("returns PermissionError when chat is not in scope", () => {
    const result = validateSendReaction(
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
