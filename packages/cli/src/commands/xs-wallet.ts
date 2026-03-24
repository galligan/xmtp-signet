/**
 * Wallet management commands for the `xs wallet` subcommand group.
 *
 * Provides wallet listing, inspection, and provider configuration.
 * Each action constructs an RPC-compatible payload and delegates to
 * the daemon client.
 *
 * @module
 */

import { Command } from "commander";
import { formatOutput } from "../output/formatter.js";

/** Stub action output for commands not yet wired to the daemon. */
function stubOutput(
  action: string,
  params: Record<string, unknown>,
  json: boolean,
): string {
  return formatOutput({ action, ...params }, { json }) + "\n";
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
    .action((opts: { json?: true }) => {
      const json = opts.json === true;
      process.stdout.write(stubOutput("wallet.list", {}, json));
    });

  cmd
    .command("info")
    .description("Show wallet details")
    .argument("<id>", "Wallet ID")
    .option("--json", "JSON output")
    .action((id: string, opts: { json?: true }) => {
      const json = opts.json === true;
      process.stdout.write(stubOutput("wallet.info", { id }, json));
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
    .action((name: string, opts: { path: string }) => {
      process.stdout.write(
        stubOutput("wallet.provider.set", { name, path: opts.path }, false),
      );
    });

  provider
    .command("list")
    .description("List wallet providers")
    .option("--json", "JSON output")
    .action((opts: { json?: true }) => {
      const json = opts.json === true;
      process.stdout.write(stubOutput("wallet.provider.list", {}, json));
    });

  cmd.addCommand(provider);

  return cmd;
}
