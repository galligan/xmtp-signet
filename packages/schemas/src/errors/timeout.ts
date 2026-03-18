import type { SignetError } from "./base.js";

/** Raised when an operation exceeds its configured deadline. */
export class TimeoutError extends Error implements SignetError {
  readonly _tag = "TimeoutError" as const;
  readonly code = 1500;
  readonly category = "timeout" as const;

  constructor(
    message: string,
    readonly context: {
      operation: string;
      timeoutMs: number;
    } & Record<string, unknown>,
  ) {
    super(message);
    this.name = "TimeoutError";
  }

  static create(operation: string, timeoutMs: number): TimeoutError {
    return new TimeoutError(
      `Operation '${operation}' timed out after ${timeoutMs}ms`,
      { operation, timeoutMs },
    );
  }
}
