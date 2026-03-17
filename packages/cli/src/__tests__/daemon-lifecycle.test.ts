import { describe, test, expect } from "bun:test";
import {
  createDaemonLifecycle,
  type DaemonLifecycle,
  type DaemonState,
} from "../daemon/lifecycle.js";

describe("DaemonLifecycle", () => {
  function makeLifecycle(): DaemonLifecycle {
    return createDaemonLifecycle({
      onStart: async () => {},
      onShutdown: async () => {},
    });
  }

  test("initial state is created", () => {
    const lc = makeLifecycle();
    expect(lc.state).toBe("created");
  });

  test("start() transitions from created to starting then running", async () => {
    const states: DaemonState[] = [];
    const lc = createDaemonLifecycle({
      onStart: async () => {},
      onShutdown: async () => {},
    });
    lc.on("stateChange", (state) => states.push(state));

    const result = await lc.start();
    expect(result.isOk()).toBe(true);
    expect(lc.state).toBe("running");
    expect(states).toEqual(["starting", "running"]);
  });

  test("start() transitions to error on initialization failure", async () => {
    const lc = createDaemonLifecycle({
      onStart: async () => {
        throw new Error("init failed");
      },
      onShutdown: async () => {},
    });

    const result = await lc.start();
    expect(result.isOk()).toBe(false);
    expect(lc.state).toBe("error");
  });

  test("shutdown() transitions through draining to stopped", async () => {
    const states: DaemonState[] = [];
    const lc = createDaemonLifecycle({
      onStart: async () => {},
      onShutdown: async () => {},
    });

    await lc.start();
    lc.on("stateChange", (state) => states.push(state));

    const result = await lc.shutdown();
    expect(result.isOk()).toBe(true);
    expect(lc.state).toBe("stopped");
    expect(states).toEqual(["draining", "stopped"]);
  });

  test("cannot start when already running", async () => {
    const lc = makeLifecycle();
    await lc.start();

    const result = await lc.start();
    expect(result.isOk()).toBe(false);
  });

  test("cannot start from error state", async () => {
    const lc = createDaemonLifecycle({
      onStart: async () => {
        throw new Error("boom");
      },
      onShutdown: async () => {},
    });
    await lc.start();
    expect(lc.state).toBe("error");

    const result = await lc.start();
    expect(result.isOk()).toBe(false);
  });

  test("cannot shutdown when not running", async () => {
    const lc = makeLifecycle();

    const result = await lc.shutdown();
    expect(result.isOk()).toBe(false);
  });

  test("shutdown failure transitions to error", async () => {
    const lc = createDaemonLifecycle({
      onStart: async () => {},
      onShutdown: async () => {
        throw new Error("shutdown failed");
      },
    });
    await lc.start();

    const result = await lc.shutdown();
    expect(result.isOk()).toBe(false);
    expect(lc.state).toBe("error");
  });

  test("state change emits events", async () => {
    const events: Array<{ from: DaemonState; to: DaemonState }> = [];
    const lc = createDaemonLifecycle({
      onStart: async () => {},
      onShutdown: async () => {},
    });
    lc.on("stateChange", (to, from) => events.push({ from, to }));

    await lc.start();
    await lc.shutdown();

    expect(events).toEqual([
      { from: "created", to: "starting" },
      { from: "starting", to: "running" },
      { from: "running", to: "draining" },
      { from: "draining", to: "stopped" },
    ]);
  });
});
