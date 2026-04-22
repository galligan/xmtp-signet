import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { Result } from "better-result";
import { InternalError } from "@xmtp/signet-schemas";
import type { SignetError } from "@xmtp/signet-schemas";

/** Startup payload emitted by `daemon start --json`. */
export interface BackgroundDaemonStartPayload {
  readonly status: string;
  readonly pid: number;
  readonly ws: string;
  readonly adminSocket: string;
  readonly env: string;
  readonly dataDir: string;
}

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

/**
 * Respawns the current CLI as a detached child process and waits for the
 * child's first JSON startup line before returning to the parent.
 */
export async function daemonizeCurrentProcess(options?: {
  timeoutMs?: number;
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
    const child: ChildProcessByStdio<null, Readable, Readable> = spawn(
      command,
      childArgs,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          XMTP_SIGNET_DAEMON_CHILD: "1",
        },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
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
      finish(
        Result.err(
          InternalError.create(
            "Daemon process exited before reporting startup",
            {
              exitCode: code,
              stderr: stderrBuffer.trim() || undefined,
            },
          ),
        ),
      );
    });

    const timer = setTimeout(() => {
      finish(
        Result.err(
          InternalError.create("Timed out waiting for daemon startup", {
            stdout: stdoutBuffer.trim() || undefined,
            stderr: stderrBuffer.trim() || undefined,
          }),
        ),
      );
    }, options?.timeoutMs ?? 5_000);
  });
}
