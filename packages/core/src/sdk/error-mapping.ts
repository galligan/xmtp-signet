import { Result } from "better-result";
import type { BrokerError } from "@xmtp-broker/schemas";
import {
  InternalError,
  NotFoundError,
  TimeoutError,
} from "@xmtp-broker/schemas";

/** Hints for classifying SDK errors into broker error types. */
export interface WrapSdkCallHints {
  /** If provided, "not found" errors become NotFoundError. */
  readonly resourceType?: string;
  /** If provided, "not found" errors include this ID. */
  readonly resourceId?: string;
  /** If provided, timeout errors include this duration. */
  readonly timeoutMs?: number;
}

const NOT_FOUND_PATTERNS = ["not found", "does not exist", "no such"] as const;

const TIMEOUT_PATTERNS = ["timed out", "timeout", "deadline exceeded"] as const;

function matchesAny(message: string, patterns: readonly string[]): boolean {
  const lower = message.toLowerCase();
  return patterns.some((p) => lower.includes(p));
}

/**
 * Wraps an async SDK call, converting exceptions to Result.err
 * with appropriate broker error types.
 */
export async function wrapSdkCall<T>(
  fn: () => Promise<T>,
  context: string,
  hints?: WrapSdkCallHints,
): Promise<Result<T, BrokerError>> {
  try {
    const value = await fn();
    return Result.ok(value);
  } catch (thrown: unknown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);

    if (matchesAny(message, NOT_FOUND_PATTERNS) && hints?.resourceType) {
      return Result.err(
        NotFoundError.create(hints.resourceType, hints.resourceId ?? "unknown"),
      );
    }

    if (matchesAny(message, TIMEOUT_PATTERNS)) {
      return Result.err(TimeoutError.create(context, hints?.timeoutMs ?? 0));
    }

    return Result.err(
      InternalError.create(`SDK error (${context}): ${message}`, {
        cause: message,
      }),
    );
  }
}
