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

  test("preserves the child stderr message verbatim for validation exits", async () => {
    const child = createFakeChild();
    const resultPromise = daemonizeCurrentProcess({
      timeoutMs: 100,
      spawnProcess: (() => child) as never,
    });

    const stderrMessage =
      "Validation failed on 'config': missing required field";
    child.stderr.write(
      JSON.stringify({
        error: "Config load failed",
        message: stderrMessage,
      }),
    );
    // Exit code 1 maps to the `validation` category via ERROR_CATEGORY_META.
    child.exitCode = 1;
    child.emit("exit", 1);

    const result = await resultPromise;
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;

    expect(result.error.category).toBe("validation");
    // The child's already-formatted diagnostic must survive verbatim — not
    // be double-wrapped as
    // `Validation failed on 'daemon.start': Validation failed on 'config': ...`.
    expect(result.error.message).toBe(stderrMessage);
    expect(result.error.message).not.toContain("daemon.start");
    const context = (result.error as { context?: Record<string, unknown> })
      .context;
    expect(context).toBeDefined();
    expect(context?.field).toBe("daemon.start");
    expect(context?.reason).toBe(stderrMessage);
    expect(context?.exitCode).toBe(1);
    expect(context?.stderr).toContain(stderrMessage);
    expect(child.killCalls).toBe(0);
  });

  test("preserves the child stderr message and context for cancelled exits", async () => {
    const child = createFakeChild();
    const resultPromise = daemonizeCurrentProcess({
      timeoutMs: 100,
      spawnProcess: (() => child) as never,
    });

    const stderrMessage = "Daemon startup cancelled by SIGINT";
    child.stderr.write(JSON.stringify({ message: stderrMessage }));
    // Exit code 130 maps to the `cancelled` category via ERROR_CATEGORY_META.
    child.exitCode = 130;
    child.emit("exit", 130);

    const result = await resultPromise;
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;

    expect(result.error.category).toBe("cancelled");
    expect(result.error.message).toBe(stderrMessage);
    // CancelledError.create() drops context — the direct constructor must
    // preserve the parsed exitCode/stderr/stdout extras like every other
    // branch in errorFromChildExit.
    const context = (result.error as { context?: Record<string, unknown> })
      .context;
    expect(context).toBeDefined();
    expect(context?.exitCode).toBe(130);
    expect(context?.stderr).toContain(stderrMessage);
  });

  test("preserves the child stderr message verbatim for not_found exits", async () => {
    const child = createFakeChild();
    const resultPromise = daemonizeCurrentProcess({
      timeoutMs: 100,
      spawnProcess: (() => child) as never,
    });

    const stderrMessage = "Config file not found at /tmp/config.toml";
    child.stderr.write(JSON.stringify({ message: stderrMessage }));
    // Exit code 2 maps to the `not_found` category via ERROR_CATEGORY_META.
    child.exitCode = 2;
    child.emit("exit", 2);

    const result = await resultPromise;
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;

    expect(result.error.category).toBe("not_found");
    // The child's actual diagnostic must be the message verbatim — no
    // double "not found" wrapping or quoting from NotFoundError.create.
    expect(result.error.message).toBe(stderrMessage);
    expect(result.error.message).not.toContain("'");
    const context = (result.error as { context?: Record<string, unknown> })
      .context;
    expect(context).toBeDefined();
    expect(context?.exitCode).toBe(2);
    expect(context?.stderr).toContain(stderrMessage);
  });

  test("preserves the child stderr message verbatim for network exits", async () => {
    const child = createFakeChild();
    const resultPromise = daemonizeCurrentProcess({
      timeoutMs: 100,
      spawnProcess: (() => child) as never,
    });

    const stderrMessage = "Network error reaching 'xmtp': connection refused";
    child.stderr.write(JSON.stringify({ message: stderrMessage }));
    // Exit code 6 maps to the `network` category via ERROR_CATEGORY_META.
    child.exitCode = 6;
    child.emit("exit", 6);

    const result = await resultPromise;
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;

    expect(result.error.category).toBe("network");
    // The child's already-formatted diagnostic must survive verbatim — not
    // be double-wrapped as
    // `Network error reaching 'daemon.start': Network error reaching 'xmtp': ...`.
    expect(result.error.message).toBe(stderrMessage);
    expect(result.error.message).not.toContain("daemon.start");
    const context = (result.error as { context?: Record<string, unknown> })
      .context;
    expect(context).toBeDefined();
    expect(context?.endpoint).toBe("daemon.start");
    expect(context?.exitCode).toBe(6);
    expect(context?.stderr).toContain(stderrMessage);
  });

  test("preserves the child stderr message verbatim for timeout exits", async () => {
    const child = createFakeChild();
    const resultPromise = daemonizeCurrentProcess({
      timeoutMs: 100,
      spawnProcess: (() => child) as never,
    });

    const stderrMessage =
      "XMTP network handshake exceeded 30000ms while connecting";
    child.stderr.write(JSON.stringify({ message: stderrMessage }));
    // Exit code 5 maps to the `timeout` category via ERROR_CATEGORY_META.
    child.exitCode = 5;
    child.emit("exit", 5);

    const result = await resultPromise;
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;

    expect(result.error.category).toBe("timeout");
    // The child's actual diagnostic must survive verbatim — not be replaced
    // by the synthetic "Operation 'daemon.start' timed out after 15000ms".
    expect(result.error.message).toBe(stderrMessage);
    expect(result.error.message).not.toContain("15000ms");
    const context = (result.error as { context?: Record<string, unknown> })
      .context;
    expect(context).toBeDefined();
    expect(context?.exitCode).toBe(5);
    expect(context?.stderr).toContain(stderrMessage);
    // No real timeout was parsed from the child — sentinel signals that.
    expect(context?.timeoutMs).toBe(0);
  });
});
