import { describe, test, expect } from "bun:test";
import {
  validateSendMessage,
  validateSendReply,
} from "../permissions/validate-send.js";
import { Result } from "better-result";
import {
  createFullScopes,
  createEmptyScopes,
  createChatIds,
} from "./fixtures.js";

describe("validateSendMessage", () => {
  test("succeeds when send scope is allowed and chat is in scope", () => {
    const result = validateSendMessage(
      { groupId: "group-1" },
      createFullScopes(),
      createChatIds("group-1"),
    );
    expect(Result.isOk(result)).toBe(true);
  });

  test("returns PermissionError when send scope is denied", () => {
    const result = validateSendMessage(
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
    const result = validateSendMessage(
      { groupId: "group-other" },
      createFullScopes(),
      createChatIds("group-1"),
    );
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error._tag).toBe("PermissionError");
    }
  });

  test("returns PermissionError for empty chatIds", () => {
    const result = validateSendMessage(
      { groupId: "group-1" },
      createFullScopes(),
      createChatIds(),
    );
    expect(Result.isError(result)).toBe(true);
  });

  test("always returns draftOnly false (v1 scopes)", () => {
    const result = validateSendMessage(
      { groupId: "group-1" },
      createFullScopes(),
      createChatIds("group-1"),
    );
    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value.draftOnly).toBe(false);
    }
  });
});

describe("validateSendReply", () => {
  test("succeeds when reply scope is allowed and chat is in scope", () => {
    const result = validateSendReply(
      { groupId: "group-1" },
      createFullScopes(),
      createChatIds("group-1"),
    );
    expect(Result.isOk(result)).toBe(true);
  });

  test("returns PermissionError when reply scope is denied", () => {
    const result = validateSendReply(
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
    const result = validateSendReply(
      { groupId: "group-other" },
      createFullScopes(),
      createChatIds("group-1"),
    );
    expect(Result.isError(result)).toBe(true);
  });
});
