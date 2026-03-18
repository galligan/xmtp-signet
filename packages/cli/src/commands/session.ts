import { Command } from "commander";
import { Result } from "better-result";
import type { SessionRecord } from "@xmtp/signet-contracts";
import {
  GrantConfig,
  SessionConfig,
  SessionRevocationReason,
  ValidationError,
  ViewConfig,
  type SignetError,
  type IssuedSession,
  type SessionRevocationReason as SessionRevocationReasonType,
} from "@xmtp/signet-schemas";
import { exitCodeFromCategory } from "../output/exit-codes.js";
import { formatOutput } from "../output/formatter.js";
import {
  createWithDaemonClient,
  parseJsonInput,
  type WithDaemonClient,
} from "./daemon-client.js";

/** Dependencies for session management CLI commands. */
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
 * Session lifecycle commands. All require daemon and admin auth.
 *
 * - list: Display active sessions
 * - inspect: Show full session details
 * - revoke: Immediately revoke a session
 * - issue: Create a new session with view/grant configuration
 */
export function createSessionCommands(
  deps: Partial<SessionCommandDeps> = {},
): Command {
  const resolvedDeps: SessionCommandDeps = { ...defaultDeps, ...deps };
  const cmd = new Command("session").description(
    "Session lifecycle management",
  );

  cmd
    .command("list")
    .description("List active sessions")
    .option("--config <path>", "Path to config file")
    .option("--agent <inboxId>", "Filter sessions by agent inbox ID")
    .option("--json", "JSON output")
    .action(async (options) => {
      const json = options.json === true;
      const result = await resolvedDeps.withDaemonClient(
        {
          configPath:
            typeof options.config === "string" ? options.config : undefined,
        },
        (client) =>
          client.request<readonly SessionRecord[]>(
            "session.list",
            typeof options.agent === "string"
              ? { agentInboxId: options.agent }
              : undefined,
          ),
      );

      if (result.isErr()) {
        writeError(resolvedDeps, result.error, json);
        return;
      }

      const output = json ? result.value : result.value.map(summarizeSession);
      resolvedDeps.writeStdout(formatOutput(output, { json }) + "\n");
    });

  cmd
    .command("inspect")
    .description("Show full session details")
    .argument("<id>", "Session ID")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (id, options) => {
      const result = await resolvedDeps.withDaemonClient(
        {
          configPath:
            typeof options.config === "string" ? options.config : undefined,
        },
        (client) =>
          client.request<SessionRecord>("session.inspect", { sessionId: id }),
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
    .description("Revoke a session")
    .argument("<id>", "Session ID")
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
          client.request<{ revoked: true }>("session.revoke", {
            sessionId: id,
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
            sessionId: id,
            reason: reasonResult.value,
            ...result.value,
          },
          { json: Boolean(options.json) },
        ) + "\n",
      );
    });

  cmd
    .command("issue")
    .description("Issue a new session")
    .option("--config <path>", "Path to config file")
    .requiredOption("--agent <inboxId>", "Target agent inbox ID")
    .option("--ttl <seconds>", "Session TTL in seconds")
    .requiredOption("--view <json>", "View configuration (JSON or @filepath)")
    .requiredOption("--grant <json>", "Grant configuration (JSON or @filepath)")
    .option("--json", "JSON output")
    .action(async (options) => {
      const json = options.json === true;
      const configResult = await buildSessionConfig({
        agent: String(options.agent),
        ttl: typeof options.ttl === "string" ? options.ttl : undefined,
        view: String(options.view),
        grant: String(options.grant),
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
          client.request<IssuedSession>("session.issue", configResult.value),
      );

      if (result.isErr()) {
        writeError(resolvedDeps, result.error, json);
        return;
      }

      const output = json
        ? result.value
        : {
            token: result.value.token,
            ...result.value.session,
          };
      resolvedDeps.writeStdout(formatOutput(output, { json }) + "\n");
    });

  return cmd;
}

function summarizeSession(session: SessionRecord): Record<string, unknown> {
  return {
    sessionId: session.sessionId,
    agentInboxId: session.agentInboxId,
    state: session.state,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
  };
}

async function buildSessionConfig(options: {
  agent: string;
  ttl?: string | undefined;
  view: string;
  grant: string;
}): Promise<Result<typeof SessionConfig._type, SignetError>> {
  const ttlResult = parseTtl(options.ttl);
  if (ttlResult.isErr()) {
    return ttlResult;
  }

  const [viewResult, grantResult] = await Promise.all([
    parseJsonInput(options.view, "view", ViewConfig),
    parseJsonInput(options.grant, "grant", GrantConfig),
  ]);
  if (viewResult.isErr()) {
    return viewResult;
  }
  if (grantResult.isErr()) {
    return grantResult;
  }

  const parsedConfig = SessionConfig.safeParse({
    agentInboxId: options.agent,
    view: viewResult.value,
    grant: grantResult.value,
    ...(ttlResult.value !== undefined ? { ttlSeconds: ttlResult.value } : {}),
  });
  if (!parsedConfig.success) {
    return Result.err(
      ValidationError.create("session", "Session config did not validate", {
        issues: parsedConfig.error.issues,
      }),
    );
  }

  return Result.ok(parsedConfig.data);
}

function parseReason(
  value: unknown,
): Result<SessionRevocationReasonType, SignetError> {
  const parsed = SessionRevocationReason.safeParse(value);
  if (!parsed.success) {
    return Result.err(
      ValidationError.create("reason", "Invalid session revocation reason", {
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
