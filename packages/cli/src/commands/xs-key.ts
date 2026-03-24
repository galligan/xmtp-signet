/**
 * Key management commands for the `xs key` subcommand group.
 *
 * Provides key hierarchy initialization, rotation, and inspection.
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
 * Create the `key` subcommand group.
 *
 * Subcommands: init, rotate, list, info.
 */
export function createKeyCommands(): Command {
  const cmd = new Command("key").description("Key management");

  cmd
    .command("init")
    .description("Initialize key hierarchy")
    .action(() => {
      process.stdout.write(stubOutput("key.init", {}, false));
    });

  cmd
    .command("rotate")
    .description("Rotate keys")
    .action(() => {
      process.stdout.write(stubOutput("key.rotate", {}, false));
    });

  cmd
    .command("list")
    .description("List keys")
    .option("--json", "JSON output")
    .action((opts: { json?: true }) => {
      const json = opts.json === true;
      process.stdout.write(stubOutput("key.list", {}, json));
    });

  cmd
    .command("info")
    .description("Show key details")
    .argument("<id>", "Key ID")
    .option("--json", "JSON output")
    .action((id: string, opts: { json?: true }) => {
      const json = opts.json === true;
      process.stdout.write(stubOutput("key.info", { id }, json));
    });

  return cmd;
}
