import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { InternalError } from "@xmtp/signet-schemas";
import { createLazyCoreUpgrade } from "../ws/core-upgrade.js";

describe("createLazyCoreUpgrade", () => {
  test("returns immediately when the core is already ready", async () => {
    let initializeCalls = 0;
    const ensureReady = createLazyCoreUpgrade({
      get state() {
        return "ready" as const;
      },
      async initialize() {
        initializeCalls++;
        return Result.ok(undefined);
      },
    });

    const result = await ensureReady();

    expect(result.isOk()).toBe(true);
    expect(initializeCalls).toBe(0);
  });

  test("coalesces concurrent upgrades into a single initialize call", async () => {
    let initializeCalls = 0;
    let resolveInitialize: (() => void) | undefined;
    const initializePromise = new Promise<void>((resolve) => {
      resolveInitialize = resolve;
    });

    let currentState: "ready-local" | "ready" = "ready-local";
    const ensureReady = createLazyCoreUpgrade({
      get state() {
        return currentState;
      },
      async initialize() {
        initializeCalls++;
        await initializePromise;
        currentState = "ready";
        return Result.ok(undefined);
      },
    });

    const first = ensureReady();
    const second = ensureReady();
    resolveInitialize?.();

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.isOk()).toBe(true);
    expect(secondResult.isOk()).toBe(true);
    expect(initializeCalls).toBe(1);
  });

  test("allows retry after a failed upgrade attempt", async () => {
    let initializeCalls = 0;
    let shouldFail = true;
    const ensureReady = createLazyCoreUpgrade({
      get state() {
        return "ready-local" as const;
      },
      async initialize() {
        initializeCalls++;
        if (shouldFail) {
          return Result.err(InternalError.create("network unavailable"));
        }
        return Result.ok(undefined);
      },
    });

    const first = await ensureReady();
    shouldFail = false;
    const second = await ensureReady();

    expect(first.isErr()).toBe(true);
    expect(second.isOk()).toBe(true);
    expect(initializeCalls).toBe(2);
  });
});
