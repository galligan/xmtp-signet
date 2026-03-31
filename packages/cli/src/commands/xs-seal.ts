/**
 * Seal inspection and verification commands for the `xs seal` subcommand group.
 *
 * Seal commands do not have action specs yet (seal CRUD is tracked in #241).
 * The command structure is preserved for help text, but all actions exit with
 * a clear deferral message.
 *
 * @module
 */

import { Command } from "commander";

/** Standard deferral message for seal commands. */
function notYetAvailable(): void {
  process.stderr.write(
    "Seal commands are not yet available. See #241 for status.\n",
  );
  process.exit(1);
}

/**
 * Create the `seal` subcommand group.
 *
 * Subcommands: list, info, verify, history.
 */
export function createSealCommands(): Command {
  const cmd = new Command("seal").description(
    "Seal inspection and verification",
  );

  cmd
    .command("list")
    .description("List seals")
    .option("--json", "JSON output")
    .action(() => {
      notYetAvailable();
    });

  cmd
    .command("info")
    .description("Show seal details")
    .argument("<id>", "Seal ID")
    .option("--json", "JSON output")
    .action(() => {
      notYetAvailable();
    });

  cmd
    .command("verify")
    .description("Verify a seal")
    .argument("<id>", "Seal ID")
    .action(() => {
      notYetAvailable();
    });

  cmd
    .command("history")
    .description("Show seal chain history")
    .argument("<cred-id>", "Credential ID")
    .action(() => {
      notYetAvailable();
    });

  return cmd;
}
