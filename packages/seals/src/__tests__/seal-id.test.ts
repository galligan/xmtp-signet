import { describe, expect, test } from "bun:test";
import { generateSealId } from "../seal-id.js";

describe("generateSealId", () => {
  test("produces string with seal_ prefix", () => {
    const id = generateSealId();
    expect(id.startsWith("seal_")).toBe(true);
  });

  test("produces seal_ prefix followed by 16 hex chars", () => {
    const id = generateSealId();
    const hex = id.slice(5);
    expect(hex).toMatch(/^[0-9a-f]{16}$/);
  });

  test("produces unique IDs across multiple calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateSealId()));
    expect(ids.size).toBe(100);
  });

  test("total length is 21 characters (5 prefix + 16 hex)", () => {
    const id = generateSealId();
    expect(id.length).toBe(21);
  });
});
