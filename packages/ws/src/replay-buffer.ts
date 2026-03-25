/**
 * Fixed-capacity circular buffer. Overwrites oldest entries when full.
 * Used for per-credential event replay on reconnection.
 */
export class CircularBuffer<T> {
  private readonly buffer: Array<T | undefined>;
  private head = 0;
  private count = 0;

  constructor(private readonly cap: number) {
    this.buffer = Array.from<T | undefined>({ length: cap });
  }

  get capacity(): number {
    return this.cap;
  }

  get size(): number {
    return this.count;
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) {
      this.count++;
    }
  }

  /**
   * Returns the oldest item in the buffer, or undefined if empty.
   */
  oldest(): T | undefined {
    if (this.count === 0) return undefined;
    const start = this.count < this.cap ? 0 : this.head;
    return this.buffer[start];
  }

  /**
   * Returns all items matching the predicate, preserving insertion order.
   */
  itemsSince(predicate: (item: T) => boolean): T[] {
    const result: T[] = [];
    const start = this.count < this.cap ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.cap;
      const item = this.buffer[idx];
      if (item !== undefined && predicate(item)) {
        result.push(item);
      }
    }
    return result;
  }

  /**
   * Returns all items in insertion order.
   */
  toArray(): T[] {
    const result: T[] = [];
    const start = this.count < this.cap ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.cap;
      const item = this.buffer[idx];
      if (item !== undefined) {
        result.push(item);
      }
    }
    return result;
  }

  clear(): void {
    this.buffer.fill(undefined);
    this.head = 0;
    this.count = 0;
  }
}
