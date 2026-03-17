import { ERROR_CATEGORY_META, type ErrorCategory } from "@xmtp/signet-schemas";

/** Successful exit. */
export const EXIT_SUCCESS = 0;

/**
 * Map an error category to a CLI exit code.
 * Uses ERROR_CATEGORY_META from @xmtp/signet-schemas as the single source of truth.
 * Falls back to the internal error exit code for unknown categories.
 */
export function exitCodeFromCategory(category: ErrorCategory): number {
  const meta =
    ERROR_CATEGORY_META[category as keyof typeof ERROR_CATEGORY_META];
  if (meta !== undefined) {
    return meta.exitCode;
  }
  // Unknown category falls back to internal
  return ERROR_CATEGORY_META.internal.exitCode;
}
