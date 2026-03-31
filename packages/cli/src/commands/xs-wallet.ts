/**
 * Wallet management commands for the `xs wallet` subcommand group.
 *
 * Create, list, and inspect wallets through the daemon action surface.
 * Provider management remains deferred until the external provider story lands.
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

/** Dependencies for v1 wallet commands. */
export interface XsWalletCommandDeps {
  readonly withDaemonClient: WithDaemonClient;
  readonly writeStdout: (message: string) => void;
  readonly writeStderr: (message: string) => void;
  readonly exit: (code: number) => void;
}

const defaultDeps: XsWalletCommandDeps = {
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
  deps: XsWalletCommandDeps,
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

function writeDeferredProviderMessage(deps: XsWalletCommandDeps): void {
  deps.writeStderr(
    "Wallet provider commands remain deferred until external provider integration lands.\n",
  );
  deps.exit(1);
}

/** Create the `wallet` subcommand group. */
export function createWalletCommands(
  deps: Partial<XsWalletCommandDeps> = {},
): Command {
  const resolvedDeps: XsWalletCommandDeps = { ...defaultDeps, ...deps };
  const cmd = new Command("wallet").description("Wallet management");

  cmd
    .command("create")
    .description("Create a new managed wallet")
    .option("--config <path>", "Path to config file")
    .requiredOption("--label <name>", "Human-readable wallet label")
    .option("--json", "JSON output")
    .action(async (opts: { config?: string; label: string; json?: true }) => {
      const json = opts.json === true;
      const result = await resolvedDeps.withDaemonClient(
        { configPath: opts.config },
        (client) => client.request("wallet.create", { label: opts.label }),
      );

      if (result.isErr()) {
        writeError(resolvedDeps, result.error, json);
        return;
      }

      resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
    });

  cmd
    .command("list")
    .description("List wallets")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (opts: { config?: string; json?: true }) => {
      const json = opts.json === true;
      const result = await resolvedDeps.withDaemonClient(
        { configPath: opts.config },
        (client) => client.request("wallet.list", {}),
      );

      if (result.isErr()) {
        writeError(resolvedDeps, result.error, json);
        return;
      }

      resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
    });

  cmd
    .command("info")
    .description("Show wallet details")
    .argument("<id>", "Wallet ID")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (id: string, opts: { config?: string; json?: true }) => {
      const json = opts.json === true;
      const result = await resolvedDeps.withDaemonClient(
        { configPath: opts.config },
        (client) => client.request("wallet.info", { walletId: id }),
      );

      if (result.isErr()) {
        writeError(resolvedDeps, result.error, json);
        return;
      }

      resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
    });

  const provider = new Command("provider").description(
    "Manage wallet providers (deferred)",
  );

  provider
    .command("set")
    .description("Set a wallet provider")
    .argument("<name>", "Provider name")
    .requiredOption("--path <path>", "Provider binary path")
    .action(() => {
      writeDeferredProviderMessage(resolvedDeps);
    });

  provider
    .command("list")
    .description("List wallet providers")
    .option("--json", "JSON output")
    .action(() => {
      writeDeferredProviderMessage(resolvedDeps);
    });

  cmd.addCommand(provider);

  return cmd;
}
