import type {
  ActionRegistry,
  ActionResult,
  ActionSpec,
  HandlerContext,
} from "@xmtp/signet-contracts";
import { toActionResult } from "@xmtp/signet-contracts";
import type { SignetError, ActionResultMeta } from "@xmtp/signet-schemas";
import {
  InternalError,
  NotFoundError,
  ValidationError,
} from "@xmtp/signet-schemas";
import { Result } from "better-result";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Dispatches JSON-RPC method calls to ActionSpec handlers via the
 * shared ActionRegistry. Maps RPC method names to ActionSpecs using
 * CliSurface.rpcMethod (or derives from CliSurface.command).
 */
export interface AdminDispatcher {
  /** Route a JSON-RPC method call to the matching ActionSpec handler. */
  dispatch(
    method: string,
    params: Record<string, unknown>,
    ctx: HandlerContext,
  ): Promise<ActionResult<unknown>>;

  /** Check whether a method name is registered. */
  hasMethod(method: string): boolean;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Build a lookup map from RPC method name to ActionSpec.
 * If rpcMethod is not set, derive it from command by replacing : with .
 */
function buildMethodMap(
  registry: ActionRegistry,
): Map<string, ActionSpec<unknown, unknown, SignetError>> {
  const map = new Map<string, ActionSpec<unknown, unknown, SignetError>>();

  for (const spec of registry.listForSurface("cli")) {
    const cli = spec.cli;
    if (cli === undefined) continue;

    const rpcMethod = cli.rpcMethod ?? cli.command.replace(/:/g, ".");
    map.set(rpcMethod, spec);
  }

  return map;
}

function makeMeta(ctx: HandlerContext, startMs: number): ActionResultMeta {
  return {
    requestId: ctx.requestId,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startMs,
  };
}

/**
 * Create an AdminDispatcher that routes JSON-RPC methods to ActionSpecs
 * via the shared ActionRegistry.
 */
export function createAdminDispatcher(
  registry: ActionRegistry,
): AdminDispatcher {
  const methodMap = buildMethodMap(registry);

  return {
    async dispatch(
      method: string,
      params: Record<string, unknown>,
      ctx: HandlerContext,
    ): Promise<ActionResult<unknown>> {
      const startMs = Date.now();
      const spec = methodMap.get(method);

      if (spec === undefined) {
        return toActionResult(
          Result.err(NotFoundError.create("Method", method)),
          makeMeta(ctx, startMs),
        );
      }

      // Validate input against spec's Zod schema
      const parseResult = spec.input.safeParse(params);
      if (!parseResult.success) {
        const issues = parseResult.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        return toActionResult(
          Result.err(ValidationError.create("params", issues)),
          makeMeta(ctx, startMs),
        );
      }

      // Call the handler -- catch unexpected throws and wrap as InternalError
      let result: Awaited<ReturnType<typeof spec.handler>>;
      try {
        result = await spec.handler(parseResult.data, ctx);
      } catch (thrown: unknown) {
        const message =
          thrown instanceof Error ? thrown.message : String(thrown);
        return toActionResult(
          Result.err(InternalError.create(`Handler threw: ${message}`)),
          makeMeta(ctx, startMs),
        );
      }
      return toActionResult(result, makeMeta(ctx, startMs));
    },

    hasMethod(method: string): boolean {
      return methodMap.has(method);
    },
  };
}
