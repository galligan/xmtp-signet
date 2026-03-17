import type { SignetError } from "@xmtp/signet-schemas";
import { TimeoutError } from "@xmtp/signet-schemas";
import { Result } from "better-result";

/** A pending request awaiting a response. */
export interface PendingRequest {
  readonly requestId: string;
  readonly resolve: (result: Result<unknown, SignetError>) => void;
  readonly timer: Timer;
}

/** Tracks in-flight requests by requestId with timeout. */
export interface RequestTracker {
  /** Register a new request. Returns a promise that resolves on response or timeout. */
  track(requestId: string): Promise<Result<unknown, SignetError>>;
  /** Resolve a pending request with a result. */
  resolve(requestId: string, result: Result<unknown, SignetError>): void;
  /** Reject all pending requests (e.g., on disconnect). */
  rejectAll(error: SignetError): void;
  /** Number of pending requests. */
  readonly pending: number;
}

/** Create a request tracker with the given timeout. */
export function createRequestTracker(timeoutMs: number): RequestTracker {
  const pending = new Map<string, PendingRequest>();

  return {
    track(requestId: string): Promise<Result<unknown, SignetError>> {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          resolve(Result.err(TimeoutError.create("request", timeoutMs)));
        }, timeoutMs);

        pending.set(requestId, { requestId, resolve, timer });
      });
    },

    resolve(requestId: string, result: Result<unknown, SignetError>): void {
      const entry = pending.get(requestId);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(requestId);
      entry.resolve(result);
    },

    rejectAll(error: SignetError): void {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.resolve(Result.err(error));
      }
      pending.clear();
    },

    get pending() {
      return pending.size;
    },
  };
}
