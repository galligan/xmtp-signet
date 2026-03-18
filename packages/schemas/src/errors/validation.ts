import type { SignetError } from "./base.js";

/** Validation failure for an invalid request or field value. */
export class ValidationError extends Error implements SignetError {
  readonly _tag = "ValidationError" as const;
  readonly code = 1000;
  readonly category = "validation" as const;

  constructor(
    message: string,
    readonly context: { field: string; reason: string } & Record<
      string,
      unknown
    >,
  ) {
    super(message);
    this.name = "ValidationError";
  }

  static create(
    field: string,
    reason: string,
    extra?: Record<string, unknown>,
  ): ValidationError {
    return new ValidationError(`Validation failed on '${field}': ${reason}`, {
      field,
      reason,
      ...extra,
    });
  }
}

/** Validation failure for a seal-specific invariant. */
export class SealError extends Error implements SignetError {
  readonly _tag = "SealError" as const;
  readonly code = 1010;
  readonly category = "validation" as const;

  constructor(
    message: string,
    readonly context: { sealId: string } & Record<string, unknown>,
  ) {
    super(message);
    this.name = "SealError";
  }

  static create(sealId: string, reason: string): SealError {
    return new SealError(`Seal '${sealId}': ${reason}`, {
      sealId,
      reason,
    });
  }
}
