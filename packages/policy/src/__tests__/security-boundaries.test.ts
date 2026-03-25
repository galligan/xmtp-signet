/**
 * Permission validation security boundary tests.
 *
 * Proves that the policy permission validators correctly deny access
 * when scopes are missing, chats are out of scope, or specific
 * permission categories are not granted.
 */

import { describe, test, expect } from "bun:test";
import { Result } from "better-result";
import { validateSendMessage } from "../permissions/validate-send.js";
import { validateSendReaction } from "../permissions/validate-reaction.js";
import { validateEgress } from "../permissions/validate-egress.js";
import { validateGroupManagement } from "../permissions/validate-group-management.js";
import { createEmptyScopes, createChatIds } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Permission Validation Boundaries
// ---------------------------------------------------------------------------

describe("permission validation boundaries", () => {
  test("send denied without scope", () => {
    const result = validateSendMessage(
      { groupId: "conv_1" },
      createEmptyScopes(),
      createChatIds("conv_1"),
    );
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error._tag).toBe("PermissionError");
    }
  });

  test("reaction denied without scope", () => {
    const result = validateSendReaction(
      { groupId: "conv_1" },
      createEmptyScopes(),
      createChatIds("conv_1"),
    );
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error._tag).toBe("PermissionError");
    }
  });

  test("chat out of scope denied", () => {
    // Allow send scope but for conv_1 only -- access conv_2
    const scopes = new Set(["send"]);
    const result = validateSendMessage(
      { groupId: "conv_2" },
      scopes,
      createChatIds("conv_1"),
    );
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error._tag).toBe("PermissionError");
    }
  });

  test("egress denied without scope", () => {
    const result = validateEgress("store-excerpts", createEmptyScopes());
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error._tag).toBe("PermissionError");
    }
  });

  test("group management denied without scope", () => {
    const result = validateGroupManagement(
      "add-member",
      { groupId: "conv_1" },
      createEmptyScopes(),
      createChatIds("conv_1"),
    );
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error._tag).toBe("PermissionError");
    }
  });
});
