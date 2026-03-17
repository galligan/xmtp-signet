import { z } from "zod";

// ---------------------------------------------------------------------------
// Admin auth frame (client -> server, first message)
// ---------------------------------------------------------------------------

/** Admin authentication frame sent as the first message on a connection. */
export type AdminAuthFrame = {
  type: "admin_auth";
  token: string;
};

/**
 * Admin authentication frame sent as the first message on a new connection.
 * The token is an EdDSA-signed JWT from the admin key (spec 12).
 */
export const AdminAuthFrameSchema: z.ZodType<AdminAuthFrame> = z
  .object({
    type: z.literal("admin_auth"),
    token: z.string().describe("Admin JWT (EdDSA-signed, from spec 12)"),
  })
  .describe("Admin authentication frame");

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 request
// ---------------------------------------------------------------------------

/** JSON-RPC 2.0 request sent after authentication. */
export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params: Record<string, unknown>;
};

/**
 * JSON-RPC 2.0 request. Sent by the client after authentication.
 */
export const JsonRpcRequestSchema: z.ZodType<
  JsonRpcRequest,
  z.ZodTypeDef,
  {
    jsonrpc: "2.0";
    id: number | string;
    method: string;
    params?: Record<string, unknown> | undefined;
  }
> = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.number(), z.string()]),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
});

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 success response
// ---------------------------------------------------------------------------

/** JSON-RPC 2.0 success response. */
export type JsonRpcSuccess = {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
};

/**
 * JSON-RPC 2.0 success response. Server -> client.
 */
export const JsonRpcSuccessSchema: z.ZodType<JsonRpcSuccess> = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.number(), z.string()]),
  result: z.unknown(),
});

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 error response
// ---------------------------------------------------------------------------

/** Structured error object inside a JSON-RPC error response. */
export type JsonRpcErrorDetail = {
  code: number;
  message: string;
  data?: unknown;
};

/** JSON-RPC 2.0 error response. */
export type JsonRpcError = {
  jsonrpc: "2.0";
  id: number | string | null;
  error: JsonRpcErrorDetail;
};

/**
 * JSON-RPC 2.0 error response. Server -> client.
 */
export const JsonRpcErrorSchema: z.ZodType<JsonRpcError> = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.number(), z.string(), z.null()]),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
});

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 notification (streaming)
// ---------------------------------------------------------------------------

/** JSON-RPC 2.0 notification (no id, no response expected). */
export type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown> | undefined;
};

/**
 * JSON-RPC 2.0 notification (no id, no response expected).
 * Used for streaming responses.
 */
export const JsonRpcNotificationSchema: z.ZodType<JsonRpcNotification> =
  z.object({
    jsonrpc: z.literal("2.0"),
    method: z.string(),
    params: z.record(z.string(), z.unknown()).optional(),
  });

// ---------------------------------------------------------------------------
// JSON-RPC error codes
// ---------------------------------------------------------------------------

/** Standard JSON-RPC 2.0 error codes and signet extensions. */
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  /** Custom: authentication failed. */
  AUTH_FAILED: -32000,
  /** Custom: permission denied. */
  PERMISSION_DENIED: -32001,
  /** Custom: not found. */
  NOT_FOUND: -32002,
} as const;

// Re-export the AdminJwtPayload type for convenience
export type { AdminJwtPayload } from "@xmtp/signet-keys";
