import type { CoreRawEvent, RawEventHandler } from "./raw-events.js";

/**
 * Typed event emitter for core raw events.
 *
 * Subscribers are called synchronously in registration order.
 * A throwing subscriber does not prevent delivery to subsequent subscribers.
 */
export class CoreEventEmitter {
  readonly #handlers = new Set<RawEventHandler>();

  /** Subscribe to all raw events. Returns an unsubscribe function. */
  on(handler: RawEventHandler): () => void {
    this.#handlers.add(handler);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      this.#handlers.delete(handler);
    };
  }

  /** Emit an event to all subscribers. */
  emit(event: CoreRawEvent): void {
    for (const handler of this.#handlers) {
      try {
        handler(event);
      } catch {
        // Subscriber errors are swallowed to prevent cascade failures.
        // In production, these would be logged.
      }
    }
  }

  /** Remove all subscribers. */
  removeAll(): void {
    this.#handlers.clear();
  }

  /** Number of active subscribers. */
  get listenerCount(): number {
    return this.#handlers.size;
  }
}
