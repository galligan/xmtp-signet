import type { BrokerEvent } from "@xmtp-broker/schemas";

/**
 * AsyncIterable event queue that receives events from the WebSocket
 * message handler and delivers them to harness consumers.
 */
export interface EventStream extends AsyncIterable<BrokerEvent> {
  /** Push an event into the queue. */
  push(event: BrokerEvent): void;
  /** Signal that no more events will arrive. */
  complete(): void;
}

/**
 * Create a new event stream backed by an async queue.
 * Events are buffered and delivered in order via async iteration.
 * The iterator completes when complete() is called and the buffer is drained.
 */
export function createEventStream(): EventStream {
  const buffer: BrokerEvent[] = [];
  let done = false;
  let waiter: ((value: IteratorResult<BrokerEvent>) => void) | null = null;

  function push(event: BrokerEvent): void {
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
      resolve({ value: undefined as unknown as BrokerEvent, done: true });
    }
  }

  const asyncIterator: AsyncIterator<BrokerEvent> = {
    next(): Promise<IteratorResult<BrokerEvent>> {
      const buffered = buffer.shift();
      if (buffered !== undefined) {
        return Promise.resolve({ value: buffered, done: false });
      }
      if (done) {
        return Promise.resolve({
          value: undefined as unknown as BrokerEvent,
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
