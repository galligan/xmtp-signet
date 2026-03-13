import type { Result } from "better-result";
import type { InternalError } from "@xmtp-broker/schemas";
import type { VerificationCheck } from "../schemas/check.js";
import type { VerificationRequest } from "../schemas/request.js";

/**
 * Each verification check is an independent handler.
 * Checks are stateless and composable.
 */
export interface CheckHandler {
  readonly checkId: string;
  execute(
    request: VerificationRequest,
  ): Promise<Result<VerificationCheck, InternalError>>;
}
