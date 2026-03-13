import { describe, expect, test } from "bun:test";
import { generateAttestationId } from "../attestation-id.js";

describe("generateAttestationId", () => {
  test("produces string with att_ prefix", () => {
    const id = generateAttestationId();
    expect(id.startsWith("att_")).toBe(true);
  });

  test("produces att_ prefix followed by 32 hex chars", () => {
    const id = generateAttestationId();
    const hex = id.slice(4);
    expect(hex).toMatch(/^[0-9a-f]{32}$/);
  });

  test("produces unique IDs across multiple calls", () => {
    const ids = new Set(
      Array.from({ length: 100 }, () => generateAttestationId()),
    );
    expect(ids.size).toBe(100);
  });

  test("total length is 36 characters (4 prefix + 32 hex)", () => {
    const id = generateAttestationId();
    expect(id.length).toBe(36);
  });
});
