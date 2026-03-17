import type { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import type { CoreContext } from "./core-types.js";

/**
 * Authentication context for admin callers. The admin key proves
 * the caller has root access to the signet.
 */
export interface AdminAuthContext {
  /** Fingerprint of the admin key used for authentication. */
  readonly adminKeyFingerprint: string;
}

/**
 * Canonical handler context. Extends CoreContext with cross-cutting
 * concerns needed by all handlers.
 */
export interface HandlerContext extends CoreContext {
  /** Unique identifier for this request. Used in ActionResult.meta and tracing. */
  readonly requestId: string;

  /** Cancellation signal. Handlers should check this for long operations. */
  readonly signal: AbortSignal;

  /**
   * Admin authentication context. Present when the caller is the signet
   * admin (CLI, local MCP). Absent for harness sessions.
   */
  readonly adminAuth?: AdminAuthContext;

  /**
   * Session identifier. Present when the caller is an authenticated
   * harness session. Absent for admin callers.
   */
  readonly sessionId?: string;
}

/**
 * Canonical handler type for all domain logic. Handlers receive
 * pre-validated input and a context object, and return a Result.
 * They never throw. Transport adapters (WebSocket, MCP, CLI, HTTP)
 * are thin wrappers that call handlers and translate the Result.
 */
export type Handler<
  TInput,
  TOutput,
  TError extends SignetError = SignetError,
> = (input: TInput, ctx: HandlerContext) => Promise<Result<TOutput, TError>>;
