import { describe, expect, test } from "bun:test";
import { exitCodeFromCategory } from "../output/exit-codes.js";

describe("exitCodeFromCategory", () => {
  test("maps validation to exit code from ERROR_CATEGORY_META", () => {
    expect(exitCodeFromCategory("validation")).toBe(1);
  });

  test("maps not_found to exit code from ERROR_CATEGORY_META", () => {
    expect(exitCodeFromCategory("not_found")).toBe(2);
  });

  test("maps permission to exit code from ERROR_CATEGORY_META", () => {
    expect(exitCodeFromCategory("permission")).toBe(4);
  });

  test("maps auth to exit code from ERROR_CATEGORY_META", () => {
    expect(exitCodeFromCategory("auth")).toBe(9);
  });

  test("maps internal to exit code from ERROR_CATEGORY_META", () => {
    expect(exitCodeFromCategory("internal")).toBe(8);
  });

  test("maps timeout to exit code from ERROR_CATEGORY_META", () => {
    expect(exitCodeFromCategory("timeout")).toBe(5);
  });

  test("maps cancelled to exit code from ERROR_CATEGORY_META", () => {
    expect(exitCodeFromCategory("cancelled")).toBe(130);
  });

  test("maps network to exit code from ERROR_CATEGORY_META", () => {
    expect(exitCodeFromCategory("network")).toBe(6);
  });

  test("returns internal exit code for unknown category", () => {
    expect(
      exitCodeFromCategory(
        "bogus" as Parameters<typeof exitCodeFromCategory>[0],
      ),
    ).toBe(8);
  });

  test("success exit code is 0", () => {
    // Importing the constant directly
    const { EXIT_SUCCESS } = require("../output/exit-codes.js") as {
      EXIT_SUCCESS: number;
    };
    expect(EXIT_SUCCESS).toBe(0);
  });
});
