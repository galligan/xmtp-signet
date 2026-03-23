import { describe, test, expect } from "bun:test";
import { isInScope } from "../pipeline/scope-filter.js";

describe("isInScope", () => {
  test("returns true when message groupId is in chatIds", () => {
    expect(isInScope({ groupId: "group-1" }, ["group-1"])).toBe(true);
  });

  test("returns false when message groupId is not in chatIds", () => {
    expect(isInScope({ groupId: "group-2" }, ["group-1"])).toBe(false);
  });

  test("returns true when any of multiple chatIds match", () => {
    expect(isInScope({ groupId: "group-2" }, ["group-1", "group-2"])).toBe(
      true,
    );
  });

  test("returns false for empty chatIds array", () => {
    expect(isInScope({ groupId: "group-1" }, [])).toBe(false);
  });
});
