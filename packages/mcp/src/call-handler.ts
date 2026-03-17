import { Result } from "better-result";
import {
  ValidationError,
  NotFoundError,
  InternalError,
} from "@xmtp/signet-schemas";
import type { ActionResultMeta, SignetError } from "@xmtp/signet-schemas";
import type {
  ActionRegistry,
  ActionSpec,
  SignerProvider,
  SessionRecord,
} from "@xmtp/signet-contracts";
import { toActionResult } from "@xmtp/signet-contracts";
import type { McpContentResponse } from "./output-formatter.js";
import { formatActionResult } from "./output-formatter.js";
import { createHandlerContext } from "./context-factory.js";

/**
 * Parameters for call-handler context construction.
 */
export interface CallHandlerContext {
  readonly signetId: string;
  readonly signerProvider: SignerProvider;
  readonly sessionRecord: SessionRecord;
  readonly requestTimeoutMs: number;
}

/**
 * MCP CallTool request shape.
 */
export interface CallToolRequest {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

/**
 * Handle an MCP CallTool request.
 * Looks up the ActionSpec by tool name, validates input, invokes
 * the handler, and formats the result as MCP content.
 */
export async function handleCallTool(
  request: CallToolRequest,
  registry: ActionRegistry,
  ctx: CallHandlerContext,
): Promise<McpContentResponse> {
  const startTime = Date.now();

  // Find the spec by MCP tool name
  const spec = findSpecByToolName(request.name, registry);
  if (!spec) {
    return formatNotFound(request.name, startTime);
  }

  // Validate input against the spec's Zod schema
  const parseResult = spec.input.safeParse(request.arguments);
  if (!parseResult.success) {
    return formatValidationError(parseResult.error, startTime);
  }

  // Build handler context
  const handlerCtx = createHandlerContext({
    signetId: ctx.signetId,
    signerProvider: ctx.signerProvider,
    sessionId: ctx.sessionRecord.sessionId,
    requestTimeoutMs: ctx.requestTimeoutMs,
  });

  // Invoke the handler
  try {
    const result = await spec.handler(parseResult.data, handlerCtx);
    const actionResult = toActionResult(
      result,
      buildMeta(handlerCtx.requestId, startTime),
    );
    return formatActionResult(actionResult);
  } catch (error: unknown) {
    return formatInternalError(error, startTime, handlerCtx.requestId);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildMeta(requestId: string, startTime: number): ActionResultMeta {
  return {
    requestId,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
  };
}

function findSpecByToolName(
  toolName: string,
  registry: ActionRegistry,
): ActionSpec<unknown, unknown, SignetError> | undefined {
  const mcpSpecs = registry.listForSurface("mcp");
  return mcpSpecs.find((spec) => spec.mcp?.toolName === toolName);
}

function formatNotFound(
  toolName: string,
  startTime: number,
): McpContentResponse {
  const error = NotFoundError.create("tool", toolName);
  const result = toActionResult(
    Result.err(error),
    buildMeta("unknown", startTime),
  );
  return formatActionResult(result);
}

function formatValidationError(
  zodError: {
    issues: ReadonlyArray<{
      path: (string | number)[];
      message: string;
    }>;
  },
  startTime: number,
): McpContentResponse {
  const firstIssue = zodError.issues[0];
  const field = firstIssue?.path.join(".") ?? "unknown";
  const reason = firstIssue?.message ?? "Validation failed";
  const error = ValidationError.create(field, reason, {
    issues: zodError.issues,
  });
  const result = toActionResult(
    Result.err(error),
    buildMeta("unknown", startTime),
  );
  return formatActionResult(result);
}

function formatInternalError(
  error: unknown,
  startTime: number,
  requestId: string,
): McpContentResponse {
  const message = error instanceof Error ? error.message : "Unknown error";
  const internalError = InternalError.create(`Handler threw: ${message}`);
  const result = toActionResult(
    Result.err(internalError),
    buildMeta(requestId, startTime),
  );
  return formatActionResult(result);
}
