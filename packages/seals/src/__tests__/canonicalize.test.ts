import { describe, expect, test } from "bun:test";
import { canonicalize } from "../canonicalize.js";

describe("canonicalize", () => {
  test("produces identical bytes for objects with same keys in different order", () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { a: 2, m: 3, z: 1 };
    expect(canonicalize(a)).toEqual(canonicalize(b));
  });

  test("produces UTF-8 encoded bytes", () => {
    const obj = { key: "value" };
    const bytes = canonicalize(obj);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toBe('{"key":"value"}');
  });

  test("sorts nested object keys recursively", () => {
    const a = { outer: { z: 1, a: 2 } };
    const b = { outer: { a: 2, z: 1 } };
    expect(canonicalize(a)).toEqual(canonicalize(b));
  });

  test("preserves array order (arrays are not sorted)", () => {
    const obj = { arr: [3, 1, 2] };
    const decoded = new TextDecoder().decode(canonicalize(obj));
    expect(decoded).toBe('{"arr":[3,1,2]}');
  });

  test("produces no whitespace in output", () => {
    const obj = { a: 1, b: { c: 2, d: [3, 4] } };
    const decoded = new TextDecoder().decode(canonicalize(obj));
    expect(decoded).not.toMatch(/\s/);
  });

  test("handles null values", () => {
    const obj = { a: null, b: 1 };
    const decoded = new TextDecoder().decode(canonicalize(obj));
    expect(decoded).toBe('{"a":null,"b":1}');
  });

  test("handles string values with special characters", () => {
    const obj = { msg: 'hello "world"' };
    const bytes = canonicalize(obj);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toContain('\\"world\\"');
  });

  test("is deterministic across multiple calls", () => {
    const obj = { foo: "bar", baz: 42, nested: { x: true } };
    const first = canonicalize(obj);
    const second = canonicalize(obj);
    expect(first).toEqual(second);
  });
});
