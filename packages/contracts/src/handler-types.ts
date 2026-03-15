import type { Result } from "better-result";
import type { BrokerError } from "@xmtp-broker/schemas";
import type { CoreContext } from "./core-types.js";

/**
 * Canonical handler context. Extends CoreContext with any additional
 * context fields handlers may need. Currently identical to CoreContext;
 * adding fields here (e.g., sessionId, requestId, AbortSignal) allows
 * all handlers to pick them up without changing their signatures.
 */
export interface HandlerContext extends CoreContext {}

/**
 * Canonical handler type for all domain logic. Handlers receive
 * pre-validated input and a context object, and return a Result.
 * They never throw. Transport adapters (WebSocket, MCP, CLI, HTTP)
 * are thin wrappers that call handlers and translate the Result.
 */
export type Handler<
  TInput,
  TOutput,
  TError extends BrokerError = BrokerError,
> = (input: TInput, ctx: HandlerContext) => Promise<Result<TOutput, TError>>;
