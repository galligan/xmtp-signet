import { describe, expect, test } from "bun:test";
import { CircularBuffer } from "../replay-buffer.js";

describe("CircularBuffer", () => {
  test("starts empty", () => {
    const buf = new CircularBuffer<number>(5);
    expect(buf.size).toBe(0);
    expect(buf.toArray()).toEqual([]);
  });

  test("push adds items up to capacity", () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.size).toBe(3);
    expect(buf.toArray()).toEqual([1, 2, 3]);
  });

  test("overwrites oldest when full", () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4);
    expect(buf.size).toBe(3);
    expect(buf.toArray()).toEqual([2, 3, 4]);
  });

  test("overwrites multiple rounds", () => {
    const buf = new CircularBuffer<number>(2);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4);
    buf.push(5);
    expect(buf.toArray()).toEqual([4, 5]);
  });

  test("itemsSince returns items after given predicate", () => {
    const buf = new CircularBuffer<{ seq: number; value: string }>(5);
    buf.push({ seq: 1, value: "a" });
    buf.push({ seq: 2, value: "b" });
    buf.push({ seq: 3, value: "c" });
    buf.push({ seq: 4, value: "d" });

    const result = buf.itemsSince((item) => item.seq > 2);
    expect(result).toEqual([
      { seq: 3, value: "c" },
      { seq: 4, value: "d" },
    ]);
  });

  test("itemsSince returns empty when nothing matches", () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    const result = buf.itemsSince((n) => n > 10);
    expect(result).toEqual([]);
  });

  test("itemsSince works after wrap-around", () => {
    const buf = new CircularBuffer<{ seq: number }>(3);
    buf.push({ seq: 1 });
    buf.push({ seq: 2 });
    buf.push({ seq: 3 });
    buf.push({ seq: 4 });
    buf.push({ seq: 5 });
    // Buffer now has [3, 4, 5]
    const result = buf.itemsSince((item) => item.seq > 3);
    expect(result).toEqual([{ seq: 4 }, { seq: 5 }]);
  });

  test("oldest returns the oldest item in buffer", () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(10);
    buf.push(20);
    buf.push(30);
    expect(buf.oldest()).toBe(10);
    buf.push(40);
    expect(buf.oldest()).toBe(20);
  });

  test("oldest returns undefined when empty", () => {
    const buf = new CircularBuffer<number>(3);
    expect(buf.oldest()).toBeUndefined();
  });

  test("clear empties the buffer", () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.toArray()).toEqual([]);
  });

  test("capacity returns configured capacity", () => {
    const buf = new CircularBuffer<number>(42);
    expect(buf.capacity).toBe(42);
  });
});
