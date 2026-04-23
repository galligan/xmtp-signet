import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { redirectChildStdioToLogFile } from "../daemon/child-log.js";

describe("redirectChildStdioToLogFile", () => {
  let tmp: string;
  let originalStdoutWrite: typeof process.stdout.write;
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "xs-child-log-"));
    originalStdoutWrite = process.stdout.write.bind(process.stdout);
    originalStderrWrite = process.stderr.write.bind(process.stderr);
  });

  afterEach(() => {
    // Restore so a single broken test does not corrupt the rest of the suite.
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    rmSync(tmp, { recursive: true, force: true });
  });

  test("routes process.stdout.write to a log file inside dataDir", async () => {
    const { logFile, stream } = redirectChildStdioToLogFile(tmp);
    expect(logFile).toBe(join(tmp, "daemon.log"));

    process.stdout.write("hello stdout\n");
    process.stderr.write("hello stderr\n");

    // Restore before reading so failures inside the assertions still print.
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;

    await new Promise<void>((resolve) => stream.end(() => resolve()));

    const contents = readFileSync(logFile, "utf8");
    expect(contents).toContain("hello stdout");
    expect(contents).toContain("hello stderr");
  });

  test("does not crash on EPIPE errors emitted by the original streams", () => {
    redirectChildStdioToLogFile(tmp);

    // Simulating the race where the parent destroys its read end of the
    // pipe and the original stdout stream emits an EPIPE error. Without
    // the swallowing listener installed by the redirect helper this would
    // become an uncaught 'error' event and crash the process.
    expect(() => {
      process.stdout.emit(
        "error",
        Object.assign(new Error("broken"), {
          code: "EPIPE",
        }) as NodeJS.ErrnoException,
      );
      process.stderr.emit(
        "error",
        Object.assign(new Error("broken"), {
          code: "EPIPE",
        }) as NodeJS.ErrnoException,
      );
    }).not.toThrow();
  });
});
