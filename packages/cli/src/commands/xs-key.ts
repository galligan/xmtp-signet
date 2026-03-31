/**
 * Key management commands for the `xs key` subcommand group.
 *
 * `key rotate` is backed by the `keys.rotate` action spec. Other key
 * commands are deferred pending additional action specs.
 *
 * @module
 */

import { Command } from "commander";
import type { SignetError } from "@xmtp/signet-schemas";
import { exitCodeFromCategory } from "../output/exit-codes.js";
import { formatOutput } from "../output/formatter.js";
import {
  createWithDaemonClient,
  type WithDaemonClient,
} from "./daemon-client.js";

/** Dependencies for v1 key commands. */
export interface XsKeyCommandDeps {
  readonly withDaemonClient: WithDaemonClient;
  readonly writeStdout: (message: string) => void;
  readonly writeStderr: (message: string) => void;
  readonly exit: (code: number) => void;
}

const defaultDeps: XsKeyCommandDeps = {
  withDaemonClient: createWithDaemonClient(),
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
  deps: XsKeyCommandDeps,
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

/**
 * Create the `key` subcommand group.
 *
 * Subcommands: init, rotate, list, info.
 */
export function createKeyCommands(
  deps: Partial<XsKeyCommandDeps> = {},
): Command {
  const resolvedDeps: XsKeyCommandDeps = { ...defaultDeps, ...deps };
  const cmd = new Command("key").description("Key management");

  cmd
    .command("init")
    .description("Initialize key hierarchy")
    .action(() => {
      resolvedDeps.writeStderr(
        "This command requires additional key action specs.\n",
      );
      resolvedDeps.exit(1);
    });

  cmd
    .command("rotate")
    .description("Rotate operational keys")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (opts: { config?: string; json?: true }) => {
      const json = opts.json === true;
      const result = await resolvedDeps.withDaemonClient(
        { configPath: opts.config },
        (client) => client.request("keys.rotate", {}),
      );

      if (result.isErr()) {
        writeError(resolvedDeps, result.error, json);
        return;
      }

      resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
    });

  cmd
    .command("list")
    .description("List keys")
    .option("--json", "JSON output")
    .action(() => {
      resolvedDeps.writeStderr(
        "This command requires additional key action specs.\n",
      );
      resolvedDeps.exit(1);
    });

  cmd
    .command("info")
    .description("Show key details")
    .argument("<id>", "Key ID")
    .option("--json", "JSON output")
    .action(() => {
      resolvedDeps.writeStderr(
        "This command requires additional key action specs.\n",
      );
      resolvedDeps.exit(1);
    });

  return cmd;
}
