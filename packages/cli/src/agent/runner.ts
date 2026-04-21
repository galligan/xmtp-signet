import { Result } from "better-result";
import {
  InternalError,
  type AdapterVerbType,
  type SignetError,
} from "@xmtp/signet-schemas";
import type { ResolvedAgentAdapterCommand } from "./registry.js";

/** Captured output from an adapter process invocation. */
export interface AgentProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Dependencies for adapter process execution. */
export interface RunResolvedAgentAdapterDeps {
  readonly spawn: typeof Bun.spawn;
}

const defaultDeps: RunResolvedAgentAdapterDeps = {
  spawn: Bun.spawn,
};

function assertPipedStream(
  stream: number | ReadableStream<Uint8Array> | undefined,
  streamName: "stdout" | "stderr",
): ReadableStream<Uint8Array> {
  if (!(stream instanceof ReadableStream)) {
    throw new Error(`Expected adapter ${streamName} to be piped`);
  }

  return stream;
}

function buildAdapterArgs(
  adapter: ResolvedAgentAdapterCommand,
  options: {
    readonly verb: AdapterVerbType;
    readonly configPath: string;
    readonly json: boolean;
  },
): string[] {
  const entrypoint = adapter.manifest.entrypoints[options.verb];
  if (entrypoint === undefined) {
    throw new Error(
      `Adapter '${adapter.adapterName}' is missing an entrypoint for '${options.verb}'`,
    );
  }

  return [
    options.verb,
    "--adapter",
    adapter.adapterName,
    "--entrypoint",
    entrypoint,
    "--config",
    options.configPath,
    ...(options.json ? ["--json"] : []),
  ];
}

/** Run a resolved adapter command as a child process. */
export async function runResolvedAgentAdapter(
  adapter: ResolvedAgentAdapterCommand,
  options: {
    readonly verb: AdapterVerbType;
    readonly configPath: string;
    readonly json: boolean;
  },
  deps: Partial<RunResolvedAgentAdapterDeps> = {},
): Promise<Result<AgentProcessResult, SignetError>> {
  const resolvedDeps: RunResolvedAgentAdapterDeps = { ...defaultDeps, ...deps };

  let process: Bun.Subprocess;
  try {
    process = resolvedDeps.spawn(
      [adapter.command, ...buildAdapterArgs(adapter, options)],
      {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        ...(adapter.cwd !== undefined ? { cwd: adapter.cwd } : {}),
      },
    );
  } catch (error) {
    return Result.err(
      InternalError.create("Failed to start adapter command", {
        adapter: adapter.adapterName,
        command: adapter.command,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(assertPipedStream(process.stdout, "stdout")).text(),
    new Response(assertPipedStream(process.stderr, "stderr")).text(),
  ]);

  return Result.ok({
    exitCode,
    stdout,
    stderr,
  });
}
