import { describe, test, expect } from "bun:test";
import { validateSendReaction } from "../grant/validate-reaction.js";
import { Result } from "better-result";
import {
  createFullGrant,
  createDenyAllGrant,
  createPassthroughView,
} from "./fixtures.js";

describe("validateSendReaction", () => {
  test("succeeds when messaging.react is true", () => {
    const result = validateSendReaction(
      { groupId: "group-1", messageId: "msg-1" },
      createFullGrant(),
      createPassthroughView("group-1"),
    );
    expect(Result.isOk(result)).toBe(true);
  });

  test("returns GrantDeniedError when messaging.react is false", () => {
    const result = validateSendReaction(
      { groupId: "group-1", messageId: "msg-1" },
      createDenyAllGrant(),
      createPassthroughView("group-1"),
    );
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error._tag).toBe("GrantDeniedError");
    }
  });

  test("returns PermissionError when group not in view", () => {
    const result = validateSendReaction(
      { groupId: "group-other", messageId: "msg-1" },
      createFullGrant(),
      createPassthroughView("group-1"),
    );
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error._tag).toBe("PermissionError");
    }
  });
});
