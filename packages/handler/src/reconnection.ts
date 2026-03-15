/** Non-retryable close codes -- auth failures that won't succeed on retry. */
const NON_RETRYABLE_CODES = new Set([4001, 4002, 4004, 4009]);

/** Check if a close code is retryable. */
export function isRetryable(code: number): boolean {
  return !NON_RETRYABLE_CODES.has(code);
}

/** Configuration for reconnection backoff. */
export interface ReconnectConfig {
  readonly enabled: boolean;
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitter: boolean;
}

/**
 * Calculate the delay for a given reconnection attempt.
 * Uses exponential backoff: min(baseDelayMs * 2^attempt, maxDelayMs)
 * With optional full jitter: random(0, delay).
 */
export function calculateDelay(
  attempt: number,
  config: ReconnectConfig,
): number {
  const exponential = config.baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, config.maxDelayMs);
  if (config.jitter) {
    return Math.floor(Math.random() * (capped + 1));
  }
  return capped;
}

/** Tracks reconnection state. */
export interface ReconnectionTracker {
  /** Current attempt number. */
  readonly attempt: number;
  /** Whether max attempts have been exceeded. */
  readonly exhausted: boolean;
  /** Get delay for next attempt and increment counter. */
  nextDelay(): number;
  /** Reset attempt counter (on successful reconnect). */
  reset(): void;
}

/** Create a reconnection tracker with the given config. */
export function createReconnectionTracker(
  config: ReconnectConfig,
): ReconnectionTracker {
  let attempt = 0;

  return {
    get attempt() {
      return attempt;
    },
    get exhausted() {
      if (config.maxAttempts === 0) return false;
      return attempt >= config.maxAttempts;
    },
    nextDelay() {
      const delay = calculateDelay(attempt, config);
      attempt += 1;
      return delay;
    },
    reset() {
      attempt = 0;
    },
  };
}
