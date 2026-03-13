/**
 * In-memory sliding window rate limiter.
 * Tracks request timestamps per requester and rejects when the
 * count within the window exceeds the configured maximum.
 */
export interface RateLimiter {
  /** Returns true if the request is allowed, false if rate-limited. */
  check(requesterId: string): boolean;
  /** Reset all state (for testing). */
  reset(): void;
}

export interface RateLimiterConfig {
  readonly maxRequests: number;
  readonly windowMs: number;
  /** Injectable clock for testing. Defaults to Date.now. */
  readonly now?: () => number;
}

export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  const timestamps = new Map<string, number[]>();
  const getNow = config.now ?? Date.now;

  return {
    check(requesterId: string): boolean {
      const now = getNow();
      const windowStart = now - config.windowMs;

      const entries = timestamps.get(requesterId);
      if (entries === undefined) {
        timestamps.set(requesterId, [now]);
        return true;
      }

      // Evict entries outside the window
      const firstValid = entries.findIndex((t) => t >= windowStart);
      if (firstValid > 0) {
        entries.splice(0, firstValid);
      } else if (firstValid === -1 && entries.length > 0) {
        entries.length = 0;
      }

      // Reclaim memory for inactive requesters
      if (entries.length === 0) {
        timestamps.delete(requesterId);
        timestamps.set(requesterId, [now]);
        return true;
      }

      if (entries.length >= config.maxRequests) {
        return false;
      }

      entries.push(now);
      return true;
    },

    reset(): void {
      timestamps.clear();
    },
  };
}
