/**
 * Utility commands that attach directly to the `xs` program root.
 *
 * Includes: logs, lookup, search, and consent management.
 * These are grouped here because they don't warrant individual files
 * but need richer option sets than simple stubs provide.
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
 * Create utility commands for the top-level program.
 *
 * Returns an array of Command instances to be added individually
 * to the program (not as a group).
 */
export function createUtilityCommands(): Command[] {
  const commands: Command[] = [];

  // --- logs ---

  const logs = new Command("logs")
    .description("View audit logs")
    .option("--watch", "Watch for new entries")
    .option("--since <time>", "Show logs since time")
    .option("--limit <n>", "Limit number of entries")
    .option("--json", "JSON output")
    .action(
      (opts: { watch?: true; since?: string; limit?: string; json?: true }) => {
        const params: Record<string, unknown> = {};
        if (opts.watch === true) params["watch"] = true;
        if (opts.since !== undefined) params["since"] = opts.since;
        if (opts.limit !== undefined) {
          params["limit"] = Number.parseInt(opts.limit, 10);
        }
        process.stdout.write(stubOutput("logs", params, opts.json === true));
      },
    );
  logs
    .command("export")
    .description("Export a full runtime state dump")
    .option("--json", "JSON output")
    .action((opts: { json?: true }) => {
      const params: Record<string, unknown> = {};
      process.stdout.write(
        stubOutput("logs.export", params, opts.json === true),
      );
    });
  commands.push(logs);

  // --- lookup ---

  const lookup = new Command("lookup")
    .description("Look up an address or ID")
    .argument("<address>", "Address or ID to look up")
    .option("--json", "JSON output")
    .action((address: string, opts: { json?: true }) => {
      process.stdout.write(
        stubOutput("lookup", { address }, opts.json === true),
      );
    });
  commands.push(lookup);

  // --- search ---

  const search = new Command("search")
    .description("Search conversations and messages")
    .argument("<query>", "Search query")
    .option("--chat <id>", "Filter by conversation")
    .option("--op <id>", "Filter by operator")
    .option("--limit <n>", "Limit results")
    .option("--json", "JSON output")
    .action(
      (
        query: string,
        opts: { chat?: string; op?: string; limit?: string; json?: true },
      ) => {
        const params: Record<string, unknown> = { query };
        if (opts.chat !== undefined) params["chatId"] = opts.chat;
        if (opts.op !== undefined) params["operatorId"] = opts.op;
        if (opts.limit !== undefined) {
          params["limit"] = Number.parseInt(opts.limit, 10);
        }
        process.stdout.write(stubOutput("search", params, opts.json === true));
      },
    );
  commands.push(search);

  // --- consent ---

  const consent = new Command("consent").description("Consent management");

  consent
    .command("check")
    .description("Check consent state")
    .argument("<entity>", "Entity to check")
    .option("--as <inbox>", "Inbox ID to act as")
    .action((entity: string, opts: { as?: string }) => {
      const params: Record<string, unknown> = { entity };
      if (opts.as !== undefined) params["as"] = opts.as;
      process.stdout.write(stubOutput("consent.check", params, false));
    });

  consent
    .command("allow")
    .description("Allow a contact")
    .argument("<entity>", "Entity to allow")
    .action((entity: string) => {
      process.stdout.write(stubOutput("consent.allow", { entity }, false));
    });

  consent
    .command("deny")
    .description("Deny a contact")
    .argument("<entity>", "Entity to deny")
    .action((entity: string) => {
      process.stdout.write(stubOutput("consent.deny", { entity }, false));
    });

  commands.push(consent);

  return commands;
}
