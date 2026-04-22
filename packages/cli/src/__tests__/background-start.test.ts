import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, test } from "bun:test";
import { daemonizeCurrentProcess } from "../daemon/background-start.js";

function createFakeChild() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const emitter = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    pid: number;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    unrefCalls: number;
    killCalls: number;
    unref(): void;
    kill(): boolean;
  };

  emitter.stdout = stdout;
  emitter.stderr = stderr;
  emitter.pid = 4321;
  emitter.exitCode = null;
  emitter.signalCode = null;
  emitter.unrefCalls = 0;
  emitter.killCalls = 0;
  emitter.unref = () => {
    emitter.unrefCalls += 1;
  };
  emitter.kill = () => {
    emitter.killCalls += 1;
    return true;
  };

  return emitter;
}

describe("daemonizeCurrentProcess", () => {
  test("kills the detached child when startup times out", async () => {
    const child = createFakeChild();

    const result = await daemonizeCurrentProcess({
      timeoutMs: 10,
      spawnProcess: (() => child) as never,
    });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;

    expect(result.error.category).toBe("timeout");
    expect(child.unrefCalls).toBe(1);
    expect(child.killCalls).toBe(1);
  });

  test("preserves the child failure category when startup exits early", async () => {
    const child = createFakeChild();
    const resultPromise = daemonizeCurrentProcess({
      timeoutMs: 100,
      spawnProcess: (() => child) as never,
    });

    child.stderr.write(
      JSON.stringify({
        error: "Config load failed",
        message: "Validation failed on 'config': missing required field",
      }),
    );
    child.exitCode = 1;
    child.emit("exit", 1);

    const result = await resultPromise;
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;

    expect(result.error.category).toBe("validation");
    expect(result.error.message).toContain("Validation failed on 'config'");
    expect(child.killCalls).toBe(0);
  });
});
