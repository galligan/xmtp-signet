import { describe, test, expect } from "bun:test";
import {
  JsonRpcRequestSchema,
  JsonRpcSuccessSchema,
  JsonRpcErrorSchema,
  AdminAuthFrameSchema,
  JsonRpcNotificationSchema,
} from "../admin/protocol.js";

describe("AdminAuthFrameSchema", () => {
  test("validates a well-formed auth frame", () => {
    const result = AdminAuthFrameSchema.safeParse({
      type: "admin_auth",
      token: "eyJhbGciOiJFZERTQSJ9.payload.signature",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("admin_auth");
      expect(result.data.token).toBe("eyJhbGciOiJFZERTQSJ9.payload.signature");
    }
  });

  test("rejects frame with missing token", () => {
    const result = AdminAuthFrameSchema.safeParse({
      type: "admin_auth",
    });
    expect(result.success).toBe(false);
  });

  test("rejects frame with wrong type", () => {
    const result = AdminAuthFrameSchema.safeParse({
      type: "other",
      token: "jwt-token",
    });
    expect(result.success).toBe(false);
  });
});

describe("JsonRpcRequestSchema", () => {
  test("validates a well-formed request", () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: "2.0",
      id: 1,
      method: "session.list",
      params: { limit: 10 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.jsonrpc).toBe("2.0");
      expect(result.data.id).toBe(1);
      expect(result.data.method).toBe("session.list");
      expect(result.data.params).toEqual({ limit: 10 });
    }
  });

  test("accepts string id", () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: "2.0",
      id: "abc-123",
      method: "session.list",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("abc-123");
    }
  });

  test("defaults params to empty object when omitted", () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: "2.0",
      id: 1,
      method: "session.list",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.params).toEqual({});
    }
  });

  test("rejects missing jsonrpc version", () => {
    const result = JsonRpcRequestSchema.safeParse({
      id: 1,
      method: "session.list",
    });
    expect(result.success).toBe(false);
  });

  test("rejects wrong jsonrpc version", () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: "1.0",
      id: 1,
      method: "session.list",
    });
    expect(result.success).toBe(false);
  });
});

describe("JsonRpcSuccessSchema", () => {
  test("validates a success response", () => {
    const result = JsonRpcSuccessSchema.safeParse({
      jsonrpc: "2.0",
      id: 1,
      result: { ok: true, data: [], meta: {} },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(1);
    }
  });
});

describe("JsonRpcErrorSchema", () => {
  test("validates an error response", () => {
    const result = JsonRpcErrorSchema.safeParse({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32600,
        message: "Invalid Request",
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.error.code).toBe(-32600);
      expect(result.data.error.message).toBe("Invalid Request");
    }
  });

  test("validates error with data field", () => {
    const result = JsonRpcErrorSchema.safeParse({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32000,
        message: "Server error",
        data: { detail: "something broke" },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.error.data).toEqual({ detail: "something broke" });
    }
  });
});

describe("JsonRpcNotificationSchema", () => {
  test("validates a notification (no id)", () => {
    const result = JsonRpcNotificationSchema.safeParse({
      jsonrpc: "2.0",
      method: "stream.data",
      params: { content: "hello" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.method).toBe("stream.data");
    }
  });
});
