import type { Result } from "better-result";
import type {
  HarnessRequest,
  RequestResponse,
  BrokerError,
} from "@xmtp-broker/schemas";
import type { SessionRecord } from "@xmtp-broker/contracts";

/**
 * Callback to handle a validated harness request.
 * Injected by the server -- the router doesn't know about
 * core/policy/sessions directly.
 */
export type RequestHandler = (
  request: HarnessRequest,
  session: SessionRecord,
) => Promise<Result<unknown, BrokerError>>;

/**
 * Routes a parsed request through the handler and converts
 * the Result into a RequestResponse envelope.
 */
export async function routeRequest(
  request: HarnessRequest,
  session: SessionRecord,
  handler: RequestHandler,
): Promise<RequestResponse> {
  const result = await handler(request, session);

  if (result.isOk()) {
    return {
      ok: true,
      requestId: request.requestId,
      data: result.value,
    };
  }

  const error = result.error;
  return {
    ok: false,
    requestId: request.requestId,
    error: {
      code: error.code,
      category: error.category,
      message: error.message,
      context: error.context,
    },
  };
}
