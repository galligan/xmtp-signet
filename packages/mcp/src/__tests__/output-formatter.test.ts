import { describe, test, expect } from "bun:test";
import type { ActionResult } from "@xmtp/signet-contracts";
import { formatActionResult } from "../output-formatter.js";

describe("formatActionResult", () => {
  const baseMeta = {
    requestId: "req_1",
    timestamp: "2024-01-01T00:00:00.000Z",
    durationMs: 42,
  };

  test("formats success ActionResult as MCP content with isError false", () => {
    const result: ActionResult<{ messageId: string }> = {
      ok: true,
      data: { messageId: "msg_1" },
      meta: baseMeta,
    };

    const formatted = formatActionResult(result);

    expect(formatted.isError).toBe(false);
    expect(formatted.content).toHaveLength(1);
    expect(formatted.content[0]?.type).toBe("text");

    const parsed = JSON.parse(formatted.content[0]?.text ?? "");
    expect(parsed.ok).toBe(true);
    expect(parsed.data.messageId).toBe("msg_1");
    expect(parsed.meta.requestId).toBe("req_1");
  });

  test("formats error ActionResult as MCP content with isError true", () => {
    const result: ActionResult<never> = {
      ok: false,
      error: {
        _tag: "ValidationError",
        category: "validation",
        message: "Invalid input",
        context: null,
      },
      meta: baseMeta,
    };

    const formatted = formatActionResult(result);

    expect(formatted.isError).toBe(true);
    expect(formatted.content).toHaveLength(1);

    const parsed = JSON.parse(formatted.content[0]?.text ?? "");
    expect(parsed.ok).toBe(false);
    expect(parsed.error.category).toBe("validation");
  });

  test("serializes full envelope as formatted JSON", () => {
    const result: ActionResult<{ data: number }> = {
      ok: true,
      data: { data: 42 },
      meta: baseMeta,
    };

    const formatted = formatActionResult(result);
    const text = formatted.content[0]?.text ?? "";

    // Should be formatted with indentation
    expect(text).toContain("\n");
    expect(text).toContain("  ");

    // Should round-trip through JSON.parse
    const parsed = JSON.parse(text);
    expect(parsed.data.data).toBe(42);
  });

  test("preserves error context in formatted output", () => {
    const result: ActionResult<never> = {
      ok: false,
      error: {
        _tag: "NotFoundError",
        category: "not_found",
        message: "Conversation not found",
        context: { resourceType: "conversation", resourceId: "conv_99" },
      },
      meta: baseMeta,
    };

    const formatted = formatActionResult(result);
    const parsed = JSON.parse(formatted.content[0]?.text ?? "");

    expect(parsed.error.context.resourceType).toBe("conversation");
    expect(parsed.error.context.resourceId).toBe("conv_99");
  });
});
