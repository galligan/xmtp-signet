import { describe, test, expect } from "bun:test";
import { validateViewMode } from "../allowlist.js";
import { Result } from "better-result";

describe("validateViewMode", () => {
  test("rejects summary-only with ValidationError", () => {
    const result = validateViewMode("summary-only");
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error._tag).toBe("ValidationError");
      expect(result.error.context.field).toBe("viewMode");
    }
  });

  test("accepts full mode", () => {
    const result = validateViewMode("full");
    expect(Result.isOk(result)).toBe(true);
  });

  test("accepts redacted mode", () => {
    const result = validateViewMode("redacted");
    expect(Result.isOk(result)).toBe(true);
  });

  test("accepts thread-only mode", () => {
    const result = validateViewMode("thread-only");
    expect(Result.isOk(result)).toBe(true);
  });

  test("accepts reveal-only mode", () => {
    const result = validateViewMode("reveal-only");
    expect(Result.isOk(result)).toBe(true);
  });
});
