import { describe, expect, it } from "bun:test";
import { Ok, Err } from "better-result";
import { z } from "zod";
import {
  ValidationError,
  NotFoundError,
  ActionResultSchema,
  ActionErrorResultSchema,
} from "@xmtp/signet-schemas";
import type { ActionResultMeta } from "@xmtp/signet-schemas";
import { toActionResult } from "../result-envelope.js";

function validMeta(): ActionResultMeta {
  return {
    requestId: "req-001",
    timestamp: "2026-01-15T12:00:00Z",
    durationMs: 5,
  };
}

describe("toActionResult", () => {
  it("wraps a success Result correctly", () => {
    const result = new Ok({ sessions: [] });
    const envelope = toActionResult(result, validMeta());

    expect(envelope.ok).toBe(true);
    if (envelope.ok) {
      expect(envelope.data).toEqual({ sessions: [] });
      expect(envelope.meta.requestId).toBe("req-001");
      expect(envelope.pagination).toBeUndefined();
    }
  });

  it("wraps an error Result correctly", () => {
    const error = ValidationError.create("groupId", "required");
    const result = new Err(error);
    const envelope = toActionResult(result, validMeta());

    expect(envelope.ok).toBe(false);
    if (!envelope.ok) {
      expect(envelope.error._tag).toBe("ValidationError");
      expect(envelope.error.category).toBe("validation");
      expect(envelope.error.message).toContain("groupId");
      expect(envelope.error.context).toEqual(
        expect.objectContaining({ field: "groupId" }),
      );
    }
  });

  it("includes pagination when provided", () => {
    const result = new Ok(["item1", "item2"]);
    const pagination = {
      count: 2,
      hasMore: true,
      nextCursor: "cursor-abc",
    };
    const envelope = toActionResult(result, validMeta(), pagination);

    expect(envelope.ok).toBe(true);
    if (envelope.ok) {
      expect(envelope.pagination).toEqual(pagination);
    }
  });

  it("omits pagination when not provided", () => {
    const result = new Ok([]);
    const envelope = toActionResult(result, validMeta());

    expect(envelope.ok).toBe(true);
    if (envelope.ok) {
      expect(envelope.pagination).toBeUndefined();
    }
  });

  it("meta fields present on success envelope", () => {
    const result = new Ok("data");
    const envelope = toActionResult(result, validMeta());

    expect(envelope.meta.requestId).toBe("req-001");
    expect(envelope.meta.timestamp).toBe("2026-01-15T12:00:00Z");
    expect(envelope.meta.durationMs).toBe(5);
  });

  it("meta fields present on error envelope", () => {
    const error = NotFoundError.create("session", "s-123");
    const result = new Err(error);
    const envelope = toActionResult(result, validMeta());

    expect(envelope.meta.requestId).toBe("req-001");
    expect(envelope.meta.timestamp).toBe("2026-01-15T12:00:00Z");
    expect(envelope.meta.durationMs).toBe(5);
  });
});

describe("ActionResult schema validation", () => {
  const TestSchema = ActionResultSchema(z.array(z.string()));

  it("success envelope validates against schema", () => {
    const result = new Ok(["s1", "s2"]);
    const envelope = toActionResult(result, validMeta());
    const parsed = TestSchema.safeParse(envelope);

    expect(parsed.success).toBe(true);
  });

  it("success envelope with pagination validates", () => {
    const result = new Ok(["s1"]);
    const pagination = { count: 1, hasMore: false };
    const envelope = toActionResult(result, validMeta(), pagination);
    const parsed = TestSchema.safeParse(envelope);

    expect(parsed.success).toBe(true);
  });

  it("error envelope validates against ActionErrorResultSchema", () => {
    const error = ValidationError.create("field", "bad");
    const result = new Err(error);
    const envelope = toActionResult(result, validMeta());
    const parsed = ActionErrorResultSchema.safeParse(envelope);

    expect(parsed.success).toBe(true);
  });
});
