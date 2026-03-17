import { Result } from "better-result";
import type { InternalError } from "@xmtp/signet-schemas";
import type { VerificationCheck } from "../schemas/check.js";
import type { VerificationRequest } from "../schemas/request.js";
import type { CheckHandler } from "./handler.js";

export const SOURCE_AVAILABLE_CHECK_ID = "source_available" as const;

export interface SourceAvailableConfig {
  /** Injectable fetch for testing. Defaults to global fetch. */
  readonly fetcher?: typeof fetch;
  /** Timeout in milliseconds. Defaults to 10000. */
  readonly timeoutMs?: number;
}

/**
 * Checks that the agent's source code repository is accessible.
 * v0: performs an HTTP GET against sourceRepoUrl, expects 200.
 */
export function createSourceAvailableCheck(
  config?: SourceAvailableConfig,
): CheckHandler {
  const fetcher = config?.fetcher ?? fetch;
  const timeoutMs = config?.timeoutMs ?? 10_000;

  return {
    checkId: SOURCE_AVAILABLE_CHECK_ID,

    async execute(
      request: VerificationRequest,
    ): Promise<Result<VerificationCheck, InternalError>> {
      const startTime = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetcher(request.sourceRepoUrl, {
          method: "GET",
          signal: controller.signal,
          redirect: "follow",
        });

        const elapsed = Date.now() - startTime;
        const check: VerificationCheck = {
          checkId: SOURCE_AVAILABLE_CHECK_ID,
          verdict: response.ok ? "pass" : "fail",
          reason: response.ok
            ? `Source repository accessible (HTTP ${String(response.status)})`
            : `Source repository returned HTTP ${String(response.status)}`,
          evidence: {
            url: request.sourceRepoUrl,
            statusCode: response.status,
            responseTimeMs: elapsed,
          },
        };

        return Result.ok(check);
      } catch (error) {
        const elapsed = Date.now() - startTime;
        const message = error instanceof Error ? error.message : String(error);
        const check: VerificationCheck = {
          checkId: SOURCE_AVAILABLE_CHECK_ID,
          verdict: "fail",
          reason: `Source repository unreachable: ${message}`,
          evidence: {
            url: request.sourceRepoUrl,
            responseTimeMs: elapsed,
            error: message,
          },
        };

        return Result.ok(check);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
