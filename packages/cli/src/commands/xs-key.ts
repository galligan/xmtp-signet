/**
 * Key management commands for the `xs key` subcommand group.
 *
 * Key commands do not have action specs yet. The command structure is
 * preserved for help text, but all actions exit with a clear deferral message.
 *
 * @module
 */

import { Command } from "commander";

/** Standard deferral message for key commands. */
function notYetAvailable(): void {
  process.stderr.write(
    "Key commands are not yet available. Key action specs are pending.\n",
  );
  process.exit(1);
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
      notYetAvailable();
    });

  cmd
    .command("rotate")
    .description("Rotate keys")
    .action(() => {
      notYetAvailable();
    });

  cmd
    .command("list")
    .description("List keys")
    .option("--json", "JSON output")
    .action(() => {
      notYetAvailable();
    });

  cmd
    .command("info")
    .description("Show key details")
    .argument("<id>", "Key ID")
    .option("--json", "JSON output")
    .action(() => {
      notYetAvailable();
    });

  return cmd;
}
