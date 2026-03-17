import type { Result } from "better-result";
import type {
  SignetError,
  ActionResultMeta,
  ActionError,
  Pagination,
} from "@xmtp/signet-schemas";

/**
 * Universal output envelope. All transports render from this shape.
 */
export type ActionResult<T> =
  | {
      readonly ok: true;
      readonly data: T;
      readonly meta: ActionResultMeta;
      readonly pagination?: Pagination;
    }
  | {
      readonly ok: false;
      readonly error: ActionError;
      readonly meta: ActionResultMeta;
    };

/**
 * Convert a handler Result into an ActionResult envelope.
 * Called by transport adapters after handler execution.
 */
export function toActionResult<T>(
  result: Result<T, SignetError>,
  meta: ActionResultMeta,
  pagination?: Pagination,
): ActionResult<T> {
  if (result.isOk()) {
    const envelope: ActionResult<T> = {
      ok: true,
      data: result.value,
      meta,
    };
    if (pagination !== undefined) {
      return { ...envelope, pagination } as ActionResult<T>;
    }
    return envelope;
  }

  const error = result.error;
  return {
    ok: false,
    error: {
      _tag: error._tag,
      category: error.category,
      message: error.message,
      context: error.context,
    },
    meta,
  };
}
