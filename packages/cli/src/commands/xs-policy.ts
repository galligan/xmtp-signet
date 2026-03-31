/**
 * Policy management commands for the `xs policy` subcommand group.
 *
 * Daemon-backed CRUD operations for policies via the admin socket.
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

/** Dependencies for v1 policy commands. */
export interface XsPolicyCommandDeps {
  readonly withDaemonClient: WithDaemonClient;
  readonly writeStdout: (message: string) => void;
  readonly writeStderr: (message: string) => void;
  readonly exit: (code: number) => void;
}

const defaultDeps: XsPolicyCommandDeps = {
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

function splitScopes(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

function writeError(
  deps: XsPolicyCommandDeps,
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
 * Create the `policy` subcommand group.
 *
 * Subcommands: create, list, info, update, rm.
 */
export function createPolicyCommands(
  deps: Partial<XsPolicyCommandDeps> = {},
): Command {
  const resolvedDeps: XsPolicyCommandDeps = { ...defaultDeps, ...deps };
  const cmd = new Command("policy").description("Policy management");

  cmd
    .command("create")
    .description("Create a policy")
    .option("--config <path>", "Path to config file")
    .requiredOption("--label <name>", "Human-readable name")
    .option("--allow <scopes>", "Allowed scopes (comma-separated)")
    .option("--deny <scopes>", "Denied scopes (comma-separated)")
    .option("--json", "JSON output")
    .action(
      async (opts: {
        config?: string;
        label: string;
        allow?: string;
        deny?: string;
        json?: true;
      }) => {
        const json = opts.json === true;
        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) =>
            client.request("policy.create", {
              label: opts.label,
              allow: opts.allow !== undefined ? splitScopes(opts.allow) : [],
              deny: opts.deny !== undefined ? splitScopes(opts.deny) : [],
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
    .description("List policies")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (opts: { config?: string; json?: true }) => {
      const json = opts.json === true;
      const result = await resolvedDeps.withDaemonClient(
        { configPath: opts.config },
        (client) => client.request("policy.list", {}),
      );

      if (result.isErr()) {
        writeError(resolvedDeps, result.error, json);
        return;
      }

      resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
    });

  cmd
    .command("info")
    .description("Show policy details")
    .argument("<id>", "Policy ID or label")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (id: string, opts: { config?: string; json?: true }) => {
      const json = opts.json === true;
      const result = await resolvedDeps.withDaemonClient(
        { configPath: opts.config },
        (client) => client.request("policy.info", { policyId: id }),
      );

      if (result.isErr()) {
        writeError(resolvedDeps, result.error, json);
        return;
      }

      resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
    });

  cmd
    .command("update")
    .description("Update a policy")
    .argument("<id>", "Policy ID or label")
    .option("--config <path>", "Path to config file")
    .option("--allow <scopes>", "Update allowed scopes")
    .option("--deny <scopes>", "Update denied scopes")
    .option("--label <name>", "Update label")
    .option("--json", "JSON output")
    .action(
      async (
        id: string,
        opts: {
          config?: string;
          allow?: string;
          deny?: string;
          label?: string;
          json?: true;
        },
      ) => {
        const json = opts.json === true;
        const changes: Record<string, unknown> = {};
        if (opts.allow !== undefined) {
          changes["allow"] = splitScopes(opts.allow);
        }
        if (opts.deny !== undefined) {
          changes["deny"] = splitScopes(opts.deny);
        }
        if (opts.label !== undefined) {
          changes["label"] = opts.label;
        }

        const result = await resolvedDeps.withDaemonClient(
          { configPath: opts.config },
          (client) =>
            client.request("policy.update", { policyId: id, changes }),
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
    .description("Remove a policy")
    .argument("<id>", "Policy ID or label")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (id: string, opts: { config?: string; json?: true }) => {
      const json = opts.json === true;
      const result = await resolvedDeps.withDaemonClient(
        { configPath: opts.config },
        (client) => client.request("policy.remove", { policyId: id }),
      );

      if (result.isErr()) {
        writeError(resolvedDeps, result.error, json);
        return;
      }

      resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
    });

  return cmd;
}
