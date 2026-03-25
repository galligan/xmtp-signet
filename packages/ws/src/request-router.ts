import type { Result } from "better-result";
import type {
  HarnessRequest,
  RequestResponse,
  SignetError,
} from "@xmtp/signet-schemas";
import type { CredentialRecord } from "@xmtp/signet-contracts";

/**
 * Callback to handle a validated harness request.
 * Injected by the server -- the router doesn't know about
 * core/policy/credentials directly.
 */
export type RequestHandler = (
  request: HarnessRequest,
  credential: CredentialRecord,
) => Promise<Result<unknown, SignetError>>;

/**
 * Routes a parsed request through the handler and converts
 * the Result into a RequestResponse envelope.
 */
export async function routeRequest(
  request: HarnessRequest,
  credential: CredentialRecord,
  handler: RequestHandler,
): Promise<RequestResponse> {
  const result = await handler(request, credential);

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
