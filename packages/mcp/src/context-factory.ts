import type { HandlerContext, SignerProvider } from "@xmtp/signet-contracts";

/**
 * Parameters for building a HandlerContext for MCP callers.
 */
export interface ContextFactoryParams {
  readonly signetId: string;
  readonly signerProvider: SignerProvider;
  readonly sessionId: string;
  readonly requestTimeoutMs: number;
}

/**
 * Build a HandlerContext for an MCP tool call.
 * Session-scoped: includes sessionId, no adminAuth.
 */
export function createHandlerContext(
  params: ContextFactoryParams,
): HandlerContext {
  return {
    signetId: params.signetId,
    signerProvider: params.signerProvider,
    requestId: crypto.randomUUID(),
    signal: AbortSignal.timeout(params.requestTimeoutMs),
    sessionId: params.sessionId,
    // No adminAuth -- MCP is session-scoped, not admin
  };
}
