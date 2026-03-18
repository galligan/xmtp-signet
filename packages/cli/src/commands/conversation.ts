import { Command } from "commander";
import type { SignetError } from "@xmtp/signet-schemas";
import { exitCodeFromCategory } from "../output/exit-codes.js";
import { formatOutput } from "../output/formatter.js";
import {
  createWithDaemonClient,
  type WithDaemonClient,
} from "./daemon-client.js";

/** Dependencies for conversation management CLI commands. */
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
 * - list: List conversations the signet participates in
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

  cmd
    .command("invite")
    .description("Generate a Convos-compatible invite URL for a group")
    .argument("<group-id>", "Group conversation ID")
    .option("--as <label>", "Identity label")
    .option("--name <name>", "Override group name in invite")
    .option("--description <desc>", "Override description in invite")
    .option("--config <path>", "Path to config file")
    .option("--format <type>", "Output format: link, qr, or both", "both")
    .option("--json", "JSON output")
    .action(async (groupId: string, options) => {
      const json = options.json === true;
      const format =
        typeof options.format === "string" ? options.format : "both";

      const params: Record<string, unknown> = { groupId };
      if (typeof options.as === "string") params["identityLabel"] = options.as;
      if (typeof options.name === "string") params["name"] = options.name;
      if (typeof options.description === "string")
        params["description"] = options.description;

      const result = await d.withDaemonClient(
        {
          configPath:
            typeof options.config === "string" ? options.config : undefined,
        },
        (client) => client.request<unknown>("conversation.invite", params),
      );

      if (result.isErr()) {
        writeError(d, result.error, json);
        return;
      }

      const inviteResult = result.value as Record<string, unknown>;
      const inviteUrl =
        typeof inviteResult["inviteUrl"] === "string"
          ? inviteResult["inviteUrl"]
          : "";
      const groupName =
        typeof inviteResult["groupName"] === "string"
          ? inviteResult["groupName"]
          : "unnamed";

      if (json) {
        const { renderQrToDataUrl } = await import("../invite/qr.js");
        const qrDataUrl = await renderQrToDataUrl(inviteUrl);
        d.writeStdout(
          formatOutput({ ...inviteResult, qrDataUrl }, { json }) + "\n",
        );
        return;
      }

      d.writeStdout(`Group: ${groupName} (${groupId})\n`);

      if (format === "link" || format === "both") {
        d.writeStdout(`\nInvite URL:\n${inviteUrl}\n`);
      }

      if (format === "qr" || format === "both") {
        const { renderQrToTerminal } = await import("../invite/qr.js");
        const qr = await renderQrToTerminal(inviteUrl);
        d.writeStdout(`\n${qr}`);
      }
    });

  cmd
    .command("join")
    .description("Join a Convos conversation via invite URL")
    .argument("<invite-url>", "Convos invite URL or slug")
    .option("--label <name>", "Label for the new identity")
    .option("--timeout <seconds>", "Timeout in seconds", "60")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (inviteUrl: string, options) => {
      const json = options.json === true;
      const timeoutSeconds =
        typeof options.timeout === "string"
          ? parseInt(options.timeout, 10)
          : 60;

      const result = await d.withDaemonClient(
        {
          configPath:
            typeof options.config === "string" ? options.config : undefined,
        },
        (client) =>
          client.request<unknown>("conversation.join", {
            inviteUrl,
            label:
              typeof options.label === "string" ? options.label : undefined,
            timeoutSeconds: Number.isFinite(timeoutSeconds)
              ? timeoutSeconds
              : 60,
          }),
      );

      if (result.isErr()) {
        writeError(d, result.error, json);
        return;
      }

      d.writeStdout(formatOutput(result.value, { json }) + "\n");
    });

  cmd
    .command("members")
    .description("List members of a group conversation")
    .argument("<group-id>", "Group conversation ID")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .option("--watch", "Poll for membership changes")
    .action(async (groupId: string, options) => {
      const json = options.json === true;
      const watch = options.watch === true;
      const configPath =
        typeof options.config === "string" ? options.config : undefined;

      const fetchMembers = async (): Promise<unknown | undefined> => {
        const result = await d.withDaemonClient({ configPath }, (client) =>
          client.request<unknown>("conversation.info", { groupId }),
        );

        if (result.isErr()) {
          writeError(d, result.error, json);
          return undefined;
        }

        return result.value;
      };

      const info = await fetchMembers();
      if (info === undefined) return;

      d.writeStdout(formatOutput(info, { json }) + "\n");

      if (!watch) return;

      let lastSerialized = JSON.stringify(info);
      const interval = setInterval(async () => {
        const updated = await fetchMembers();
        if (updated === undefined) return;

        const serialized = JSON.stringify(updated);
        if (serialized !== lastSerialized) {
          lastSerialized = serialized;
          d.writeStdout(formatOutput(updated, { json }) + "\n");
        }
      }, 2000);

      const cleanup = () => {
        clearInterval(interval);
      };

      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
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
