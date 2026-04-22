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
      return ValidationError.create("daemon.start", message, extra);
    case "not_found":
      return NotFoundError.create("daemon.start", message);
    case "permission":
      return PermissionError.create(message, extra);
    case "auth":
      return AuthError.create(message, extra);
    case "timeout":
      return TimeoutError.create("daemon.start", 15_000);
    case "cancelled":
      return CancelledError.create(message);
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
