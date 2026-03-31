/**
 * Credential management commands for the `xs cred` subcommand group.
 *
 * These are the v1 credential-native CLI surfaces. They speak to the running
 * daemon over the admin socket and keep the `cred` taxonomy expected by the
 * cutover CLI while translating into the current runtime RPC methods.
 *
 * @module
 */

import { Command, InvalidArgumentError } from "commander";
import type {
  CredentialRecordType,
  CredentialConfigType,
  IssuedCredentialType,
  ScopeSetType,
  SignetError,
} from "@xmtp/signet-schemas";
import {
  CredentialConfig,
  ScopeSet,
  ValidationError,
} from "@xmtp/signet-schemas";
import { exitCodeFromCategory } from "../output/exit-codes.js";
import { formatOutput } from "../output/formatter.js";
import {
  createWithDaemonClient,
  type WithDaemonClient,
} from "./daemon-client.js";

/** Parse an integer CLI option and reject trailing junk like `10s`. */
export function parsePositiveIntegerOption(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return Number.parseInt(value, 10);
}

/** Dependencies for v1 credential commands. */
export interface XsCredentialCommandDeps {
  readonly withDaemonClient: WithDaemonClient;
  readonly writeStdout: (message: string) => void;
  readonly writeStderr: (message: string) => void;
  readonly exit: (code: number) => void;
}

