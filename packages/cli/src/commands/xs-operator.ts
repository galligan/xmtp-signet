/**
 * Operator management commands for the `xs operator` subcommand group.
 *
 * Provides CRUD operations for operators via the daemon admin socket.
 * Each action constructs an RPC-compatible payload and delegates to
 * the daemon client. When the daemon client is not yet wired, commands
 * output the payload as JSON for integration testing.
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
 * Create the `operator` subcommand group.
 *
 * Subcommands: create, list, info, rename, rm.
 */
export function createOperatorCommands(): Command {
  const cmd = new Command("operator").description("Manage operators");

  cmd
    .command("create")
    .description("Create a new operator")
    .requiredOption("--label <name>", "Human-readable name")
    .option("--role <role>", "Role: operator, admin", "operator")
    .option("--scope <mode>", "Scope mode: per-chat, shared", "per-chat")
    .option(
      "--provider <provider>",
      "Wallet provider: internal, ows",
      "internal",
    )
    .option("--json", "JSON output")
    .action(
      (opts: {
        label: string;
        role: string;
        scope: string;
        provider: string;
        json?: true;
      }) => {
        const json = opts.json === true;
        process.stdout.write(
          stubOutput(
            "operator.create",
            {
              label: opts.label,
              role: opts.role,
              scope: opts.scope,
              provider: opts.provider,
            },
            json,
          ),
        );
      },
    );

  cmd
    .command("list")
    .description("List operators")
    .option("--json", "JSON output")
    .action((opts: { json?: true }) => {
      const json = opts.json === true;
      process.stdout.write(stubOutput("operator.list", {}, json));
    });

  cmd
    .command("info")
    .description("Show operator details")
    .argument("<id>", "Operator ID")
    .option("--json", "JSON output")
    .action((id: string, opts: { json?: true }) => {
      const json = opts.json === true;
      process.stdout.write(stubOutput("operator.info", { id }, json));
    });

  cmd
    .command("rename")
    .description("Rename an operator")
    .argument("<id>", "Operator ID")
    .requiredOption("--label <name>", "New name")
    .action((id: string, opts: { label: string }) => {
      process.stdout.write(
        stubOutput("operator.rename", { id, label: opts.label }, false),
      );
    });

  cmd
    .command("rm")
    .description("Remove an operator")
    .argument("<id>", "Operator ID")
    .option("--force", "Execute without confirmation")
    .action((id: string, opts: { force?: true }) => {
      process.stdout.write(
        stubOutput("operator.rm", { id, force: opts.force === true }, false),
      );
    });

  return cmd;
}
