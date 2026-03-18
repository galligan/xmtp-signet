import type { SignetError } from "./base.js";

/** Raised when an unexpected invariant or internal state fails. */
export class InternalError extends Error implements SignetError {
  readonly _tag = "InternalError" as const;
  readonly code = 1400;
  readonly category = "internal" as const;

  constructor(
    message: string,
    readonly context: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = "InternalError";
  }

  static create(
    message: string,
    context?: Record<string, unknown>,
  ): InternalError {
    return new InternalError(message, context ?? null);
  }
}
