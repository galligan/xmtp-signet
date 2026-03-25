import { Command } from "commander";
import { Result } from "better-result";
import type { CredentialRecordType } from "@xmtp/signet-schemas";
import {
  CredentialConfig,
  CredentialRevocationReason,
  ValidationError,
  type SignetError,
  type IssuedCredentialType,
  type CredentialRevocationReason as CredentialRevocationReasonType,
} from "@xmtp/signet-schemas";
import { exitCodeFromCategory } from "../output/exit-codes.js";
import { formatOutput } from "../output/formatter.js";
import {
  createWithDaemonClient,
  parseJsonInput,
  type WithDaemonClient,
} from "./daemon-client.js";

/** Dependencies for credential management CLI commands. */
export interface SessionCommandDeps {
  readonly withDaemonClient: WithDaemonClient;
  readonly writeStdout: (message: string) => void;
  readonly writeStderr: (message: string) => void;
  readonly exit: (code: number) => void;
}

const defaultDeps: SessionCommandDeps = {
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
 * Credential lifecycle commands. All require daemon and admin auth.
 *
 * - list: Display active credentials
 * - inspect: Show full credential details
 * - revoke: Immediately revoke a credential
 * - issue: Create a new credential with scope configuration
 */
export function createSessionCommands(
  deps: Partial<SessionCommandDeps> = {},
): Command {
  const resolvedDeps: SessionCommandDeps = { ...defaultDeps, ...deps };
  const cmd = new Command("session").description(
    "Credential lifecycle management",
  );

  cmd
    .command("list")
    .description("List active credentials")
    .option("--config <path>", "Path to config file")
    .option("--operator <operatorId>", "Filter credentials by operator ID")
    .option("--json", "JSON output")
    .action(async (options) => {
      const json = options.json === true;
      const result = await resolvedDeps.withDaemonClient(
        {
          configPath:
            typeof options.config === "string" ? options.config : undefined,
        },
        (client) =>
          client.request<readonly CredentialRecordType[]>(
            "credential.list",
            typeof options.operator === "string"
              ? { operatorId: options.operator }
              : undefined,
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
    .command("inspect")
    .description("Show full credential details")
    .argument("<id>", "Credential ID")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (id, options) => {
      const result = await resolvedDeps.withDaemonClient(
        {
          configPath:
            typeof options.config === "string" ? options.config : undefined,
        },
        (client) =>
          client.request<CredentialRecordType>("credential.lookup", {
            credentialId: id,
          }),
      );

      if (result.isErr()) {
        writeError(resolvedDeps, result.error, Boolean(options.json));
        return;
      }

      resolvedDeps.writeStdout(
        formatOutput(result.value, { json: Boolean(options.json) }) + "\n",
      );
    });

  cmd
    .command("revoke")
    .description("Revoke a credential")
    .argument("<id>", "Credential ID")
    .option("--config <path>", "Path to config file")
    .option("--reason <reason>", "Revocation reason", "owner-initiated")
    .option("--json", "JSON output")
    .action(async (id, options) => {
      const reasonResult = parseReason(options.reason);
      if (reasonResult.isErr()) {
        writeError(resolvedDeps, reasonResult.error, Boolean(options.json));
        return;
      }

      const result = await resolvedDeps.withDaemonClient(
        {
          configPath:
            typeof options.config === "string" ? options.config : undefined,
        },
        (client) =>
          client.request<{ revoked: true }>("credential.revoke", {
            credentialId: id,
            reason: reasonResult.value,
          }),
      );

      if (result.isErr()) {
        writeError(resolvedDeps, result.error, Boolean(options.json));
        return;
      }

      resolvedDeps.writeStdout(
        formatOutput(
          {
            credentialId: id,
            reason: reasonResult.value,
            ...result.value,
          },
          { json: Boolean(options.json) },
        ) + "\n",
      );
    });

  cmd
    .command("issue")
    .description("Issue a new credential")
    .option("--config <path>", "Path to config file")
    .requiredOption("--operator <operatorId>", "Target operator ID")
    .option("--ttl <seconds>", "Credential TTL in seconds")
    .requiredOption(
      "--credential <json>",
      "Credential configuration (JSON or @filepath)",
    )
    .option("--json", "JSON output")
    .action(async (options) => {
      const json = options.json === true;
      const configResult = await buildCredentialConfig({
        operator: String(options.operator),
        ttl: typeof options.ttl === "string" ? options.ttl : undefined,
        credential: String(options.credential),
      });
      if (configResult.isErr()) {
        writeError(resolvedDeps, configResult.error, json);
        return;
      }

      const result = await resolvedDeps.withDaemonClient(
        {
          configPath:
            typeof options.config === "string" ? options.config : undefined,
        },
        (client) =>
          client.request<IssuedCredentialType>(
            "credential.issue",
            configResult.value,
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
    });

  return cmd;
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

async function buildCredentialConfig(options: {
  operator: string;
  ttl?: string | undefined;
  credential: string;
}): Promise<Result<typeof CredentialConfig._type, SignetError>> {
  const ttlResult = parseTtl(options.ttl);
  if (ttlResult.isErr()) {
    return ttlResult;
  }

  const credResult = await parseJsonInput(
    options.credential,
    "credential",
    CredentialConfig,
  );
  if (credResult.isErr()) {
    return credResult;
  }

  const parsedConfig = CredentialConfig.safeParse({
    operatorId: options.operator,
    chatIds: credResult.value.chatIds,
    policyId: credResult.value.policyId,
    allow: credResult.value.allow,
    deny: credResult.value.deny,
    ...(credResult.value.ttlSeconds !== undefined
      ? { ttlSeconds: credResult.value.ttlSeconds }
      : {}),
    ...(ttlResult.value !== undefined ? { ttlSeconds: ttlResult.value } : {}),
  });
  if (!parsedConfig.success) {
    return Result.err(
      ValidationError.create(
        "credential",
        "Credential config did not validate",
        {
          issues: parsedConfig.error.issues,
        },
      ),
    );
  }

  return Result.ok(parsedConfig.data);
}

function parseReason(
  value: unknown,
): Result<CredentialRevocationReasonType, SignetError> {
  const parsed = CredentialRevocationReason.safeParse(value);
  if (!parsed.success) {
    return Result.err(
      ValidationError.create("reason", "Invalid credential revocation reason", {
        issues: parsed.error.issues,
      }),
    );
  }
  return Result.ok(parsed.data);
}

function parseTtl(value: unknown): Result<number | undefined, SignetError> {
  if (value === undefined) {
    return Result.ok(undefined);
  }

  const ttl = Number.parseInt(String(value), 10);
  if (!Number.isInteger(ttl) || ttl <= 0) {
    return Result.err(
      ValidationError.create("ttl", "TTL must be a positive integer"),
    );
  }

  return Result.ok(ttl);
}

function writeError(
  deps: SessionCommandDeps,
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
