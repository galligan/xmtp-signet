import { describe, test, expect } from "bun:test";
import { validateGroupManagement } from "../grant/validate-group-management.js";
import { Result } from "better-result";
import {
  createFullGrant,
  createDenyAllGrant,
  createPassthroughView,
} from "./fixtures.js";

describe("validateGroupManagement", () => {
  const actions = [
    "addMembers",
    "removeMembers",
    "updateMetadata",
    "inviteUsers",
  ] as const;

  for (const action of actions) {
    test(`succeeds when groupManagement.${action} is true`, () => {
      const result = validateGroupManagement(
        action,
        { groupId: "group-1" },
        createFullGrant(),
        createPassthroughView("group-1"),
      );
      expect(Result.isOk(result)).toBe(true);
    });

    test(`returns GrantDeniedError when groupManagement.${action} is false`, () => {
      const result = validateGroupManagement(
        action,
        { groupId: "group-1" },
        createDenyAllGrant(),
        createPassthroughView("group-1"),
      );
      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error._tag).toBe("GrantDeniedError");
      }
    });
  }

  test("returns PermissionError when group not in view", () => {
    const result = validateGroupManagement(
      "addMembers",
      { groupId: "group-other" },
      createFullGrant(),
      createPassthroughView("group-1"),
    );
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error._tag).toBe("PermissionError");
    }
  });
});
