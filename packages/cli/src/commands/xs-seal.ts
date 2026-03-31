/**
 * Seal inspection commands for the `xs seal` subcommand group.
 *
 * Daemon-backed inspection and local verification via the admin socket.
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

/** Dependencies for daemon-backed `xs seal` commands. */
export interface XsSealCommandDeps {
  readonly withDaemonClient: WithDaemonClient;
  readonly writeStdout: (message: string) => void;
  readonly writeStderr: (message: string) => void;
  readonly exit: (code: number) => void;
}

const defaultDeps: XsSealCommandDeps = {
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
  deps: XsSealCommandDeps,
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

/** Create the `xs seal` command group backed by admin RPC action specs. */
export function createSealCommands(
  deps: Partial<XsSealCommandDeps> = {},
): Command {
  const resolvedDeps: XsSealCommandDeps = { ...defaultDeps, ...deps };
  const cmd = new Command("seal").description(
    "Seal inspection and verification",
  );

  cmd
    .command("list")
    .description("List active current seals")
    .option("--config <path>", "Path to config file")
    .option("--chat <id>", "Filter by chat ID")
    .option("--credential <id>", "Filter by credential ID")
    .option("--json", "JSON output")
    .action(
      async (opts: {
        config?: string;
        chat?: string;
        credential?: string;
        json?: true;
      }) => {
        const json = opts.json === true;
        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) =>
            client.request("seal.list", {
              ...(opts.chat !== undefined ? { chatId: opts.chat } : {}),
              ...(opts.credential !== undefined
                ? { credentialId: opts.credential }
                : {}),
            }),
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
    .description("Show seal details")
    .argument("<id>", "Seal ID")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (id: string, opts: { config?: string; json?: true }) => {
      const json = opts.json === true;
      const result = await resolvedDeps.withDaemonClient(
        { configPath: opts.config },
        (client) => client.request("seal.info", { sealId: id }),
      );

      if (result.isErr()) {
        writeError(resolvedDeps, result.error, json);
        return;
      }

      resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
    });

  cmd
    .command("verify")
    .description("Run local verification checks against a seal")
    .argument("<id>", "Seal ID")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (id: string, opts: { config?: string; json?: true }) => {
      const json = opts.json === true;
      const result = await resolvedDeps.withDaemonClient(
        { configPath: opts.config },
        (client) => client.request("seal.verify", { sealId: id }),
      );

      if (result.isErr()) {
        writeError(resolvedDeps, result.error, json);
        return;
      }

      resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
    });

  cmd
    .command("history")
    .description("Show seal chain history for a credential in a chat")
    .argument("<cred-id>", "Credential ID")
    .requiredOption("--chat <id>", "Chat ID")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(
      async (
        credentialId: string,
        opts: { chat: string; config?: string; json?: true },
      ) => {
        const json = opts.json === true;
        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) =>
            client.request("seal.history", {
              credentialId,
              chatId: opts.chat,
            }),
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
