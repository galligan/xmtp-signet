import type { SignetError } from "./base.js";

/** Raised when an operation is denied by policy or permissions. */
export class PermissionError extends Error implements SignetError {
  readonly _tag = "PermissionError" as const;
  readonly code = 1200;
  readonly category = "permission" as const;

  constructor(
    message: string,
    readonly context: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = "PermissionError";
  }

  static create(
    message: string,
    context?: Record<string, unknown>,
  ): PermissionError {
    return new PermissionError(message, context ?? null);
  }
}

/** Raised when a grant does not allow the requested operation. */
export class GrantDeniedError extends Error implements SignetError {
  readonly _tag = "GrantDeniedError" as const;
  readonly code = 1210;
  readonly category = "permission" as const;

  constructor(
    message: string,
    readonly context: {
      operation: string;
      grantType: string;
    } & Record<string, unknown>,
  ) {
    super(message);
    this.name = "GrantDeniedError";
  }

  static create(operation: string, grantType: string): GrantDeniedError {
    return new GrantDeniedError(
      `Operation '${operation}' denied: missing ${grantType} grant`,
      { operation, grantType },
    );
  }
}
