/** Configuration for heartbeat monitoring. */
export interface HeartbeatConfig {
  readonly intervalMs: number;
  readonly missedBeforeDead: number;
}

/** Monitor signet heartbeats and detect dead connections. */
export interface HeartbeatMonitor {
  /** Start monitoring. Calls onDead when heartbeats are missed. */
  start(onDead: () => void): void;
  /** Record a received heartbeat. */
  recordHeartbeat(): void;
  /** Stop monitoring and clear timers. */
  stop(): void;
}

/**
 * Create a heartbeat monitor.
 * Fires onDead when no heartbeat is received within
 * intervalMs * missedBeforeDead milliseconds.
 */
export function createHeartbeatMonitor(
  config: HeartbeatConfig,
): HeartbeatMonitor {
  let timer: Timer | null = null;
  let deadCallback: (() => void) | null = null;
  const thresholdMs = config.intervalMs * config.missedBeforeDead;

  function resetTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
    }
    if (deadCallback) {
      timer = setTimeout(() => {
        deadCallback?.();
      }, thresholdMs);
    }
  }

  return {
    start(onDead: () => void): void {
      deadCallback = onDead;
      resetTimer();
    },
    recordHeartbeat(): void {
      resetTimer();
    },
    stop(): void {
      deadCallback = null;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
