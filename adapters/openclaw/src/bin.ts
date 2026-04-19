#!/usr/bin/env bun

import { Command } from "commander";
import { Result } from "better-result";
import {
  ERROR_CATEGORY_META,
  InternalError,
  type SignetError,
} from "@xmtp/signet-schemas";
import { runOpenClawDoctor } from "./doctor/index.js";
import { formatAdapterOutput } from "./output.js";
import { runOpenClawSetup } from "./setup/index.js";
import { runOpenClawStatus } from "./status/index.js";
function exitCodeFromCategory(category: SignetError["category"]): number {
  const meta = ERROR_CATEGORY_META[category];
  return meta?.exitCode ?? ERROR_CATEGORY_META.internal.exitCode;
}

function isResult<T>(result: unknown): result is Result<T, SignetError> {
  return (
    typeof result === "object" &&
    result !== null &&
    "isOk" in result &&
    "isErr" in result &&
    typeof (result as { isOk: () => boolean }).isOk === "function" &&
    typeof (result as { isErr: () => boolean }).isErr === "function"
  );
}

/** Unwrap direct adapter function output to either the success payload or error. */
export function unwrapAdapterOutput<T>(output: unknown):
  | {
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly ok: false;
      readonly error: SignetError;
    } {
  if (isResult<T>(output)) {
    if (output.isErr()) {
      return { ok: false, error: output.error };
    }
    return { ok: true, value: output.value as T };
  }

  return { ok: true, value: output as T };
}

function formatAdapterError(error: SignetError, json: boolean): string {
  if (json) {
    return JSON.stringify(
      {
        error: error._tag,
        category: error.category,
        message: error.message,
        ...(error.context !== null ? { context: error.context } : {}),
      },
      null,
      2,
    );
  }

  return `${error._tag} (${error.category}): ${error.message}`;
}

interface OpenClawAdapterOutput {
  readonly adapter: string;
  readonly entrypoint: string;
  readonly config: string;
  readonly json: boolean;
}

interface OpenClawBinIo {
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
  readonly exit: (code: number) => void;
}

const defaultIo: OpenClawBinIo = {
  stdout(message) {
    process.stdout.write(message);
  },
  stderr(message) {
    process.stderr.write(message);
  },
  exit(code) {
    process.exit(code);
  },
};

export async function runOpenClawAdapterCommand(
  run: () => Promise<unknown> | unknown,
  options: OpenClawAdapterOutput,
  io: OpenClawBinIo = defaultIo,
): Promise<void> {
  let output: unknown;
  try {
    output = await run();
  } catch (error) {
    const signetError = InternalError.create(
      "OpenClaw adapter command failed unexpectedly",
      {
        adapter: options.adapter,
        entrypoint: options.entrypoint,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    io.stderr(`${formatAdapterError(signetError, options.json)}\n`);
    io.exit(exitCodeFromCategory(signetError.category));
    return;
  }

  const resolved = unwrapAdapterOutput(output);
  if (resolved.ok === false) {
    io.stderr(`${formatAdapterError(resolved.error, options.json)}\n`);
    io.exit(exitCodeFromCategory(resolved.error.category));
    return;
  }

  io.stdout(
    formatAdapterOutput(
      {
        ...((resolved.value ?? {}) as Record<string, unknown>),
        adapter: options.adapter,
        entrypoint: options.entrypoint,
        configPath: options.config,
      },
      options.json,
    ) + "\n",
  );
}
function addVerb(
  program: Command,
  verb: "setup" | "status" | "doctor",
  run: (opts: {
    adapter: string;
    entrypoint: string;
    config: string;
    force?: true;
  }) => Promise<unknown> | unknown,
): void {
  program
    .command(verb)
    .requiredOption("--adapter <name>", "Adapter name")
    .requiredOption("--entrypoint <name>", "Entrypoint identifier")
    .requiredOption("--config <path>", "Resolved signet config path")
    .option("--force", "Overwrite generated adapter artifacts when needed")
    .option("--json", "JSON output")
    .action(
      async (opts: {
        adapter: string;
        entrypoint: string;
        config: string;
        force?: true;
        json?: true;
      }) => {
        await runOpenClawAdapterCommand(() => run(opts), {
          adapter: opts.adapter,
          entrypoint: opts.entrypoint,
          config: opts.config,
          json: opts.json === true,
        });
      },
    );
}

const program = new Command()
  .name("openclaw-adapter")
  .description("Process-backed OpenClaw adapter for xmtp-signet");

addVerb(program, "setup", (opts) =>
  runOpenClawSetup({
    configPath: opts.config,
    force: opts.force,
  }),
);
addVerb(program, "status", () => runOpenClawStatus());
addVerb(program, "doctor", () => runOpenClawDoctor());

if (import.meta.main) {
  await program.parseAsync(process.argv);
}
