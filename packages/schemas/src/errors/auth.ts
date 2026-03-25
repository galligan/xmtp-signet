import type { SignetError } from "./base.js";

/** Raised when authentication or authorization fails. */
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

/** Raised when a credential has expired and can no longer be used. */
export class CredentialExpiredError extends Error implements SignetError {
  readonly _tag = "CredentialExpiredError" as const;
  readonly code = 1310;
  readonly category = "auth" as const;

  constructor(
    message: string,
    readonly context: { credentialId: string } & Record<string, unknown>,
  ) {
    super(message);
    this.name = "CredentialExpiredError";
  }

  static create(credentialId: string): CredentialExpiredError {
    return new CredentialExpiredError(
      `Credential '${credentialId}' has expired`,
      {
        credentialId,
      },
    );
  }
}
