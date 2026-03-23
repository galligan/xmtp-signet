import { describe, test, expect } from "bun:test";
import { resolveVisibility } from "../pipeline/visibility-resolver.js";

describe("resolveVisibility", () => {
  test("returns visible when read-messages scope is present", () => {
    const scopes = new Set(["read-messages"]);
    expect(resolveVisibility(scopes, false)).toBe("visible");
    expect(resolveVisibility(scopes, true)).toBe("visible");
  });

  test("returns revealed when no read-messages but message is revealed", () => {
    const scopes = new Set<string>();
    expect(resolveVisibility(scopes, true)).toBe("revealed");
  });

  test("returns hidden when no read-messages and not revealed", () => {
    const scopes = new Set<string>();
    expect(resolveVisibility(scopes, false)).toBe("hidden");
  });

  test("read-messages takes precedence over revealed state", () => {
    const scopes = new Set(["read-messages"]);
    expect(resolveVisibility(scopes, true)).toBe("visible");
  });
});
