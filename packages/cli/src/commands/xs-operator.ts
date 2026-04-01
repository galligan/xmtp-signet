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
    .option("--wallet <id>", "Bind an existing wallet ID")
    .option("--inference-mode <mode>", "Inference mode: local, cloud, hybrid")
    .option(
      "--inference-providers <providers>",
      "Comma-separated inference providers",
    )
    .option(
      "--content-egress-scope <scope>",
      "Content egress scope: none, provider-only, unrestricted",
    )
    .option(
      "--retention-at-provider <policy>",
      "Provider-stated retention policy",
    )
    .option("--hosting-mode <mode>", "Hosting mode: self-hosted, cloud, tee")
    .option("--json", "JSON output")
    .action(
      async (opts: {
        config?: string;
        label: string;
        role: string;
        scope: string;
        provider: string;
        wallet?: string;
        inferenceMode?: string;
        inferenceProviders?: string;
        contentEgressScope?: string;
        retentionAtProvider?: string;
        hostingMode?: string;
        json?: true;
      }) => {
        const json = opts.json === true;
        const operatorDisclosures: Record<string, unknown> = {};
        if (opts.inferenceMode !== undefined) {
          operatorDisclosures["inferenceMode"] = opts.inferenceMode;
        }
        if (opts.inferenceProviders !== undefined) {
          operatorDisclosures["inferenceProviders"] = opts.inferenceProviders
            .split(",")
            .map((value) => value.trim())
            .filter((value) => value.length > 0);
        }
        if (opts.contentEgressScope !== undefined) {
          operatorDisclosures["contentEgressScope"] = opts.contentEgressScope;
        }
        if (opts.retentionAtProvider !== undefined) {
          operatorDisclosures["retentionAtProvider"] = opts.retentionAtProvider;
        }
        if (opts.hostingMode !== undefined) {
          operatorDisclosures["hostingMode"] = opts.hostingMode;
        }
        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) =>
            client.request("operator.create", {
              label: opts.label,
              role: opts.role,
              scopeMode: opts.scope,
              provider: opts.provider,
              ...(opts.wallet !== undefined ? { walletId: opts.wallet } : {}),
              ...(Object.keys(operatorDisclosures).length > 0
                ? { operatorDisclosures }
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
