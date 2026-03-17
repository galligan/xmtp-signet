import { describe, expect, test } from "bun:test";
import { generateSealId } from "../seal-id.js";

describe("generateSealId", () => {
  test("produces string with att_ prefix", () => {
    const id = generateSealId();
    expect(id.startsWith("att_")).toBe(true);
  });

  test("produces att_ prefix followed by 32 hex chars", () => {
    const id = generateSealId();
    const hex = id.slice(4);
    expect(hex).toMatch(/^[0-9a-f]{32}$/);
  });

  test("produces unique IDs across multiple calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateSealId()));
    expect(ids.size).toBe(100);
  });

  test("total length is 36 characters (4 prefix + 32 hex)", () => {
    const id = generateSealId();
    expect(id.length).toBe(36);
  });
});
