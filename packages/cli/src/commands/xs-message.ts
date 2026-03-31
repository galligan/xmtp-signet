/**
 * Message commands for the `xs msg` subcommand group.
 *
 * Daemon-backed messaging operations via the admin socket.
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

/** Dependencies for v1 message commands. */
export interface XsMessageCommandDeps {
  readonly withDaemonClient: WithDaemonClient;
  readonly writeStdout: (message: string) => void;
  readonly writeStderr: (message: string) => void;
  readonly exit: (code: number) => void;
}

const defaultDeps: XsMessageCommandDeps = {
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
  deps: XsMessageCommandDeps,
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
 * Create the `msg` subcommand group.
 *
 * Subcommands: send, reply, react, read, list, info.
 */
export function createMessageCommands(
  deps: Partial<XsMessageCommandDeps> = {},
): Command {
  const resolvedDeps: XsMessageCommandDeps = { ...defaultDeps, ...deps };
  const cmd = new Command("msg").description("Messaging");

  cmd
    .command("send")
    .description("Send a message")
    .argument("<text>", "Message text")
    .option("--config <path>", "Path to config file")
    .requiredOption("--to <id>", "Conversation ID")
    .option("--as <inbox>", "Inbox ID to act as")
    .option("--op <operator>", "Operator ID")
    .option("--json", "JSON output")
    .action(
      async (
        text: string,
        opts: {
          config?: string;
          to: string;
          as?: string;
          op?: string;
          json?: true;
        },
      ) => {
        const json = opts.json === true;
        const payload: Record<string, unknown> = {
          text,
          chatId: opts.to,
        };
        if (opts.as !== undefined) payload["identityLabel"] = opts.as;
        if (opts.op !== undefined) payload["operatorId"] = opts.op;

        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) => client.request("message.send", payload),
        );

        if (result.isErr()) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
      },
    );

  cmd
    .command("reply")
    .description("Reply to a message")
    .argument("<text>", "Reply text")
    .option("--config <path>", "Path to config file")
    .requiredOption("--chat <id>", "Conversation ID")
    .requiredOption("--to <msg-id>", "Message ID to reply to")
    .option("--as <inbox>", "Inbox ID to act as")
    .option("--json", "JSON output")
    .action(
      async (
        text: string,
        opts: {
          config?: string;
          chat: string;
          to: string;
          as?: string;
          json?: true;
        },
      ) => {
        const json = opts.json === true;
        const payload: Record<string, unknown> = {
          chatId: opts.chat,
          messageId: opts.to,
          text,
        };
        if (opts.as !== undefined) payload["identityLabel"] = opts.as;

        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) => client.request("message.reply", payload),
        );

        if (result.isErr()) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
      },
    );

  cmd
    .command("react")
    .description("React to a message")
    .argument("<emoji>", "Reaction emoji")
    .option("--config <path>", "Path to config file")
    .requiredOption("--chat <id>", "Conversation ID")
    .requiredOption("--to <msg-id>", "Message ID to react to")
    .option("--as <inbox>", "Inbox ID to act as")
    .option("--json", "JSON output")
    .action(
      async (
        emoji: string,
        opts: {
          config?: string;
          chat: string;
          to: string;
          as?: string;
          json?: true;
        },
      ) => {
        const json = opts.json === true;
        const payload: Record<string, unknown> = {
          chatId: opts.chat,
          messageId: opts.to,
          reaction: emoji,
        };
        if (opts.as !== undefined) payload["identityLabel"] = opts.as;

        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) => client.request("message.react", payload),
        );

        if (result.isErr()) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
      },
    );

  cmd
    .command("read")
    .description("Mark messages as read")
    .option("--config <path>", "Path to config file")
    .requiredOption("--chat <id>", "Conversation ID")
    .option("--as <inbox>", "Inbox ID to act as")
    .option("--json", "JSON output")
    .action(
      async (opts: {
        config?: string;
        chat: string;
        as?: string;
        json?: true;
      }) => {
        const json = opts.json === true;
        const payload: Record<string, unknown> = { chatId: opts.chat };
        if (opts.as !== undefined) payload["identityLabel"] = opts.as;

        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) => client.request("message.read", payload),
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
    .description("List messages")
    .option("--config <path>", "Path to config file")
    .requiredOption("--from <chat>", "Conversation ID")
    .option("--as <inbox>", "Inbox ID to act as")
    .option("--watch", "Watch for new messages")
    .option("--json", "JSON output")
    .action(
      async (opts: {
        config?: string;
        from: string;
        as?: string;
        watch?: true;
        json?: true;
      }) => {
        const json = opts.json === true;
        const payload: Record<string, unknown> = { chatId: opts.from };
        if (opts.as !== undefined) payload["identityLabel"] = opts.as;

        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) => client.request("message.list", payload),
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
    .description("Show message details")
    .argument("<msg-id>", "Message ID")
    .option("--config <path>", "Path to config file")
    .requiredOption("--chat <id>", "Conversation ID")
    .option("--as <inbox>", "Inbox ID to act as")
    .option("--json", "JSON output")
    .action(
      async (
        msgId: string,
        opts: { config?: string; chat: string; as?: string; json?: true },
      ) => {
        const json = opts.json === true;
        const payload: Record<string, unknown> = {
          chatId: opts.chat,
          messageId: msgId,
        };
        if (opts.as !== undefined) payload["identityLabel"] = opts.as;

        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) => client.request("message.info", payload),
        );

        if (result.isErr()) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
      },
    );

  return cmd;
}
