import type { SignetError } from "./base.js";

export class AuthError extends Error implements SignetError {
  readonly _tag = "AuthError" as const;
  readonly code = 1300;
  readonly category = "auth" as const;

  constructor(
    message: string,
    readonly context: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = "AuthError";
  }

  static create(message: string, context?: Record<string, unknown>): AuthError {
    return new AuthError(message, context ?? null);
  }
}

export class SessionExpiredError extends Error implements SignetError {
  readonly _tag = "SessionExpiredError" as const;
  readonly code = 1310;
  readonly category = "auth" as const;

  constructor(
    message: string,
    readonly context: { sessionId: string } & Record<string, unknown>,
  ) {
    super(message);
    this.name = "SessionExpiredError";
  }

  static create(sessionId: string): SessionExpiredError {
    return new SessionExpiredError(`Session '${sessionId}' has expired`, {
      sessionId,
    });
  }
}