const defaultDeps: XsCredentialCommandDeps = {
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
  deps: XsCredentialCommandDeps,
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

function summarizeCredential(
  credential: CredentialRecordType,
): Record<string, unknown> {
  return {
    credentialId: credential.id,
    operatorId: credential.config.operatorId,
    status: credential.status,
    issuedAt: credential.issuedAt,
    expiresAt: credential.expiresAt,
  };
}

function buildIssueConfig(input: {
  readonly operatorId: string;
  readonly chatId: string;
  readonly policyId?: string | undefined;
  readonly allow?: string | undefined;
  readonly deny?: string | undefined;
  readonly ttlSeconds?: number | undefined;
}): CredentialConfigType | ValidationError {
  const parsed = CredentialConfig.safeParse({
    operatorId: input.operatorId,
    chatIds: [input.chatId],
    ...(input.policyId !== undefined ? { policyId: input.policyId } : {}),
    ...(input.allow !== undefined ? { allow: splitScopes(input.allow) } : {}),
    ...(input.deny !== undefined ? { deny: splitScopes(input.deny) } : {}),
    ...(input.ttlSeconds !== undefined ? { ttlSeconds: input.ttlSeconds } : {}),
  });

  if (!parsed.success) {
    return ValidationError.create(
      "credential",
      "Credential config did not validate",
      {
        issues: parsed.error.issues,
      },
    );
  }

  return parsed.data;
}

function buildScopeSet(input: {
  readonly allow?: string | undefined;
  readonly deny?: string | undefined;
}): ScopeSetType | ValidationError {
  const parsed = ScopeSet.safeParse({
    ...(input.allow !== undefined
      ? { allow: splitScopes(input.allow) ?? [] }
      : {}),
    ...(input.deny !== undefined
      ? { deny: splitScopes(input.deny) ?? [] }
      : {}),
  });

  if (!parsed.success) {
    return ValidationError.create("scopes", "Scope update did not validate", {
      issues: parsed.error.issues,
    });
  }

  return parsed.data;
}

/**
 * Create the `cred` subcommand group.
 *
 * Subcommands: issue, list, info, revoke, update.
 */
export function createCredentialCommands(
  deps: Partial<XsCredentialCommandDeps> = {},
): Command {
  const resolvedDeps: XsCredentialCommandDeps = { ...defaultDeps, ...deps };
  const cmd = new Command("cred").description("Manage credentials");

  cmd
    .command("issue")
    .description("Issue a credential")
    .option("--config <path>", "Path to config file")
    .requiredOption("--op <id>", "Operator ID or label")
    .requiredOption("--chat <id>", "Chat ID")
    .option("--policy <id>", "Policy ID or label")
    .option("--allow <scopes>", "Allowed scopes (comma-separated)")
    .option("--deny <scopes>", "Denied scopes (comma-separated)")
    .option(
      "--ttl <seconds>",
      "Time-to-live in seconds",
      parsePositiveIntegerOption,
    )
    .option("--json", "JSON output")
    .action(
      async (opts: {
        config?: string;
        op: string;
        chat: string;
        policy?: string;
        allow?: string;
        deny?: string;
        ttl?: number;
        json?: true;
      }) => {
        const json = opts.json === true;

        // Resolve operator label to op_ ID if needed
        let operatorId = opts.op;
        if (!operatorId.startsWith("op_")) {
          const lookupResult = await resolvedDeps.withDaemonClient(
            { configPath: opts.config },
            (client) =>
              client.request<{ id: string }>("operator.info", {
                operatorId: operatorId,
              }),
          );
          if (lookupResult.isErr()) {
            writeError(resolvedDeps, lookupResult.error, json);
            return;
          }
          operatorId = lookupResult.value.id;
        }

        // Resolve policy label to policy_ ID if needed
        let policyId = opts.policy;
        if (policyId !== undefined && !policyId.startsWith("policy_")) {
          const lookupResult = await resolvedDeps.withDaemonClient(
            { configPath: opts.config },
            (client) =>
              client.request<{ id: string }>("policy.info", {
                policyId: policyId,
              }),
          );
          if (lookupResult.isErr()) {
            writeError(resolvedDeps, lookupResult.error, json);
            return;
          }
          policyId = lookupResult.value.id;
        }

        const configOrError = buildIssueConfig({
          operatorId,
          chatId: opts.chat,
          policyId,
          allow: opts.allow,
          deny: opts.deny,
          ttlSeconds: opts.ttl,
        });
        if (configOrError instanceof ValidationError) {
          writeError(resolvedDeps, configOrError, json);
          return;
        }

        const result = await resolvedDeps.withDaemonClient(
          {
            configPath: opts.config,
          },
          (client) =>
            client.request<IssuedCredentialType>(
              "credential.issue",
              configOrError,
            ),
        );

        if (result.isErr()) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        const output = json
          ? result.value
          : {
              token: result.value.token,
              ...result.value.credential,
            };
        resolvedDeps.writeStdout(formatOutput(output, { json }) + "\n");
      },
    );

  cmd
    .command("list")
    .description("List credentials")
    .option("--config <path>", "Path to config file")
    .option("--op <id>", "Filter by operator")
    .option("--json", "JSON output")
    .action(async (opts: { config?: string; op?: string; json?: true }) => {
      const json = opts.json === true;
      const result = await resolvedDeps.withDaemonClient(
        {
          configPath: opts.config,
        },
        (client) =>
          client.request<readonly CredentialRecordType[]>(
            "credential.list",
            opts.op !== undefined ? { operatorId: opts.op } : undefined,
          ),
      );

      if (result.isErr()) {
        writeError(resolvedDeps, result.error, json);
        return;
      }

      const output = json
        ? result.value
        : result.value.map(summarizeCredential);
      resolvedDeps.writeStdout(formatOutput(output, { json }) + "\n");
    });

  cmd
    .command("info")
    .description("Show credential details")
    .argument("<id>", "Credential ID")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (id: string, opts: { config?: string; json?: true }) => {
      const json = opts.json === true;
      const result = await resolvedDeps.withDaemonClient(
        {
          configPath: opts.config,
        },
        (client) =>
          client.request<CredentialRecordType>("credential.lookup", {
            credentialId: id,
          }),
      );

      if (result.isErr()) {
        writeError(resolvedDeps, result.error, json);
        return;
      }

      resolvedDeps.writeStdout(formatOutput(result.value, { json }) + "\n");
    });

  cmd
    .command("revoke")
    .description("Revoke a credential")
    .argument("<id>", "Credential ID")
    .option("--config <path>", "Path to config file")
    .option("--force", "Execute without confirmation")
    .option("--json", "JSON output")
    .action(
      async (
        id: string,
        opts: { config?: string; force?: true; json?: true },
      ) => {
        const json = opts.json === true;
        const result = await resolvedDeps.withDaemonClient(
          {
            configPath: opts.config,
          },
          (client) =>
            client.request<{ revoked: true }>("credential.revoke", {
              credentialId: id,
              reason: "owner-initiated",
            }),
        );

        if (result.isErr()) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        resolvedDeps.writeStdout(
          formatOutput(
            {
              credentialId: id,
              force: opts.force === true,
              ...result.value,
            },
            { json },
          ) + "\n",
        );
      },
    );

  cmd
    .command("update")
    .description("Update a credential")
    .argument("<id>", "Credential ID")
    .option("--config <path>", "Path to config file")
    .option("--allow <scopes>", "Update allowed scopes")
    .option("--deny <scopes>", "Update denied scopes")
    .option("--policy <id>", "Change policy")
    .option("--json", "JSON output")
    .action(
      async (
        id: string,
        opts: {
          config?: string;
          allow?: string;
          deny?: string;
          policy?: string;
          json?: true;
        },
      ) => {
        const json = opts.json === true;

        if (opts.policy !== undefined) {
          writeError(
            resolvedDeps,
            ValidationError.create(
              "policy",
              "Changing policyId is not supported by `xs cred update`",
            ),
            json,
          );
          return;
        }

        const scopes = buildScopeSet({
          allow: opts.allow,
          deny: opts.deny,
        });
        if (scopes instanceof ValidationError) {
          writeError(resolvedDeps, scopes, json);
          return;
        }
        const result = await resolvedDeps.withDaemonClient(
          {
            configPath: opts.config,
          },
          (client) =>
            client.request<{
              updated: boolean;
              material: boolean;
              reason: string | null;
            }>("credential.updateScopes", {
              credentialId: id,
              scopes,
            }),
        );

        if (result.isErr()) {
          writeError(resolvedDeps, result.error, json);
          return;
        }

        resolvedDeps.writeStdout(
          formatOutput(
            {
              credentialId: id,
              scopes,
              ...result.value,
            },
            { json },
          ) + "\n",
        );
      },
    );

  return cmd;
}
