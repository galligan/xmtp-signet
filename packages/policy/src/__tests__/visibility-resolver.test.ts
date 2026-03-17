import { describe, test, expect } from "bun:test";
import { resolveVisibility } from "../pipeline/visibility-resolver.js";

describe("resolveVisibility", () => {
  test("full mode returns visible regardless of reveal", () => {
    expect(resolveVisibility("full", false)).toBe("visible");
    expect(resolveVisibility("full", true)).toBe("visible");
  });

  test("thread-only mode returns visible (already passed scope filter)", () => {
    expect(resolveVisibility("thread-only", false)).toBe("visible");
    expect(resolveVisibility("thread-only", true)).toBe("visible");
  });

  test("redacted mode returns redacted without reveal", () => {
    expect(resolveVisibility("redacted", false)).toBe("redacted");
  });

  test("redacted mode returns revealed with active reveal", () => {
    expect(resolveVisibility("redacted", true)).toBe("revealed");
  });

  test("reveal-only mode returns hidden without reveal", () => {
    expect(resolveVisibility("reveal-only", false)).toBe("hidden");
  });

  test("reveal-only mode returns revealed with active reveal", () => {
    expect(resolveVisibility("reveal-only", true)).toBe("revealed");
  });

  test("summary-only mode returns redacted without reveal", () => {
    expect(resolveVisibility("summary-only", false)).toBe("redacted");
  });

  test("summary-only mode returns revealed with active reveal", () => {
    expect(resolveVisibility("summary-only", true)).toBe("revealed");
  });
});
