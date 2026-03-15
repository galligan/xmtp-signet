import { describe, expect, test } from "bun:test";
import { formatOutput, type OutputFormatter } from "../output/formatter.js";

describe("formatOutput", () => {
  test("returns JSON string when json option is true", () => {
    const data = { name: "test", value: 42 };
    const result = formatOutput(data, { json: true });
    expect(result).toBe(JSON.stringify(data, null, 2));
  });

  test("returns JSON string when format is json", () => {
    const data = [{ id: 1 }, { id: 2 }];
    const result = formatOutput(data, { format: "json" });
    expect(result).toBe(JSON.stringify(data, null, 2));
  });

  test("returns plain string for text format", () => {
    const result = formatOutput("hello world", { format: "text" });
    expect(result).toBe("hello world");
  });

  test("returns table-formatted string for array of records", () => {
    const data = [
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ];
    const result = formatOutput(data, { format: "table" });
    // Table should contain column headers and values
    expect(result).toContain("name");
    expect(result).toContain("age");
    expect(result).toContain("Alice");
    expect(result).toContain("Bob");
    expect(result).toContain("30");
    expect(result).toContain("25");
  });

  test("defaults to text format for non-array data without json flag", () => {
    const data = { status: "running" };
    const result = formatOutput(data, {});
    // Without json flag, non-array data renders as key: value text
    expect(result).toContain("status");
    expect(result).toContain("running");
  });
});

describe("OutputFormatter", () => {
  let formatter: OutputFormatter;

  test("json method returns pretty-printed JSON", async () => {
    const { createOutputFormatter } = await import("../output/formatter.js");
    formatter = createOutputFormatter();
    const data = { key: "value" };
    expect(formatter.json(data)).toBe(JSON.stringify(data, null, 2));
  });

  test("text method returns the message as-is", async () => {
    const { createOutputFormatter } = await import("../output/formatter.js");
    formatter = createOutputFormatter();
    expect(formatter.text("hello")).toBe("hello");
  });

  test("table method formats records into aligned columns", async () => {
    const { createOutputFormatter } = await import("../output/formatter.js");
    formatter = createOutputFormatter();
    const data = [
      { id: "abc", status: "active" },
      { id: "def", status: "expired" },
    ];
    const result = formatter.table(data);
    expect(result).toContain("id");
    expect(result).toContain("status");
    expect(result).toContain("abc");
    expect(result).toContain("active");
  });

  test("table with column subset only shows specified columns", async () => {
    const { createOutputFormatter } = await import("../output/formatter.js");
    formatter = createOutputFormatter();
    const data = [{ id: "abc", status: "active", secret: "hidden" }];
    const result = formatter.table(data, ["id", "status"]);
    expect(result).toContain("id");
    expect(result).toContain("status");
    expect(result).not.toContain("secret");
    expect(result).not.toContain("hidden");
  });

  test("formatNdjsonLine returns single-line JSON with newline", async () => {
    const { formatNdjsonLine } = await import("../output/formatter.js");
    const data = { type: "message", text: "hi" };
    const result = formatNdjsonLine(data);
    expect(result).toBe(JSON.stringify(data) + "\n");
    expect(result.split("\n").length).toBe(2); // content + trailing empty
  });
});
