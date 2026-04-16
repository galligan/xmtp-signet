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
import { requireForce } from "../output/confirm.js";
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

type InviteFormat = "link" | "qr" | "both";

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

function normalizeInviteFormat(format: string | undefined): InviteFormat {
  return format === "link" || format === "qr" || format === "both"
    ? format
    : "both";
}

async function writeInviteOutput(
  deps: XsChatCommandDeps,
  inviteResult: Record<string, unknown>,
  chatId: string,
  options: { readonly json: boolean; readonly format: InviteFormat },
): Promise<void> {
  const inviteUrl =
    typeof inviteResult["inviteUrl"] === "string"
      ? inviteResult["inviteUrl"]
      : "";
  const groupName =
    typeof inviteResult["groupName"] === "string"
      ? inviteResult["groupName"]
      : "unnamed";

  if (options.json) {
    const { renderQrToDataUrl } = await import("../invite/qr.js");
    const qrDataUrl = await renderQrToDataUrl(inviteUrl);
    deps.writeStdout(
      formatOutput({ ...inviteResult, qrDataUrl }, { json: true }) + "\n",
    );
    return;
  }

  deps.writeStdout(`Group: ${groupName} (${chatId})\n`);

  if (options.format === "link" || options.format === "both") {
    deps.writeStdout(`\nInvite URL:\n${inviteUrl}\n`);
  }

  if (options.format === "qr" || options.format === "both") {
    const { renderQrToTerminal } = await import("../invite/qr.js");
    const qr = await renderQrToTerminal(inviteUrl);
    deps.writeStdout(`\n${qr}`);
  }
}

/**
 * Create the `chat` subcommand group.
 *
 * Subcommands: create, list, info, update, sync, join, invite, update-profile, leave, rm, members.
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
    .action(
      async (
        id: string,
        opts: {
          config?: string;
          name?: string;
          description?: string;
          image?: string;
          json?: true;
        },
      ) => {
        const json = opts.json === true;
        const payload: Record<string, unknown> = { chatId: id };
        if (opts.name !== undefined) payload["name"] = opts.name;
        if (opts.description !== undefined) {
          payload["description"] = opts.description;
        }
        if (opts.image !== undefined) payload["imageUrl"] = opts.image;

        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) => client.request("chat.update", payload),
        );

        if (result.isErr()) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
      },
    );

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
    .option("--as <label>", "Label for the new joined identity")
    .option("--op <operator>", "Operator ID for profile defaults")
    .option("--profile-name <name>", "Explicit Convos profile name")
    .option("--timeout <seconds>", "Timeout in seconds")
    .option("--json", "JSON output")
    .action(
      async (
        url: string,
        opts: {
          config?: string;
          as?: string;
          op?: string;
          profileName?: string;
          timeout?: string;
          json?: true;
        },
      ) => {
        const json = opts.json === true;
        const payload: Record<string, unknown> = { inviteUrl: url };
        if (opts.as !== undefined) payload["label"] = opts.as;
        if (opts.op !== undefined) payload["operatorId"] = opts.op;
        if (opts.profileName !== undefined) {
          payload["profileName"] = opts.profileName;
        }
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
    .option("--format <type>", "Output format: link, qr, or both", "both")
    .option("--json", "JSON output")
    .action(
      async (
        id: string,
        opts: {
          config?: string;
          as?: string;
          name?: string;
          description?: string;
          format?: string;
          json?: true;
        },
      ) => {
        const json = opts.json === true;
        const format = normalizeInviteFormat(opts.format);
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

        await writeInviteOutput(
          resolvedDeps,
          result.value as Record<string, unknown>,
          id,
          { json, format },
        );
      },
    );

  cmd
    .command("update-profile")
    .description("Publish a Convos profile update")
    .argument("<id>", "Conversation ID")
    .option("--config <path>", "Path to config file")
    .option("--as <identity>", "Identity label to act as")
    .option("--op <operator>", "Operator ID for profile defaults")
    .option("--profile-name <name>", "Explicit Convos profile name")
    .option("--json", "JSON output")
    .action(
      async (
        id: string,
        opts: {
          config?: string;
          as?: string;
          op?: string;
          profileName?: string;
          json?: true;
        },
      ) => {
        const json = opts.json === true;
        const payload: Record<string, unknown> = { chatId: id };
        if (opts.as !== undefined) payload["identityLabel"] = opts.as;
        if (opts.op !== undefined) payload["operatorId"] = opts.op;
        if (opts.profileName !== undefined) {
          payload["profileName"] = opts.profileName;
        }

        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) => client.request("chat.update-profile", payload),
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
    .option("--purge", "Also clean up local state after leaving")
    .option("--force", "Execute without dry-run preview")
    .option("--json", "JSON output")
    .action(
      async (
        id: string,
        opts: { config?: string; purge?: true; force?: true; json?: true },
      ) => {
        const description =
          opts.purge === true
            ? `leave the XMTP group "${id}" and delete all local data`
            : `leave the XMTP group "${id}"`;
        if (
          !requireForce(
            opts,
            description,
            resolvedDeps.writeStderr,
            resolvedDeps.exit,
          )
        ) {
          return;
        }

        const json = opts.json === true;
        const payload: Record<string, unknown> = { chatId: id };
        if (opts.purge === true) payload["purge"] = true;

        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) => client.request("chat.leave", payload),
        );

        if (result.isErr()) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
      },
    );

  cmd
    .command("rm")
    .description("Remove a conversation")
    .argument("<id>", "Conversation ID")
    .option("--config <path>", "Path to config file")
    .option("--force", "Execute without dry-run preview")
    .option("--json", "JSON output")
    .action(
      async (
        id: string,
        opts: { config?: string; force?: true; json?: true },
      ) => {
        if (
          !requireForce(
            opts,
            `remove local conversation data for "${id}", revoke scoped credentials and seals`,
            resolvedDeps.writeStderr,
            resolvedDeps.exit,
          )
        ) {
          return;
        }

        const json = opts.json === true;
        const payload: Record<string, unknown> = { chatId: id, force: true };

        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) => client.request("chat.rm", payload),
        );

        if (result.isErr()) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
      },
    );

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
          (client) => client.request("chat.remove-member", payload),
        );

        if (result.isErr()) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
      },
    );

  member
    .command("promote")
    .description("Promote a member to admin")
    .argument("<id>", "Conversation ID")
    .argument("<inbox>", "Inbox ID to promote")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(
      async (
        id: string,
        inbox: string,
        opts: { config?: string; json?: true },
      ) => {
        const json = opts.json === true;
        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) =>
            client.request("chat.promote-member", {
              chatId: id,
              inboxId: inbox,
            }),
        );

        if (result.isErr()) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
      },
    );

  member
    .command("demote")
    .description("Demote a member from admin")
    .argument("<id>", "Conversation ID")
    .argument("<inbox>", "Inbox ID to demote")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(
      async (
        id: string,
        inbox: string,
        opts: { config?: string; json?: true },
      ) => {
        const json = opts.json === true;
        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) =>
            client.request("chat.demote-member", {
              chatId: id,
              inboxId: inbox,
            }),
        );

        if (result.isErr()) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
      },
    );

  cmd.addCommand(member);

  return cmd;
}
