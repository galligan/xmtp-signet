/**
 * Key management commands for the `xs key` subcommand group.
 *
 * Daemon-backed key lifecycle operations via the admin socket.
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

/** Create the `key` subcommand group. */
export function createKeyCommands(
  deps: Partial<XsKeyCommandDeps> = {},
): Command {
  const resolvedDeps: XsKeyCommandDeps = { ...defaultDeps, ...deps };
  const cmd = new Command("key").description("Key management");

  cmd
    .command("init")
    .description("Initialize operator key hierarchy")
    .option("--config <path>", "Path to config file")
    .requiredOption("--operator <id>", "Operator ID or label")
    .option("--wallet <id>", "Existing wallet ID to bind")
    .option("--json", "JSON output")
    .action(
      async (opts: {
        config?: string;
        operator: string;
        wallet?: string;
        json?: true;
      }) => {
        const json = opts.json === true;
        const payload: Record<string, unknown> = {
          operatorId: opts.operator,
        };
        if (opts.wallet !== undefined) {
          payload["walletId"] = opts.wallet;
        }

        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) => client.request("keys.init", payload),
        );

        if (result.isErr()) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
      },
    );

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
    .description("List operational keys")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (opts: { config?: string; json?: true }) => {
      const json = opts.json === true;
      const result = await resolvedDeps.withDaemonClient(
        { configPath: opts.config },
        (client) => client.request("keys.list", {}),
      );

      if (result.isErr()) {
        writeError(resolvedDeps, result.error, json);
        return;
      }

      resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
    });

  cmd
    .command("info")
    .description("Show key details")
    .argument("<id>", "Key ID or identity ID")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (id: string, opts: { config?: string; json?: true }) => {
      const json = opts.json === true;
      const result = await resolvedDeps.withDaemonClient(
        { configPath: opts.config },
        (client) => client.request("keys.info", { keyId: id }),
      );

      if (result.isErr()) {
        writeError(resolvedDeps, result.error, json);
        return;
      }

      resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
    });

  return cmd;
}
