import { describe, expect, test } from "bun:test";
import { wrapSdkCall } from "../sdk/error-mapping.js";

describe("wrapSdkCall", () => {
  test("wraps successful async function in Result.ok", async () => {
    const result = await wrapSdkCall(async () => 42, "test operation");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(42);
    }
  });

  test("wraps thrown error in Result.err with InternalError", async () => {
    const result = await wrapSdkCall(async () => {
      throw new Error("sdk blew up");
    }, "test operation");
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("InternalError");
      expect(result.error.message).toContain("sdk blew up");
      expect(result.error.message).toContain("test operation");
    }
  });

  test("maps 'not found' errors to NotFoundError", async () => {
    const result = await wrapSdkCall(
      async () => {
        throw new Error("conversation not found");
      },
      "getGroupInfo",
      { resourceType: "group", resourceId: "group-123" },
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("NotFoundError");
    }
  });

  test("maps timeout errors to TimeoutError", async () => {
    const result = await wrapSdkCall(
      async () => {
        throw new Error("operation timed out");
      },
      "syncAll",
      { timeoutMs: 5000 },
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("TimeoutError");
    }
  });

  test("handles non-Error thrown values", async () => {
    const result = await wrapSdkCall(async () => {
      throw "string error";
    }, "test operation");
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("InternalError");
      expect(result.error.message).toContain("string error");
    }
  });

  test("returns void Result for void functions", async () => {
    const result = await wrapSdkCall(async () => {}, "void operation");
    expect(result.isOk()).toBe(true);
  });
});
