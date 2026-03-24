/**
 * Seal inspection and verification commands for the `xs seal` subcommand group.
 *
 * Provides read-only operations for inspecting seals and their chain history.
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
    .action((opts: { json?: true }) => {
      const json = opts.json === true;
      process.stdout.write(stubOutput("seal.list", {}, json));
    });

  cmd
    .command("info")
    .description("Show seal details")
    .argument("<id>", "Seal ID")
    .option("--json", "JSON output")
    .action((id: string, opts: { json?: true }) => {
      const json = opts.json === true;
      process.stdout.write(stubOutput("seal.info", { id }, json));
    });

  cmd
    .command("verify")
    .description("Verify a seal")
    .argument("<id>", "Seal ID")
    .action((id: string) => {
      process.stdout.write(stubOutput("seal.verify", { id }, false));
    });

  cmd
    .command("history")
    .description("Show seal chain history")
    .argument("<cred-id>", "Credential ID")
    .action((credId: string) => {
      process.stdout.write(stubOutput("seal.history", { credId }, false));
    });

  return cmd;
}
