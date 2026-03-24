/**
 * Policy management commands for the `xs policy` subcommand group.
 *
 * Provides CRUD operations for policies via the daemon admin socket.
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
 * Create the `policy` subcommand group.
 *
 * Subcommands: create, list, info, update, rm.
 */
export function createPolicyCommands(): Command {
  const cmd = new Command("policy").description("Policy management");

  cmd
    .command("create")
    .description("Create a policy")
    .requiredOption("--label <name>", "Human-readable name")
    .option("--allow <scopes>", "Allowed scopes (comma-separated)")
    .option("--deny <scopes>", "Denied scopes (comma-separated)")
    .option("--json", "JSON output")
    .action(
      (opts: { label: string; allow?: string; deny?: string; json?: true }) => {
        const json = opts.json === true;
        const params: Record<string, unknown> = { label: opts.label };
        if (opts.allow !== undefined) {
          params["allow"] = opts.allow.split(",");
        }
        if (opts.deny !== undefined) {
          params["deny"] = opts.deny.split(",");
        }
        process.stdout.write(stubOutput("policy.create", params, json));
      },
    );

  cmd
    .command("list")
    .description("List policies")
    .option("--json", "JSON output")
    .action((opts: { json?: true }) => {
      const json = opts.json === true;
      process.stdout.write(stubOutput("policy.list", {}, json));
    });

  cmd
    .command("info")
    .description("Show policy details")
    .argument("<id>", "Policy ID")
    .option("--json", "JSON output")
    .action((id: string, opts: { json?: true }) => {
      const json = opts.json === true;
      process.stdout.write(stubOutput("policy.info", { id }, json));
    });

  cmd
    .command("update")
    .description("Update a policy")
    .argument("<id>", "Policy ID")
    .option("--allow <scopes>", "Update allowed scopes")
    .option("--deny <scopes>", "Update denied scopes")
    .option("--label <name>", "Update label")
    .action(
      (id: string, opts: { allow?: string; deny?: string; label?: string }) => {
        const params: Record<string, unknown> = { id };
        if (opts.allow !== undefined) {
          params["allow"] = opts.allow.split(",");
        }
        if (opts.deny !== undefined) {
          params["deny"] = opts.deny.split(",");
        }
        if (opts.label !== undefined) params["label"] = opts.label;
        process.stdout.write(stubOutput("policy.update", params, false));
      },
    );

  cmd
    .command("rm")
    .description("Remove a policy")
    .argument("<id>", "Policy ID")
    .option("--force", "Execute without confirmation")
    .action((id: string, opts: { force?: true }) => {
      process.stdout.write(
        stubOutput("policy.rm", { id, force: opts.force === true }, false),
      );
    });

  return cmd;
}
