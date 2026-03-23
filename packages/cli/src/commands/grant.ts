import { Command } from "commander";

/**
 * Scope management commands. All require daemon and admin auth.
 *
 * In v1, grants are replaced by permission scopes on credentials.
 * These commands will be restructured in Phase 6 (xs binary).
 *
 * - list: List scopes across active credentials
 * - inspect: Show full scope details for a credential
 */
export function createGrantCommands(): Command {
  const cmd = new Command("grant").description("Scope management");

  cmd
    .command("list")
    .description("List scopes across active credentials")
    .option("--credential <id>", "Filter by credential ID")
    .option("--json", "JSON output")
    .action(async (_options) => {
      // Routed via AdminClient
    });

  cmd
    .command("inspect")
    .description("Show full scope details for a credential")
    .argument("<id>", "Credential ID")
    .option("--json", "JSON output")
    .action(async (_id, _options) => {
      // Routed via AdminClient
    });

  return cmd;
}
