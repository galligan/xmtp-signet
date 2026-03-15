import type { BrokerError } from "./base.js";

export class NetworkError extends Error implements BrokerError {
  readonly _tag = "NetworkError" as const;
  readonly code = 1700;
  readonly category = "network" as const;

  constructor(
    message: string,
    readonly context: {
      endpoint: string;
    } & Record<string, unknown>,
  ) {
    super(message);
    this.name = "NetworkError";
  }

  static create(
    endpoint: string,
    reason: string,
    extra?: Record<string, unknown>,
  ): NetworkError {
    return new NetworkError(`Network error reaching '${endpoint}': ${reason}`, {
      endpoint,
      ...extra,
    });
  }
}
