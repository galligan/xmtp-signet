import { Command } from "commander";

/**
 * Attestation lifecycle commands. All require daemon.
 *
 * - list: List attestations filtered by group or agent
 * - inspect: Show full attestation content
 * - verify: Run 6-check verification pipeline
 * - revoke: Revoke an attestation
 */
export function createAttestationCommands(): Command {
  const cmd = new Command("attestation").description(
    "Attestation lifecycle management",
  );

  cmd
    .command("list")
    .description("List attestations")
    .option("--group <groupId>", "Filter by group ID")
    .option("--agent <inboxId>", "Filter by agent inbox ID")
    .option("--json", "JSON output")
    .action(async (_options) => {
      // Routed via AdminClient
    });

  cmd
    .command("inspect")
    .description("Show full attestation details")
    .argument("<id>", "Attestation ID")
    .option("--json", "JSON output")
    .action(async (_id, _options) => {
      // Routed via AdminClient
    });

  cmd
    .command("verify")
    .description("Run verification pipeline against an attestation")
    .argument("<id>", "Attestation ID")
    .option("--json", "JSON output")
    .action(async (_id, _options) => {
      // Routed via AdminClient
    });

  cmd
    .command("revoke")
    .description("Revoke an attestation")
    .argument("<id>", "Attestation ID")
    .option("--json", "JSON output")
    .action(async (_id, _options) => {
      // Routed via AdminClient
    });

  return cmd;
}
