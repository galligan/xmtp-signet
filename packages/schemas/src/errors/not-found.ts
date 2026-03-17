import type { SignetError } from "./base.js";

export class NotFoundError extends Error implements SignetError {
  readonly _tag = "NotFoundError" as const;
  readonly code = 1100;
  readonly category = "not_found" as const;

  constructor(
    message: string,
    readonly context: {
      resourceType: string;
      resourceId: string;
    } & Record<string, unknown>,
  ) {
    super(message);
    this.name = "NotFoundError";
  }

  static create(resourceType: string, resourceId: string): NotFoundError {
    return new NotFoundError(`${resourceType} '${resourceId}' not found`, {
      resourceType,
      resourceId,
    });
  }
}
