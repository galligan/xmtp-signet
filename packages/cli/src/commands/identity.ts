import { Command } from "commander";

/**
 * Identity (inbox/client) management commands.
 *
 * - init: Create XMTP identity and key hierarchy (direct mode)
 * - info: Display identity details (daemon mode)
 * - rotate-keys: Rotate operational keys (daemon mode, admin auth)
 * - export-public: Export public key material (daemon mode)
 */
export function createIdentityCommands(): Command {
  const cmd = new Command("identity").description(
    "XMTP identity and key management",
  );

  cmd
    .command("init")
    .description("Create a new XMTP identity and key hierarchy")
    .option("--json", "JSON output")
    .action(async (_options) => {
      // Direct mode supported -- creates identity via vault
    });

  cmd
    .command("info")
    .description("Display identity details")
    .option("--json", "JSON output")
    .action(async (_options) => {
      // Routed via AdminClient
    });

  cmd
    .command("rotate-keys")
    .description("Rotate operational keys")
    .option("--json", "JSON output")
    .action(async (_options) => {
      // Routed via AdminClient (admin auth required)
    });

  cmd
    .command("export-public")
    .description("Export public key material")
    .option("--json", "JSON output")
    .action(async (_options) => {
      // Routed via AdminClient
    });

  return cmd;
}
