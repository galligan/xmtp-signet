import { Command } from "commander";

/**
 * Seal lifecycle commands. All require daemon.
 *
 * - inspect: Show full seal content
 * - verify: Run 6-check verification pipeline
 * - history: Show the seal chain for a session
 */
export function createSealCommands(): Command {
  const cmd = new Command("seal").description("Seal lifecycle management");

  cmd
    .command("inspect")
    .description("Show full seal details")
    .argument("<id>", "Seal ID")
    .option("--json", "JSON output")
    .action(async (_id, _options) => {
      // Routed via AdminClient
    });

  cmd
    .command("verify")
    .description("Run verification pipeline against a seal")
    .argument("<id>", "Seal ID")
    .option("--json", "JSON output")
    .action(async (_id, _options) => {
      // Routed via AdminClient
    });

  cmd
    .command("history")
    .description("Show seal chain history")
    .argument("<sessionId>", "Session ID")
    .option("--json", "JSON output")
    .action(async (_sessionId, _options) => {
      // Routed via AdminClient
    });

  return cmd;
}
