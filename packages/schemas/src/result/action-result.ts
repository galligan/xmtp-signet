import { z } from "zod";
import type { ErrorCategory } from "../errors/category.js";
import { ErrorCategory as ErrorCategorySchema } from "../errors/category.js";

// -- ActionResultMeta --

/** Response metadata present on every ActionResult envelope. */
export type ActionResultMeta = {
  requestId: string;
  timestamp: string;
  durationMs: number;
};

const _ActionResultMetaSchema = z
  .object({
    requestId: z.string().describe("Correlates with HandlerContext.requestId"),
    timestamp: z
      .string()
      .datetime()
      .describe("ISO 8601 timestamp of response creation"),
    durationMs: z
      .number()
      .nonnegative()
      .describe("Handler execution time in milliseconds"),
  })
  .describe("Response metadata present on every ActionResult");

/**
 * Response metadata present on every ActionResult envelope.
 * Correlates responses to requests and provides timing information.
 */
export const ActionResultMetaSchema: z.ZodType<ActionResultMeta> =
  _ActionResultMetaSchema;

// -- ActionError --

/** Error detail in a failed ActionResult. Serializable subset of SignetError. */
export type ActionError = {
  _tag: string;
  category: ErrorCategory;
  message: string;
  context: Record<string, unknown> | null;
};

const _ActionErrorSchema = z
  .object({
    _tag: z.string().describe("Error discriminant (e.g., 'ValidationError')"),
    category: ErrorCategorySchema.describe(
      "Error category for cross-transport mapping",
    ),
    message: z.string().describe("Human-readable error description"),
    context: z
      .record(z.string(), z.unknown())
      .nullable()
      .describe("Structured error context, null if none"),
  })
  .describe("Error detail in a failed ActionResult");

/**
 * Error detail in a failed ActionResult. Maps SignetError fields
 * to a serializable shape for transport rendering.
 */
export const ActionErrorSchema: z.ZodType<ActionError> = _ActionErrorSchema;

// -- Pagination --

/** Pagination metadata for list operations. */
export type Pagination = {
  count: number;
  hasMore: boolean;
  nextCursor?: string | undefined;
  total?: number | undefined;
};

const _PaginationSchema = z
  .object({
    count: z
      .number()
      .int()
      .nonnegative()
      .describe("Number of items in this page"),
    hasMore: z.boolean().describe("Whether more items exist beyond this page"),
    nextCursor: z
      .string()
      .optional()
      .describe("Opaque cursor for the next page"),
    total: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Total item count, if known"),
  })
  .describe("Pagination metadata for list operations");

/**
 * Pagination metadata for list operations.
 */
export const PaginationSchema: z.ZodType<Pagination> = _PaginationSchema;

// -- ActionResultSchema (factory) --

/**
 * Factory function that creates a success ActionResult schema
 * for a given data type. Used by transport adapters to validate
 * outgoing envelopes.
 */
export function ActionResultSchema<T extends z.ZodType>(
  dataSchema: T,
): z.ZodObject<{
  ok: z.ZodLiteral<true>;
  data: T;
  meta: z.ZodType<ActionResultMeta>;
  pagination: z.ZodOptional<z.ZodType<Pagination>>;
}> {
  return z.object({
    ok: z.literal(true),
    data: dataSchema,
    meta: _ActionResultMetaSchema,
    pagination: _PaginationSchema.optional(),
  });
}

// -- ActionErrorResultSchema --

/** A failed ActionResult envelope with error detail and metadata. */
export type ActionErrorResult = {
  ok: false;
  error: ActionError;
  meta: ActionResultMeta;
};

/**
 * Schema for a failed ActionResult envelope.
 */
export const ActionErrorResultSchema: z.ZodType<ActionErrorResult> = z.object({
  ok: z.literal(false),
  error: _ActionErrorSchema,
  meta: _ActionResultMetaSchema,
});
