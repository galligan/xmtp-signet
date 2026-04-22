import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { Result } from "better-result";
import {
  AuthError,
  CancelledError,
  ERROR_CATEGORY_META,
  InternalError,
  NetworkError,
  NotFoundError,
  PermissionError,
  TimeoutError,
  ValidationError,
} from "@xmtp/signet-schemas";
import type { ErrorCategory, SignetError } from "@xmtp/signet-schemas";

/** Startup payload emitted by `daemon start --json`. */
export interface BackgroundDaemonStartPayload {
  readonly status: string;
  readonly pid: number;
  readonly ws: string;
  readonly adminSocket: string;
  readonly env: string;
  readonly dataDir: string;
}

type SpawnProcess = typeof spawn;

function currentProcessArgv(): string[] {
  if (
    typeof Bun !== "undefined" &&
    Array.isArray(Bun.argv) &&
    Bun.argv.length
  ) {
    return [...Bun.argv];
  }
  return [...process.argv];
}

function parseErrorMessage(stderrBuffer: string): string | null {
  const trimmed = stderrBuffer.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      message?: unknown;
      error?: unknown;
    };
    if (typeof parsed.message === "string" && parsed.message.length > 0) {
      return parsed.message;
    }
    if (typeof parsed.error === "string" && parsed.error.length > 0) {
      return parsed.error;
    }
  } catch {
    // Fall through to the raw stderr payload.
  }

  return trimmed;
}

function categoryFromExitCode(code: number | null): ErrorCategory {
  if (code !== null) {
    for (const [category, meta] of Object.entries(ERROR_CATEGORY_META)) {
      if (meta.exitCode === code) {
        return category as ErrorCategory;
      }
    }
  }
  return "internal";
}

function errorFromChildExit(
  code: number | null,
  stderrBuffer: string,
  stdoutBuffer: string,
): SignetError {
  const category = categoryFromExitCode(code);
  const message =
    parseErrorMessage(stderrBuffer) ??
    "Daemon process exited before reporting startup";
  const extra = {
    exitCode: code,
    stderr: stderrBuffer.trim() || undefined,
    stdout: stdoutBuffer.trim() || undefined,
  };

  switch (category) {
    case "validation":
      // Use the direct constructor so the child's stderr message survives
      // verbatim. ValidationError.create() formats as
      // `Validation failed on '<field>': <reason>`, which double-wraps any
      // already-formatted child diagnostic (e.g. nested "Validation failed
      // on 'config': ...").
      return new ValidationError(message, {
        field: "daemon.start",
        reason: message,
        ...extra,
      });
    case "not_found":
      // Use the direct constructor so the child's stderr message survives
      // verbatim. NotFoundError.create() formats as
      // `<resourceType> '<resourceId>' not found`, which would garble the
      // already-descriptive child diagnostic.
      return new NotFoundError(message, {
        resourceType: "daemon.start",
        resourceId: "unknown",
        ...extra,
      });
    case "permission":
      return PermissionError.create(message, extra);
    case "auth":
      return AuthError.create(message, extra);
    case "timeout":
      // Use the direct constructor so the child's stderr message survives
      // verbatim. TimeoutError.create() would discard the parsed message and
      // hardcode a timeout value we did not actually observe; `timeoutMs: 0`
      // signals "no real timeout value parsed from the child" rather than
      // fabricating one.
      return new TimeoutError(message, {
        operation: "daemon.start",
        timeoutMs: 0,
        ...extra,
      });
    case "cancelled":
      // Use the direct constructor so the parsed `extra` (exitCode, stderr,
      // stdout) is preserved on the error context. CancelledError.create()
      // accepts only a message and would silently drop the diagnostic
      // payload that every other branch in this switch propagates.
      return new CancelledError(message, extra);
    case "network":
      return NetworkError.create("daemon.start", message, extra);
    case "internal":
    default:
      return InternalError.create(message, extra);
  }
}

/**
 * Respawns the current CLI as a detached child process and waits for the
 * child's first JSON startup line before returning to the parent.
 */
export async function daemonizeCurrentProcess(options?: {
  timeoutMs?: number;
  spawnProcess?: SpawnProcess;
}): Promise<Result<BackgroundDaemonStartPayload, SignetError>> {
  const argv = currentProcessArgv();
  if (argv.length === 0) {
    return Result.err(
      InternalError.create("Cannot determine the current process arguments"),
    );
  }

  const command = argv[0]!;
  const args = argv.slice(1);
  const childArgs = args.filter((arg) => arg !== "--daemon");
  if (!childArgs.includes("--json")) {
    childArgs.push("--json");
  }

  return await new Promise((resolve) => {
    const child: ChildProcessByStdio<null, Readable, Readable> = (
      options?.spawnProcess ?? spawn
    )(command, childArgs, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        XMTP_SIGNET_DAEMON_CHILD: "1",
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.unref();

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;

    const finish = (
      result: Result<BackgroundDaemonStartPayload, SignetError>,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const childHasExited =
        child.exitCode !== null || child.signalCode !== null;
      if (Result.isError(result) && !childHasExited) {
        try {
          child.kill();
        } catch {
          // Best effort: the child may already have exited.
        }
      }
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve(result);
    };

    const parseStartupPayload = () => {
      const payload = stdoutBuffer.trim();
      if (payload.length === 0) return;
      try {
        finish(Result.ok(JSON.parse(payload) as BackgroundDaemonStartPayload));
      } catch {
        // Wait for more output until the JSON document is complete.
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      parseStartupPayload();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
    });
    child.on("error", (error) => {
      finish(
        Result.err(
          InternalError.create(
            `Failed to spawn daemon process: ${error.message}`,
          ),
        ),
      );
    });
    child.on("exit", (code) => {
      if (settled) return;
      parseStartupPayload();
      if (settled) return;
      finish(Result.err(errorFromChildExit(code, stderrBuffer, stdoutBuffer)));
    });

    const timer = setTimeout(() => {
      finish(
        Result.err(
          TimeoutError.create("daemon.start", options?.timeoutMs ?? 15_000),
        ),
      );
    }, options?.timeoutMs ?? 15_000);
  });
}
