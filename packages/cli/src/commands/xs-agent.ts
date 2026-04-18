/**
 * Generic harness adapter commands for the `xs agent` subcommand group.
 *
 * This namespace owns harness/runtime integration workflows while keeping
 * signet-native control-plane nouns under `operator`, `cred`, `policy`, etc.
 *
 * @module
 */

import { Command } from "commander";
import { Result } from "better-result";
import type { AdapterVerbType, SignetError } from "@xmtp/signet-schemas";
import { loadConfig, defaultConfigPath } from "../config/loader.js";
import type { CliConfig } from "../config/schema.js";
import { exitCodeFromCategory } from "../output/exit-codes.js";
import { formatOutput } from "../output/formatter.js";
import {
  resolveAgentAdapterCommand,
  type ResolvedAgentAdapterCommand,
} from "../agent/registry.js";
import {
  runResolvedAgentAdapter,
  type AgentProcessResult,
} from "../agent/runner.js";

/** Dependencies for the generic `xs agent` command family. */
export interface XsAgentCommandDeps {
  readonly loadConfig: (options?: {
    configPath?: string;
    envOverrides?: Record<string, string>;
  }) => Promise<Result<CliConfig, SignetError>>;
  readonly defaultConfigPath: () => string;
  readonly resolveAdapterCommand: (options: {
    adapterName: string;
    verb: AdapterVerbType;
    config: CliConfig;
    configPath: string;
  }) => Promise<Result<ResolvedAgentAdapterCommand, SignetError>>;
  readonly runAdapterCommand: (
    adapter: ResolvedAgentAdapterCommand,
    options: {
      verb: AdapterVerbType;
      configPath: string;
      json: boolean;
    },
  ) => Promise<Result<AgentProcessResult, SignetError>>;
  readonly writeStdout: (message: string) => void;
  readonly writeStderr: (message: string) => void;
  readonly exit: (code: number) => void;
}

const defaultDeps: XsAgentCommandDeps = {
  loadConfig: (options) => loadConfig(options),
  defaultConfigPath: () => defaultConfigPath(),
  resolveAdapterCommand: (options) => resolveAgentAdapterCommand(options),
  runAdapterCommand: (adapter, options) =>
    runResolvedAgentAdapter(adapter, options),
  writeStdout(message) {
    process.stdout.write(message);
  },
  writeStderr(message) {
    process.stderr.write(message);
  },
  exit(code) {
    process.exit(code);
  },
};

function writeError(
  deps: XsAgentCommandDeps,
  error: SignetError,
  json: boolean,
): void {
  deps.writeStderr(
    formatOutput(
      {
        error: error._tag,
        category: error.category,
        message: error.message,
        ...(error.context !== null ? { context: error.context } : {}),
      },
      { json },
    ) + "\n",
  );
  deps.exit(exitCodeFromCategory(error.category));
}

function addAgentVerb(
  command: Command,
  verb: AdapterVerbType,
  deps: XsAgentCommandDeps,
): void {
  command
    .command(verb)
    .description(`${verb[0]!.toUpperCase()}${verb.slice(1)} a harness adapter`)
    .argument("<harness>", "Harness adapter name")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(
      async (
        harness: string,
        opts: { config?: string; json?: true },
      ): Promise<void> => {
        const json = opts.json === true;
        const configPath = opts.config ?? deps.defaultConfigPath();
        const configResult = await deps.loadConfig({ configPath });
        if (configResult.isErr()) {
          writeError(deps, configResult.error, json);
          return;
        }

        const adapterResult = await deps.resolveAdapterCommand({
          adapterName: harness,
          verb,
          config: configResult.value,
          configPath,
        });
        if (adapterResult.isErr()) {
          writeError(deps, adapterResult.error, json);
          return;
        }

        const runResult = await deps.runAdapterCommand(adapterResult.value, {
          verb,
          configPath,
          json,
        });
        if (runResult.isErr()) {
          writeError(deps, runResult.error, json);
          return;
        }

        if (runResult.value.stdout.length > 0) {
          deps.writeStdout(runResult.value.stdout);
        }
        if (runResult.value.stderr.length > 0) {
          deps.writeStderr(runResult.value.stderr);
        }
        if (runResult.value.exitCode !== 0) {
          deps.exit(runResult.value.exitCode);
        }
      },
    );
}

/** Create the `agent` subcommand group. */
export function createAgentCommands(
  deps: Partial<XsAgentCommandDeps> = {},
): Command {
  const resolvedDeps: XsAgentCommandDeps = { ...defaultDeps, ...deps };
  const command = new Command("agent").description(
    "Manage harness adapter setup and runtime wiring",
  );

  addAgentVerb(command, "setup", resolvedDeps);
  addAgentVerb(command, "status", resolvedDeps);
  addAgentVerb(command, "doctor", resolvedDeps);

  return command;
}
