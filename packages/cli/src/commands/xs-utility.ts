/**
 * Utility commands that attach directly to the `xs` program root.
 *
 * Includes: logs, lookup, search, and consent management.
 * These are grouped here because they don't warrant individual files
 * but need richer option sets than simple stubs provide.
 *
 * @module
 */

import { Command, Option } from "commander";
import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import type { AuditEntry } from "../audit/log.js";
import { formatOutput } from "../output/formatter.js";
import { exitCodeFromCategory } from "../output/exit-codes.js";
import {
  createWithDaemonClient,
  type WithDaemonClient,
} from "./daemon-client.js";

/** Dependencies for utility commands. */
export interface XsUtilityCommandDeps {
  readonly withDaemonClient: WithDaemonClient;
  readonly writeStdout: (message: string) => void;
  readonly writeStderr: (message: string) => void;
  readonly exit: (code: number) => void;
}

const defaultUtilityDeps: XsUtilityCommandDeps = {
  withDaemonClient: createWithDaemonClient(),
  writeStdout(message) {
    process.stdout.write(message);
  },
  writeStderr(message) {
    process.stderr.write(message);
  },
  exit(code) {
    process.exit(code);
  },
};

interface LookupResolveResult {
  readonly query: string;
  readonly found: boolean;
  readonly mapping: {
    readonly localId: string;
    readonly networkId: string;
  } | null;
  readonly inbox: {
    readonly id: string;
    readonly label: string | null;
    readonly networkInboxId: string | null;
    readonly groupId: string | null;
    readonly createdAt: string;
  } | null;
  readonly operator: {
    readonly id: string;
    readonly label: string;
    readonly role: string;
    readonly status: string;
  } | null;
  readonly policy: {
    readonly id: string;
    readonly label: string;
    readonly updatedAt: string;
  } | null;
  readonly credential: {
    readonly id: string;
    readonly operatorId: string;
    readonly policyId: string | null;
    readonly chatIds: readonly string[];
    readonly status: string;
    readonly expiresAt: string;
  } | null;
}

function writeError(
  deps: XsUtilityCommandDeps,
  error: SignetError,
  json: boolean,
): void {
  deps.writeStderr(
    formatOutput(
      {
        error: error._tag,
        category: error.category,
        message: error.message,
        ...(error.context !== null ? { context: error.context } : {}),
      },
      { json },
    ) + "\n",
  );
  deps.exit(exitCodeFromCategory(error.category));
}

