/**
 * Operator management commands for the `xs operator` subcommand group.
 *
 * Daemon-backed CRUD operations for operators via the admin socket.
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

/** Dependencies for v1 operator commands. */
export interface XsOperatorCommandDeps {
  readonly withDaemonClient: WithDaemonClient;
  readonly writeStdout: (message: string) => void;
  readonly writeStderr: (message: string) => void;
  readonly exit: (code: number) => void;
}

const defaultDeps: XsOperatorCommandDeps = {
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
  deps: XsOperatorCommandDeps,
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
 * Create the `operator` subcommand group.
 *
 * Subcommands: create, list, info, rename, rm.
 */
export function createOperatorCommands(
  deps: Partial<XsOperatorCommandDeps> = {},
): Command {
  const resolvedDeps: XsOperatorCommandDeps = { ...defaultDeps, ...deps };
  const cmd = new Command("operator").description("Manage operators");

  cmd
    .command("create")
    .description("Create a new operator")
    .option("--config <path>", "Path to config file")
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
      async (opts: {
        config?: string;
        label: string;
        role: string;
        scope: string;
        provider: string;
        json?: true;
      }) => {
        const json = opts.json === true;
        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) =>
            client.request("operator.create", {
              label: opts.label,
              role: opts.role,
              scopeMode: opts.scope,
              provider: opts.provider,
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
    .command("list")
    .description("List operators")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (opts: { config?: string; json?: true }) => {
      const json = opts.json === true;
      const result = await resolvedDeps.withDaemonClient(
        { configPath: opts.config },
        (client) => client.request("operator.list", {}),
      );

      if (result.isErr()) {
        writeError(resolvedDeps, result.error, json);
        return;
      }

      resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
    });

  cmd
    .command("info")
    .description("Show operator details")
    .argument("<id>", "Operator ID or label")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (id: string, opts: { config?: string; json?: true }) => {
      const json = opts.json === true;
      const result = await resolvedDeps.withDaemonClient(
        { configPath: opts.config },
        (client) => client.request("operator.info", { operatorId: id }),
      );

      if (result.isErr()) {
        writeError(resolvedDeps, result.error, json);
        return;
      }

      resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
    });

  cmd
    .command("rename")
    .description("Rename an operator")
    .argument("<id>", "Operator ID or label")
    .option("--config <path>", "Path to config file")
    .requiredOption("--label <name>", "New name")
    .option("--json", "JSON output")
    .action(
      async (
        id: string,
        opts: { config?: string; label: string; json?: true },
      ) => {
        const json = opts.json === true;
        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) =>
            client.request("operator.update", {
              operatorId: id,
              changes: { label: opts.label },
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
    .command("rm")
    .description("Remove an operator")
    .argument("<id>", "Operator ID or label")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (id: string, opts: { config?: string; json?: true }) => {
      const json = opts.json === true;
      const result = await resolvedDeps.withDaemonClient(
        { configPath: opts.config },
        (client) => client.request("operator.remove", { operatorId: id }),
      );

      if (result.isErr()) {
        writeError(resolvedDeps, result.error, json);
        return;
      }

      resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
    });

  return cmd;
}
