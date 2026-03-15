import { Command } from "commander";

/**
 * Grant management commands. All require daemon and admin auth.
 *
 * - list: List grants across active sessions
 * - inspect: Show full grant details
 * - revoke: Revoke a specific grant
 */
export function createGrantCommands(): Command {
  const cmd = new Command("grant").description("Grant management");

  cmd
    .command("list")
    .description("List grants across active sessions")
    .option("--session <id>", "Filter by session ID")
    .option("--json", "JSON output")
    .action(async (_options) => {
      // Routed via AdminClient
    });

  cmd
    .command("inspect")
    .description("Show full grant details")
    .argument("<id>", "Grant ID")
    .option("--json", "JSON output")
    .action(async (_id, _options) => {
      // Routed via AdminClient
    });

  cmd
    .command("revoke")
    .description("Revoke a grant")
    .argument("<id>", "Grant ID")
    .option("--json", "JSON output")
    .action(async (_id, _options) => {
      // Routed via AdminClient
    });

  return cmd;
}