function formatLookupResult(result: LookupResolveResult): string {
  if (!result.found) {
    return `No local match found for "${result.query}".`;
  }

  const lines = [`Query: ${result.query}`];

  if (result.mapping) {
    lines.push(`Local ID: ${result.mapping.localId}`);
    lines.push(`Network ID: ${result.mapping.networkId}`);
  }

  if (result.inbox) {
    lines.push(
      `Inbox: ${result.inbox.id}${result.inbox.label ? ` (${result.inbox.label})` : ""}`,
    );
    if (result.inbox.networkInboxId) {
      lines.push(`Inbox Network ID: ${result.inbox.networkInboxId}`);
    }
    if (result.inbox.groupId) {
      lines.push(`Bound Group: ${result.inbox.groupId}`);
    }
  }

  if (result.operator) {
    lines.push(
      `Operator: ${result.operator.id} (${result.operator.label}) role=${result.operator.role} status=${result.operator.status}`,
    );
  }

  if (result.policy) {
    lines.push(`Policy: ${result.policy.id} (${result.policy.label})`);
  }

  if (result.credential) {
    lines.push(
      `Credential: ${result.credential.id} operator=${result.credential.operatorId} status=${result.credential.status}`,
    );
    if (result.credential.policyId) {
      lines.push(`Credential Policy: ${result.credential.policyId}`);
    }
    lines.push(`Credential Chats: ${result.credential.chatIds.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Create utility commands for the top-level program.
 *
 * Returns an array of Command instances to be added individually
 * to the program (not as a group).
 */
export function createUtilityCommands(
  deps: Partial<XsUtilityCommandDeps> = {},
): Command[] {
  const resolvedDeps: XsUtilityCommandDeps = {
    ...defaultUtilityDeps,
    ...deps,
  };
  const { withDaemonClient } = resolvedDeps;
  const commands: Command[] = [];

  // --- logs ---

  const logs = new Command("logs")
    .description("View audit logs")
    .option("--since <time>", "Show logs since timestamp (ISO 8601)")
    .option("--limit <n>", "Limit number of entries")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(
      async (opts: {
        since?: string;
        limit?: string;
        config?: string;
        json?: true;
      }) => {
        const json = opts.json === true;
        const input: Record<string, unknown> = {};
        if (opts.since !== undefined) input["since"] = opts.since;
        if (opts.limit !== undefined) {
          input["limit"] = Number.parseInt(opts.limit, 10);
        }

        const result = await withDaemonClient(
          { configPath: opts.config },
          async (client) =>
            client.request<readonly AuditEntry[]>("admin.logs", input),
        );

        if (Result.isError(result)) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        if (json) {
          resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
        } else {
          for (const entry of result.value) {
            const line = `${entry.timestamp} [${entry.actor}] ${entry.action}${entry.success ? "" : " FAILED"}${entry.target !== undefined ? ` target=${entry.target}` : ""}`;
            resolvedDeps.writeStdout(line + "\n");
          }
        }
      },
    );
  logs
    .command("export")
    .description("Export the full audit log as NDJSON")
    .option("--config <path>", "Path to config file")
    .action(async (opts: { config?: string }) => {
      const result = await withDaemonClient(
        { configPath: opts.config },
        async (client) =>
          client.request<readonly AuditEntry[]>("admin.logs-export", {}),
      );

      if (Result.isError(result)) {
        writeError(resolvedDeps, result.error, true);
        return;
      }

      // NDJSON: one JSON object per line
      for (const entry of result.value) {
        resolvedDeps.writeStdout(JSON.stringify(entry) + "\n");
      }
    });
  commands.push(logs);

  // --- lookup ---

  const lookup = new Command("lookup")
    .description("Resolve a local or network identifier")
    .argument("<query>", "Address, label, or ID to look up")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (query: string, opts: { config?: string; json?: true }) => {
      const json = opts.json === true;
      const result = await withDaemonClient(
        { configPath: opts.config },
        async (client) =>
          client.request<LookupResolveResult>("lookup.resolve", { query }),
      );

      if (Result.isError(result)) {
        writeError(resolvedDeps, result.error, json);
        return;
      }

      if (json) {
        resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
        return;
      }

      resolvedDeps.writeStdout(formatLookupResult(result.value) + "\n");
    });
  commands.push(lookup);

  // --- search ---

  const searchTypeOption = new Option("--type <type>", "Search type").choices([
    "messages",
    "resources",
    "operator",
    "policy",
    "credential",
    "conversation",
  ]);

  const search = new Command("search")
    .description("Search messages and resources")
    .argument("<query>", "Search query")
    .option("--chat <id>", "Filter by conversation")
    .addOption(searchTypeOption)
    .option("--limit <n>", "Limit results")
    .option("--as <label>", "Identity label for message search")
    .option(
      "--dangerously-allow-message-read",
      "Request a locally approved admin read elevation for message search",
    )
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(
      async (
        query: string,
        opts: {
          chat?: string;
          type?: string;
          limit?: string;
          as?: string;
          dangerouslyAllowMessageRead?: true;
          config?: string;
          json?: true;
        },
      ) => {
        const json = opts.json === true;

        // Determine which action to dispatch based on --type
        const resourceTypes = [
          "resources",
          "operator",
          "policy",
          "credential",
          "conversation",
        ];
        const isResourceSearch =
          opts.type !== undefined && resourceTypes.includes(opts.type);

        if (isResourceSearch) {
          // search.resources
          const input: Record<string, unknown> = { query };
          if (opts.type !== "resources") input["type"] = opts.type;
          if (opts.limit !== undefined) {
            input["limit"] = Number.parseInt(opts.limit, 10);
          }

          const result = await withDaemonClient(
            { configPath: opts.config },
            async (client) =>
              client.request<{
                query: string;
                matches: readonly {
                  type: string;
                  id: string;
                  label: string;
                }[];
                total: number;
              }>("search.resources", input),
          );

          if (Result.isError(result)) {
            writeError(resolvedDeps, result.error, json);
            return;
          }

          if (json) {
            resolvedDeps.writeStdout(
              formatOutput(result.value, { json }) + "\n",
            );
          } else {
            if (result.value.matches.length === 0) {
              resolvedDeps.writeStdout("No resources found.\n");
            } else {
              for (const hit of result.value.matches) {
                resolvedDeps.writeStdout(
                  `[${hit.type}] ${hit.id}  ${hit.label}\n`,
                );
              }
              resolvedDeps.writeStdout(`\n${result.value.total} result(s)\n`);
            }
          }
        } else {
          // search.messages (default)
          const input: Record<string, unknown> = { query };
          if (opts.chat !== undefined) input["chatId"] = opts.chat;
          if (opts.limit !== undefined) {
            input["limit"] = Number.parseInt(opts.limit, 10);
          }
          if (opts.as !== undefined) input["identityLabel"] = opts.as;
          if (opts.dangerouslyAllowMessageRead === true) {
            input["dangerouslyAllowMessageRead"] = true;
          }

          const result = await withDaemonClient(
            { configPath: opts.config },
            async (client) =>
              client.request<{
                query: string;
                matches: readonly {
                  chatId: string;
                  messageId: string;
                  senderInboxId: string;
                  content: string;
                  sentAt: string;
                }[];
                total: number;
              }>("search.messages", input),
          );

          if (Result.isError(result)) {
            writeError(resolvedDeps, result.error, json);
            return;
          }

          if (json) {
            resolvedDeps.writeStdout(
              formatOutput(result.value, { json }) + "\n",
            );
          } else {
            if (result.value.matches.length === 0) {
              resolvedDeps.writeStdout("No messages found.\n");
            } else {
              for (const hit of result.value.matches) {
                const ts = hit.sentAt;
                const preview =
                  hit.content.length > 80
                    ? hit.content.slice(0, 80) + "..."
                    : hit.content;
                resolvedDeps.writeStdout(
                  `${ts} [${hit.chatId}] ${hit.senderInboxId}: ${preview}\n`,
                );
              }
              resolvedDeps.writeStdout(`\n${result.value.total} result(s)\n`);
            }
          }
        }
      },
    );
  commands.push(search);

  // --- consent ---

  const consent = new Command("consent").description("Consent management");

  consent
    .command("check")
    .description("Check consent state for an entity")
    .argument("<entity>", "Entity to check (inbox ID or group ID)")
    .option("--type <type>", "Entity type: inbox_id or group_id", "inbox_id")
    .option("--as <label>", "Identity label to act as")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(
      async (
        entity: string,
        opts: { type?: string; as?: string; config?: string; json?: true },
      ) => {
        const json = opts.json === true;
        const input: Record<string, unknown> = { entity };
        if (opts.type !== undefined) input["entityType"] = opts.type;
        if (opts.as !== undefined) input["identityLabel"] = opts.as;

        const result = await withDaemonClient(
          { configPath: opts.config },
          async (client) =>
            client.request<{
              entity: string;
              entityType: string;
              state: string;
            }>("consent.check", input),
        );

        if (Result.isError(result)) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
      },
    );

  consent
    .command("allow")
    .description("Allow messages from an entity")
    .argument("<entity>", "Entity to allow (inbox ID or group ID)")
    .option("--type <type>", "Entity type: inbox_id or group_id", "inbox_id")
    .option("--as <label>", "Identity label to act as")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(
      async (
        entity: string,
        opts: { type?: string; as?: string; config?: string; json?: true },
      ) => {
        const json = opts.json === true;
        const input: Record<string, unknown> = { entity };
        if (opts.type !== undefined) input["entityType"] = opts.type;
        if (opts.as !== undefined) input["identityLabel"] = opts.as;

        const result = await withDaemonClient(
          { configPath: opts.config },
          async (client) =>
            client.request<{
              entity: string;
              entityType: string;
              state: string;
            }>("consent.allow", input),
        );

        if (Result.isError(result)) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
      },
    );

  consent
    .command("deny")
    .description("Deny messages from an entity")
    .argument("<entity>", "Entity to deny (inbox ID or group ID)")
    .option("--type <type>", "Entity type: inbox_id or group_id", "inbox_id")
    .option("--as <label>", "Identity label to act as")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(
      async (
        entity: string,
        opts: { type?: string; as?: string; config?: string; json?: true },
      ) => {
        const json = opts.json === true;
        const input: Record<string, unknown> = { entity };
        if (opts.type !== undefined) input["entityType"] = opts.type;
        if (opts.as !== undefined) input["identityLabel"] = opts.as;

        const result = await withDaemonClient(
          { configPath: opts.config },
          async (client) =>
            client.request<{
              entity: string;
              entityType: string;
              state: string;
            }>("consent.deny", input),
        );

        if (Result.isError(result)) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
      },
    );

  commands.push(consent);

  return commands;
}
