import { Result } from "better-result";
import { InternalError } from "@xmtp-broker/schemas";

/**
 * Daemon lifecycle states.
 *
 * Transitions:
 *   created -> starting -> running -> draining -> stopped
 *   starting -> error (initialization failure)
 *   running -> error (runtime failure)
 *   draining -> error (shutdown failure)
 */
export type DaemonState =
  | "created"
  | "starting"
  | "running"
  | "draining"
  | "stopped"
  | "error";

/** Callbacks for lifecycle events. */
export interface DaemonLifecycleCallbacks {
  /** Called during start(). Throwing transitions to error. */
  readonly onStart: () => Promise<void>;
  /** Called during shutdown(). Throwing transitions to error. */
  readonly onShutdown: () => Promise<void>;
}

type StateChangeListener = (to: DaemonState, from: DaemonState) => void;

/** Daemon lifecycle state machine. */
export interface DaemonLifecycle {
  /** Current state. */
  readonly state: DaemonState;

  /** Start the daemon. Transitions created -> starting -> running. */
  start(): Promise<Result<void, InternalError>>;

  /** Graceful shutdown. Transitions running -> draining -> stopped. */
  shutdown(): Promise<Result<void, InternalError>>;

  /** Listen for state changes. */
  on(event: "stateChange", listener: StateChangeListener): void;

  /** Remove a state change listener. */
  off(event: "stateChange", listener: StateChangeListener): void;
}

export function createDaemonLifecycle(
  callbacks: DaemonLifecycleCallbacks,
): DaemonLifecycle {
  let currentState: DaemonState = "created";
  const listeners: Set<StateChangeListener> = new Set();

  function transition(to: DaemonState): void {
    const from = currentState;
    currentState = to;
    for (const listener of listeners) {
      try {
        listener(to, from);
      } catch (listenerError: unknown) {
        // Log but don't let a failing listener crash the process
        console.error(
          `[lifecycle] listener error during ${from} -> ${to}:`,
          listenerError instanceof Error
            ? listenerError.message
            : String(listenerError),
        );
      }
    }
  }

  return {
    get state(): DaemonState {
      return currentState;
    },

    async start(): Promise<Result<void, InternalError>> {
      if (currentState !== "created") {
        return Result.err(
          InternalError.create(
            `Cannot start daemon in state "${currentState}"`,
            { state: currentState },
          ),
        );
      }

      transition("starting");

      try {
        await callbacks.onStart();
      } catch (error: unknown) {
        transition("error");
        return Result.err(
          InternalError.create(
            `Daemon startup failed: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error instanceof Error ? error.message : String(error) },
          ),
        );
      }

      transition("running");
      return Result.ok(undefined);
    },

    async shutdown(): Promise<Result<void, InternalError>> {
      if (currentState !== "running") {
        return Result.err(
          InternalError.create(
            `Cannot shutdown daemon in state "${currentState}"`,
            { state: currentState },
          ),
        );
      }

      transition("draining");

      try {
        await callbacks.onShutdown();
      } catch (error: unknown) {
        transition("error");
        return Result.err(
          InternalError.create(
            `Daemon shutdown failed: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error instanceof Error ? error.message : String(error) },
          ),
        );
      }

      transition("stopped");
      return Result.ok(undefined);
    },

    on(_event: "stateChange", listener: StateChangeListener): void {
      listeners.add(listener);
    },

    off(_event: "stateChange", listener: StateChangeListener): void {
      listeners.delete(listener);
    },
  };
}
