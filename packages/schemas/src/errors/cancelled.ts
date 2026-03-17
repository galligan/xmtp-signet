import type { SignetError } from "./base.js";

export class CancelledError extends Error implements SignetError {
  readonly _tag = "CancelledError" as const;
  readonly code = 1600;
  readonly category = "cancelled" as const;

  constructor(
    message: string,
    readonly context: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = "CancelledError";
  }

  static create(message: string): CancelledError {
    return new CancelledError(message, null);
  }
}
