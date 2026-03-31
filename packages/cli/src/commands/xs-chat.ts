/**
 * Chat management commands for the `xs chat` subcommand group.
 *
 * Daemon-backed conversation lifecycle operations via the admin socket.
 * RPC calls use `chat.*` action IDs registered in the runtime.
 *
 * Follows the same contract-first pattern as `xs-credential.ts`.
 *
 * @module
 */

import { Command } from "commander";
import type { SignetError } from "@xmtp/signet-schemas";
import { exitCodeFromCategory } from "../output/exit-codes.js";
import { formatOutput } from "../output/formatter.js";
import {
  createWithDaemonClient,
  type WithDaemonClient,
} from "./daemon-client.js";

/** Dependencies for v1 chat commands. */
export interface XsChatCommandDeps {
  readonly withDaemonClient: WithDaemonClient;
  readonly writeStdout: (message: string) => void;
  readonly writeStderr: (message: string) => void;
  readonly exit: (code: number) => void;
}

const defaultDeps: XsChatCommandDeps = {
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

function writeError(
  deps: XsChatCommandDeps,
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

/**
 * Create the `chat` subcommand group.
 *
 * Subcommands: create, list, info, update, sync, join, invite, leave, rm, member.
 */
export function createChatCommands(
  deps: Partial<XsChatCommandDeps> = {},
): Command {
  const resolvedDeps: XsChatCommandDeps = { ...defaultDeps, ...deps };
  const cmd = new Command("chat").description("Chat management");

  cmd
    .command("create")
    .description("Create a conversation")
    .option("--config <path>", "Path to config file")
    .requiredOption("--name <name>", "Conversation name")
    .option("--members <inboxIds>", "Member inbox IDs (comma-separated)")
    .option("--as <inbox>", "Inbox ID to act as")
    .option("--op <operator>", "Operator ID")
    .option("--json", "JSON output")
    .action(
      async (opts: {
        config?: string;
        name: string;
        members?: string;
        as?: string;
        op?: string;
        json?: true;
      }) => {
        const json = opts.json === true;
        const payload: Record<string, unknown> = {
          name: opts.name,
          memberInboxIds:
            opts.members !== undefined
              ? opts.members
                  .split(",")
                  .map((m) => m.trim())
                  .filter((m) => m.length > 0)
              : [],
        };
        if (opts.as !== undefined) payload["creatorIdentityLabel"] = opts.as;
        if (opts.op !== undefined) payload["operatorId"] = opts.op;

        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) => client.request("chat.create", payload),
        );

        if (result.isErr()) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
      },
    );

  cmd
    .command("list")
    .description("List conversations")
    .option("--config <path>", "Path to config file")
    .option("--as <inbox>", "Inbox ID to act as")
    .option("--op <operator>", "Filter by operator")
    .option("--watch", "Watch for changes")
    .option("--json", "JSON output")
    .action(
      async (opts: {
        config?: string;
        as?: string;
        op?: string;
        watch?: true;
        json?: true;
      }) => {
        const json = opts.json === true;
        const payload: Record<string, unknown> = {};
        if (opts.as !== undefined) payload["identityLabel"] = opts.as;
        if (opts.op !== undefined) payload["operatorId"] = opts.op;

        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) => client.request("chat.list", payload),
        );

        if (result.isErr()) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
      },
    );

  cmd
    .command("info")
    .description("Show conversation details")
    .argument("<id>", "Conversation ID")
    .option("--config <path>", "Path to config file")
    .option("--only <field>", "Show only a specific field")
    .option("--json", "JSON output")
    .action(
      async (
        id: string,
        opts: { config?: string; only?: string; json?: true },
      ) => {
        const json = opts.json === true;
        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) => client.request("chat.info", { chatId: id }),
        );

        if (result.isErr()) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
      },
    );

  cmd
    .command("update")
    .description("Update conversation metadata")
    .argument("<id>", "Conversation ID")
    .option("--config <path>", "Path to config file")
    .option("--name <name>", "New name")
    .option("--description <desc>", "New description")
    .option("--image <url>", "New image URL")
    .option("--json", "JSON output")
    .action(async () => {
      resolvedDeps.writeStderr("This command is not yet implemented.\n");
      resolvedDeps.exit(1);
    });

  cmd
    .command("sync")
    .description("Sync conversations")
    .argument("[id]", "Optional conversation ID")
    .option("--config <path>", "Path to config file")
    .option("--as <identity>", "Identity to act as")
    .option("--json", "JSON output")
    .action(async () => {
      resolvedDeps.writeStderr("This command is not yet implemented.\n");
      resolvedDeps.exit(1);
    });

  cmd
    .command("join")
    .description("Join a conversation via invite link")
    .argument("<url>", "Invite URL")
    .option("--config <path>", "Path to config file")
    .option("--as <inbox>", "Inbox ID to act as")
    .option("--timeout <seconds>", "Timeout in seconds")
    .option("--json", "JSON output")
    .action(
      async (
        url: string,
        opts: { config?: string; as?: string; timeout?: string; json?: true },
      ) => {
        const json = opts.json === true;
        const payload: Record<string, unknown> = { inviteUrl: url };
        if (opts.as !== undefined) payload["label"] = opts.as;
        if (opts.timeout !== undefined) {
          payload["timeoutSeconds"] = Number.parseInt(opts.timeout, 10);
        }

        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) => client.request("chat.join", payload),
        );

        if (result.isErr()) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
      },
    );

  cmd
    .command("invite")
    .description("Generate an invite link")
    .argument("<id>", "Conversation ID")
    .option("--config <path>", "Path to config file")
    .option("--as <inbox>", "Inbox ID to act as")
    .option("--name <name>", "Invite display name")
    .option("--description <desc>", "Invite description")
    .option("--json", "JSON output")
    .action(
      async (
        id: string,
        opts: {
          config?: string;
          as?: string;
          name?: string;
          description?: string;
          json?: true;
        },
      ) => {
        const json = opts.json === true;
        const payload: Record<string, unknown> = { chatId: id };
        if (opts.as !== undefined) payload["identityLabel"] = opts.as;
        if (opts.name !== undefined) payload["name"] = opts.name;
        if (opts.description !== undefined) {
          payload["description"] = opts.description;
        }

        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) => client.request("chat.invite", payload),
        );

        if (result.isErr()) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
      },
    );

  cmd
    .command("leave")
    .description("Leave a conversation")
    .argument("<id>", "Conversation ID")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async () => {
      resolvedDeps.writeStderr("This command is not yet implemented.\n");
      resolvedDeps.exit(1);
    });

  cmd
    .command("rm")
    .description("Remove a conversation")
    .argument("<id>", "Conversation ID")
    .option("--config <path>", "Path to config file")
    .option("--force", "Execute without confirmation")
    .option("--json", "JSON output")
    .action(async () => {
      resolvedDeps.writeStderr("This command is not yet implemented.\n");
      resolvedDeps.exit(1);
    });

  // --- member subgroup ---

  const member = new Command("member").description("Manage chat members");

  member
    .command("list")
    .description("List members of a conversation")
    .argument("<id>", "Conversation ID")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (id: string, opts: { config?: string; json?: true }) => {
      const json = opts.json === true;
      const result = await resolvedDeps.withDaemonClient(
        { configPath: opts.config },
        (client) => client.request("chat.members", { chatId: id }),
      );

      if (result.isErr()) {
        writeError(resolvedDeps, result.error, json);
        return;
      }

      resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
    });

  member
    .command("add")
    .description("Add a member to a conversation")
    .argument("<id>", "Conversation ID")
    .argument("<inbox>", "Inbox ID to add")
    .option("--config <path>", "Path to config file")
    .option("--as <identity>", "Identity to act as")
    .option("--json", "JSON output")
    .action(
      async (
        id: string,
        inbox: string,
        opts: { config?: string; as?: string; json?: true },
      ) => {
        const json = opts.json === true;
        const payload: Record<string, unknown> = { chatId: id, inboxId: inbox };
        if (opts.as !== undefined) payload["identityLabel"] = opts.as;

        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) => client.request("chat.add-member", payload),
        );

        if (result.isErr()) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
      },
    );

  member
    .command("rm")
    .description("Remove a member from a conversation")
    .argument("<id>", "Conversation ID")
    .argument("<inbox>", "Inbox ID to remove")
    .option("--config <path>", "Path to config file")
    .option("--as <identity>", "Identity to act as")
    .option("--json", "JSON output")
    .action(async () => {
      resolvedDeps.writeStderr("This command is not yet implemented.\n");
      resolvedDeps.exit(1);
    });

  member
    .command("promote")
    .description("Promote a member to admin")
    .argument("<id>", "Conversation ID")
    .argument("<inbox>", "Inbox ID to promote")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async () => {
      resolvedDeps.writeStderr("This command is not yet implemented.\n");
      resolvedDeps.exit(1);
    });

  member
    .command("demote")
    .description("Demote a member from admin")
    .argument("<id>", "Conversation ID")
    .argument("<inbox>", "Inbox ID to demote")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async () => {
      resolvedDeps.writeStderr("This command is not yet implemented.\n");
      resolvedDeps.exit(1);
    });

  cmd.addCommand(member);

  return cmd;
}
