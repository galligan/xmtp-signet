/**
 * Wallet management commands for the `xs wallet` subcommand group.
 *
 * Wallet commands do not have action specs yet. The command structure is
 * preserved for help text, but all actions exit with a clear deferral message.
 *
 * @module
 */

import { Command } from "commander";

/** Standard deferral message for wallet commands. */
function notYetAvailable(): void {
  process.stderr.write(
    "Wallet commands are not yet available. Wallet action specs are pending.\n",
  );
  process.exit(1);
}

/**
 * Create the `wallet` subcommand group.
 *
 * Subcommands: list, info, provider (set, list).
 */
export function createWalletCommands(): Command {
  const cmd = new Command("wallet").description("Wallet management");

  cmd
    .command("list")
    .description("List wallets")
    .option("--json", "JSON output")
    .action(() => {
      notYetAvailable();
    });

  cmd
    .command("info")
    .description("Show wallet details")
    .argument("<id>", "Wallet ID")
    .option("--json", "JSON output")
    .action(() => {
      notYetAvailable();
    });

  // --- provider subgroup ---

  const provider = new Command("provider").description(
    "Manage wallet providers",
  );

  provider
    .command("set")
    .description("Set a wallet provider")
    .argument("<name>", "Provider name")
    .requiredOption("--path <path>", "Provider binary path")
    .action(() => {
      notYetAvailable();
    });

  provider
    .command("list")
    .description("List wallet providers")
    .option("--json", "JSON output")
    .action(() => {
      notYetAvailable();
    });

  cmd.addCommand(provider);

  return cmd;
}
