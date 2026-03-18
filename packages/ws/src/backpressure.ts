/** Backpressure state derived from the current per-connection send depth. */
export type BackpressureState = "ok" | "warning" | "exceeded";

/**
 * Tracks per-connection send buffer depth and determines backpressure state.
 */
export class BackpressureTracker {
  private _depth = 0;
  private _notified = false;

  constructor(
    private readonly softLimit: number,
    private readonly hardLimit: number,
  ) {}

  get depth(): number {
    return this._depth;
  }

  get notified(): boolean {
    return this._notified;
  }

  get state(): BackpressureState {
    if (this._depth >= this.hardLimit) return "exceeded";
    if (this._depth >= this.softLimit) return "warning";
    return "ok";
  }

  increment(): void {
    this._depth++;
  }

  decrement(): void {
    if (this._depth > 0) {
      this._depth--;
    }
  }

  markNotified(): void {
    this._notified = true;
  }

  clearNotified(): void {
    this._notified = false;
  }

  reset(): void {
    this._depth = 0;
    this._notified = false;
  }
}
