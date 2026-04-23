/**
 * Daemon child stdio redirection.
 *
 * When `xs start --daemon` forks, the parent reads the child's startup JSON
 * line from a stdout pipe, then closes its read end. Once that happens the
 * child's fd 1 / fd 2 point at broken pipes — any subsequent
 * `process.stdout.write` or `console.error` (for example, the signal handler
 * shutdown banner in `daemon/signals.ts`) raises EPIPE and can crash the
 * detached daemon silently.
 *
 * To survive past the parent handshake the child must redirect its own
 * stdout / stderr to a log file before the next write. This module owns
 * that redirection and is called once, immediately after the child writes
 * the startup JSON line.
 */
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { dirname, join } from "node:path";

/** Result of a child stdio redirect. */
export interface ChildLogRedirect {
  /** Absolute path to the log file the child now writes to. */
  readonly logFile: string;
  /** Underlying writable stream — kept alive for the lifetime of the daemon. */
  readonly stream: WriteStream;
}

/**
 * Redirect `process.stdout.write` and `process.stderr.write` to a log file
 * inside `dataDir`. Subsequent writes (including `console.log`/`console.error`,
 * which delegate to these streams) are routed to the log file instead of the
 * inherited pipe ends from the parent.
 *
 * Must be called from the daemon child only, after the startup JSON line has
 * been flushed to the original stdout pipe.
 */
export function redirectChildStdioToLogFile(dataDir: string): ChildLogRedirect {
  const logFile = join(dataDir, "daemon.log");
  mkdirSync(dirname(logFile), { recursive: true });

  // Open the log file once, in append mode. A single shared stream backs
  // both stdout and stderr so write ordering is preserved.
  const stream = createWriteStream(logFile, { flags: "a" });

  // Replace the user-facing `write` methods. We deliberately do NOT touch
  // `process.stdout._handle` / fd 1 itself — that would require platform
  // tricks (`dup2`) that Node/Bun don't expose stably. Reassigning `write`
  // covers `console.log`/`console.error`, which is where every later
  // diagnostic in the daemon child funnels.
  const writeToLog = (
    chunk: string | Uint8Array,
    encodingOrCb?: BufferEncoding | ((error?: Error | null) => void),
    cb?: (error?: Error | null) => void,
  ): boolean => {
    if (typeof encodingOrCb === "function") {
      return stream.write(chunk, encodingOrCb);
    }
    if (encodingOrCb !== undefined && cb !== undefined) {
      return stream.write(chunk, encodingOrCb, cb);
    }
    if (encodingOrCb !== undefined) {
      return stream.write(chunk, encodingOrCb);
    }
    return stream.write(chunk);
  };

  // The Node typings overload `write` heavily; cast through `unknown` to
  // satisfy both signatures without resorting to `any`.
  process.stdout.write = writeToLog as unknown as typeof process.stdout.write;
  process.stderr.write = writeToLog as unknown as typeof process.stderr.write;

  // Swallow EPIPE errors emitted directly on the original stream objects
  // before this redirect took effect. The parent's `destroy()` of its read
  // end can race with a final flush from the child; without this listener
  // Node would crash the daemon on the unhandled 'error' event.
  process.stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code !== "EPIPE") throw err;
  });
  process.stderr.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code !== "EPIPE") throw err;
  });

  return { logFile, stream };
}
