import { z } from "zod";
import type { ErrorCategory } from "./errors/index.js";
import { ErrorCategory as ErrorCategorySchema } from "./errors/index.js";

export type RequestSuccess = {
  ok: true;
  requestId: string;
  data?: unknown;
};

const _RequestSuccess = z
  .object({
    ok: z.literal(true).describe("Success indicator"),
    requestId: z.string().describe("Correlates with the original request"),
    data: z.unknown().describe("Response payload, type depends on request"),
  })
  .describe("Successful response to a harness request");

export const RequestSuccess: z.ZodType<RequestSuccess> = _RequestSuccess;

export type RequestFailure = {
  ok: false;
  requestId: string;
  error: {
    code: number;
    category: ErrorCategory;
    message: string;
    context: Record<string, unknown> | null;
  };
};

const _RequestFailure = z
  .object({
    ok: z.literal(false).describe("Failure indicator"),
    requestId: z.string().describe("Correlates with the original request"),
    error: z
      .object({
        code: z.number().int().describe("Numeric error code"),
        category: ErrorCategorySchema.describe("Error category from taxonomy"),
        message: z.string().describe("Human-readable error description"),
        context: z
          .record(z.string(), z.unknown())
          .nullable()
          .describe("Structured error context for debugging"),
      })
      .describe("Error details"),
  })
  .describe("Failed response to a harness request");

export const RequestFailure: z.ZodType<RequestFailure> = _RequestFailure;

export type RequestResponse = RequestSuccess | RequestFailure;

export const RequestResponse: z.ZodType<RequestResponse> = z
  .discriminatedUnion("ok", [_RequestSuccess, _RequestFailure])
  .describe("Response envelope for harness requests");
