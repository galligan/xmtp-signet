import type { SignetEvent } from "@xmtp/signet-schemas";

/**
 * AsyncIterable event queue that receives events from the WebSocket
 * message handler and delivers them to harness consumers.
 */
export interface EventStream extends AsyncIterable<SignetEvent> {
  /** Push an event into the queue. */
  push(event: SignetEvent): void;
  /** Signal that no more events will arrive. */
  complete(): void;
}

/**
 * Create a new event stream backed by an async queue.
 * Events are buffered and delivered in order via async iteration.
 * The iterator completes when complete() is called and the buffer is drained.
 */
export function createEventStream(): EventStream {
  const buffer: SignetEvent[] = [];
  let done = false;
  let waiter: ((value: IteratorResult<SignetEvent>) => void) | null = null;

  function push(event: SignetEvent): void {
    if (done) return;
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve({ value: event, done: false });
    } else {
      buffer.push(event);
    }
  }

  function complete(): void {
    done = true;
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve({ value: undefined as unknown as SignetEvent, done: true });
    }
  }

  const asyncIterator: AsyncIterator<SignetEvent> = {
    next(): Promise<IteratorResult<SignetEvent>> {
      const buffered = buffer.shift();
      if (buffered !== undefined) {
        return Promise.resolve({ value: buffered, done: false });
      }
      if (done) {
        return Promise.resolve({
          value: undefined as unknown as SignetEvent,
          done: true,
        });
      }
      return new Promise((resolve) => {
        waiter = resolve;
      });
    },
  };

  return {
    push,
    complete,
    [Symbol.asyncIterator]() {
      return asyncIterator;
    },
  };
}
