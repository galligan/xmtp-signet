import { z } from "zod";

/** Cross-transport error categories used for exit/status/JSON-RPC mapping. */
export const ErrorCategory: z.ZodEnum<
  [
    "validation",
    "not_found",
    "permission",
    "auth",
    "internal",
    "timeout",
    "cancelled",
    "network",
  ]
> = z
  .enum([
    "validation",
    "not_found",
    "permission",
    "auth",
    "internal",
    "timeout",
    "cancelled",
    "network",
  ])
  .describe("Error category for cross-transport mapping");

/** Cross-transport error categories used for exit/status/JSON-RPC mapping. */
export type ErrorCategory = z.infer<typeof ErrorCategory>;

/** Transport-specific metadata for an error category. */
export type ErrorCategoryMeta = {
  readonly exitCode: number;
  readonly statusCode: number;
  readonly jsonRpcCode: number;
  readonly retryable: boolean;
};

/** Zod schema for transport metadata attached to each error category. */
export const ErrorCategoryMetaSchema: z.ZodType<ErrorCategoryMeta> = z
  .object({
    exitCode: z.number().int(),
    statusCode: z.number().int(),
    jsonRpcCode: z.number().int(),
    retryable: z.boolean(),
  })
  .readonly()
  .describe("Cross-transport metadata for an error category");

/** Lookup table for category metadata. */
export const ERROR_CATEGORY_META: Record<ErrorCategory, ErrorCategoryMeta> = {
  validation: {
    exitCode: 1,
    statusCode: 400,
    jsonRpcCode: -32602,
    retryable: false,
  },
  not_found: {
    exitCode: 2,
    statusCode: 404,
    jsonRpcCode: -32007,
    retryable: false,
  },
  permission: {
    exitCode: 4,
    statusCode: 403,
    jsonRpcCode: -32003,
    retryable: false,
  },
  auth: {
    exitCode: 9,
    statusCode: 401,
    jsonRpcCode: -32000,
    retryable: false,
  },
  internal: {
    exitCode: 8,
    statusCode: 500,
    jsonRpcCode: -32603,
    retryable: false,
  },
  timeout: {
    exitCode: 5,
    statusCode: 504,
    jsonRpcCode: -32001,
    retryable: true,
  },
  cancelled: {
    exitCode: 130,
    statusCode: 499,
    jsonRpcCode: -32006,
    retryable: false,
  },
  network: {
    exitCode: 6,
    statusCode: 503,
    jsonRpcCode: -32002,
    retryable: true,
  },
};

/** Look up metadata for a given error category. */
export function errorCategoryMeta(category: ErrorCategory): ErrorCategoryMeta {
  return ERROR_CATEGORY_META[category];
}
