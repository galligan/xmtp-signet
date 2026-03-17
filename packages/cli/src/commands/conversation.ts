import { Command } from "commander";
import type { BrokerError } from "@xmtp-broker/schemas";
import { exitCodeFromCategory } from "../output/exit-codes.js";
import { formatOutput } from "../output/formatter.js";
import {
  createWithDaemonClient,
  type WithDaemonClient,
} from "./daemon-client.js";

export interface ConversationCommandDeps {
  readonly withDaemonClient: WithDaemonClient;
  readonly writeStdout: (message: string) => void;
  readonly writeStderr: (message: string) => void;
  readonly exit: (code: number) => void;
}

const defaultDeps: ConversationCommandDeps = {
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

/**
 * Conversation operation commands. All require daemon and admin auth.
 *
 * - list: List conversations the broker participates in
 * - info: Show group metadata
 * - create: Create a new group conversation
 * - add-member: Add a member to a group
 */
export function createConversationCommands(
  deps: Partial<ConversationCommandDeps> = {},
): Command {
  const d: ConversationCommandDeps = { ...defaultDeps, ...deps };
  const cmd = new Command("conversation").description(
    "Conversation operations",
  );

  cmd
    .command("create")
    .description("Create a new group conversation")
    .option("--name <name>", "Group name")
    .option("--members <inboxIds>", "Comma-separated member inbox IDs")
    .option("--as <label>", "Identity label for the creator")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (options) => {
      const json = options.json === true;
      const memberInboxIds = parseMembers(options.members);

      const result = await d.withDaemonClient(
        {
          configPath:
            typeof options.config === "string" ? options.config : undefined,
        },
        (client) =>
          client.request<unknown>("conversation.create", {
            name: typeof options.name === "string" ? options.name : undefined,
            memberInboxIds,
            creatorIdentityLabel:
              typeof options.as === "string" ? options.as : undefined,
          }),
      );

      if (result.isErr()) {
        writeError(d, result.error, json);
        return;
      }

      d.writeStdout(formatOutput(result.value, { json }) + "\n");
    });

  cmd
    .command("list")
    .description("List conversations")
    .option("--as <label>", "Identity label to list conversations for")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (options) => {
      const json = options.json === true;

      const result = await d.withDaemonClient(
        {
          configPath:
            typeof options.config === "string" ? options.config : undefined,
        },
        (client) =>
          client.request<unknown>("conversation.list", {
            identityLabel:
              typeof options.as === "string" ? options.as : undefined,
          }),
      );

      if (result.isErr()) {
        writeError(d, result.error, json);
        return;
      }

      d.writeStdout(formatOutput(result.value, { json }) + "\n");
    });

  cmd
    .command("info")
    .description("Show group conversation details")
    .argument("<group-id>", "Group conversation ID")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (groupId, options) => {
      const json = options.json === true;

      const result = await d.withDaemonClient(
        {
          configPath:
            typeof options.config === "string" ? options.config : undefined,
        },
        (client) => client.request<unknown>("conversation.info", { groupId }),
      );

      if (result.isErr()) {
        writeError(d, result.error, json);
        return;
      }

      d.writeStdout(formatOutput(result.value, { json }) + "\n");
    });

  cmd
    .command("add-member")
    .description("Add a member to a group conversation")
    .argument("<group-id>", "Group conversation ID")
    .argument("<inbox-id>", "Member inbox ID to add")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (groupId, inboxId, options) => {
      const json = options.json === true;

      const result = await d.withDaemonClient(
        {
          configPath:
            typeof options.config === "string" ? options.config : undefined,
        },
        (client) =>
          client.request<unknown>("conversation.add-member", {
            groupId,
            inboxId,
          }),
      );

      if (result.isErr()) {
        writeError(d, result.error, json);
        return;
      }

      d.writeStdout(formatOutput(result.value, { json }) + "\n");
    });

  return cmd;
}

function parseMembers(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function writeError(
  deps: ConversationCommandDeps,
  error: BrokerError,
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
