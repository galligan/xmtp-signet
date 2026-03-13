import { describe, test, expect } from "bun:test";
import { isInScope } from "../pipeline/scope-filter.js";
import type { ThreadScope } from "@xmtp-broker/schemas";

describe("isInScope", () => {
  test("returns true when message groupId matches a scope with null threadId", () => {
    const scopes: readonly ThreadScope[] = [
      { groupId: "group-1", threadId: null },
    ];
    expect(isInScope({ groupId: "group-1", threadId: null }, scopes)).toBe(
      true,
    );
  });

  test("returns true when message groupId and threadId match a scope", () => {
    const scopes: readonly ThreadScope[] = [
      { groupId: "group-1", threadId: "thread-1" },
    ];
    expect(
      isInScope({ groupId: "group-1", threadId: "thread-1" }, scopes),
    ).toBe(true);
  });

  test("returns false when message groupId does not match any scope", () => {
    const scopes: readonly ThreadScope[] = [
      { groupId: "group-1", threadId: null },
    ];
    expect(isInScope({ groupId: "group-2", threadId: null }, scopes)).toBe(
      false,
    );
  });

  test("null threadId scope matches any thread in that group", () => {
    const scopes: readonly ThreadScope[] = [
      { groupId: "group-1", threadId: null },
    ];
    expect(
      isInScope({ groupId: "group-1", threadId: "thread-42" }, scopes),
    ).toBe(true);
  });

  test("specific threadId scope does not match a different thread", () => {
    const scopes: readonly ThreadScope[] = [
      { groupId: "group-1", threadId: "thread-1" },
    ];
    expect(
      isInScope({ groupId: "group-1", threadId: "thread-2" }, scopes),
    ).toBe(false);
  });

  test("specific threadId scope does not match null threadId message", () => {
    const scopes: readonly ThreadScope[] = [
      { groupId: "group-1", threadId: "thread-1" },
    ];
    expect(isInScope({ groupId: "group-1", threadId: null }, scopes)).toBe(
      false,
    );
  });

  test("returns true when any of multiple scopes match", () => {
    const scopes: readonly ThreadScope[] = [
      { groupId: "group-1", threadId: "thread-1" },
      { groupId: "group-2", threadId: null },
    ];
    expect(
      isInScope({ groupId: "group-2", threadId: "thread-5" }, scopes),
    ).toBe(true);
  });

  test("returns false for empty scopes array", () => {
    expect(isInScope({ groupId: "group-1", threadId: null }, [])).toBe(false);
  });
});
