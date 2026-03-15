import { Command } from "commander";

/**
 * Administrative operation commands. All require daemon and admin auth.
 *
 * - verify-keys: Verify key hierarchy integrity
 * - export-state: Export runtime state snapshot for debugging
 * - audit-log: Read and display the audit trail
 */
export function createAdminCommands(): Command {
  const cmd = new Command("admin").description("Administrative operations");

  cmd
    .command("verify-keys")
    .description("Verify key hierarchy integrity")
    .option("--json", "JSON output")
    .action(async (_options) => {
      // Routed via AdminClient
    });

  cmd
    .command("export-state")
    .description("Export runtime state snapshot")
    .option("--json", "JSON output")
    .action(async (_options) => {
      // Routed via AdminClient
    });

  cmd
    .command("audit-log")
    .description("Display audit trail")
    .option("--limit <n>", "Maximum number of entries", "50")
    .option("--since <timestamp>", "Filter entries after timestamp")
    .option("--json", "JSON output")
    .action(async (_options) => {
      // Routed via AdminClient
    });

  return cmd;
}
