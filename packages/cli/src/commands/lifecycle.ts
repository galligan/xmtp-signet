import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Command } from "commander";
import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import type { DaemonStatus } from "../daemon/status.js";
import { loadConfig } from "../config/loader.js";
import { resolvePaths } from "../config/paths.js";
import { formatOutput } from "../output/formatter.js";
import { exitCodeFromCategory } from "../output/exit-codes.js";
import { createSignetRuntime } from "../runtime.js";
import { createProductionDeps } from "../start.js";
import { setupSignalHandlers } from "../daemon/signals.js";
import {
  createWithDaemonClient,
  type WithDaemonClient,
} from "./daemon-client.js";

/** Dependencies for top-level lifecycle CLI commands. */
export interface SignetLifecycleCommandDeps {
  readonly loadConfig: typeof loadConfig;
  readonly resolvePaths: typeof resolvePaths;
  readonly createSignetRuntime: typeof createSignetRuntime;
  readonly createProductionDeps: typeof createProductionDeps;
  readonly setupSignalHandlers: typeof setupSignalHandlers;
  readonly withDaemonClient: WithDaemonClient;
  readonly writeStdout: (message: string) => void;
  readonly writeStderr: (message: string) => void;
  readonly exit: (code: number) => void;
}

const defaultDeps: SignetLifecycleCommandDeps = {
  loadConfig,
  resolvePaths,
  createSignetRuntime,
  createProductionDeps,
  setupSignalHandlers,
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
 * Top-level signet lifecycle commands.
 *
 * - start: Create and start the SignetRuntime (does not use admin socket)
 * - stop: Send signet.stop via admin socket
 * - status: Send signet.status via admin socket
 * - config show: Show active merged configuration
 * - config validate: Validate config file (no daemon required)
 */
export function createLifecycleCommands(
  deps: Partial<SignetLifecycleCommandDeps> = {},
): Command[] {
  const resolvedDeps: SignetLifecycleCommandDeps = { ...defaultDeps, ...deps };

  const start = new Command("start")
    .description("Start the signet daemon")
    .option("--daemon", "Fork and run as background daemon")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (options) => {
      const json = Boolean(options.json);
      const write = (msg: string, stream: "stdout" | "stderr" = "stdout") => {
        const target =
          stream === "stderr"
            ? resolvedDeps.writeStderr
            : resolvedDeps.writeStdout;
        target(msg + "\n");
      };

      const configOptions: Parameters<typeof loadConfig>[0] =
        typeof options.config === "string"
          ? { configPath: options.config }
          : undefined;
      const configResult = await resolvedDeps.loadConfig(configOptions);

      if (configResult.isErr()) {
        write(
          formatOutput(
            {
              error: "Config load failed",
              message: configResult.error.message,
            },
            { json },
          ),
          "stderr",
        );
        resolvedDeps.exit(exitCodeFromCategory(configResult.error.category));
        return;
      }

      const config = configResult.value;
      const paths = resolvedDeps.resolvePaths(config);

      for (const dir of [
        paths.dataDir,
        dirname(paths.pidFile),
        dirname(paths.adminSocket),
        dirname(paths.auditLog),
      ]) {
        mkdirSync(dir, { recursive: true });
      }

      if (!json) {
        write(`Loading config from ${paths.configFile}`);
        write(`Data directory: ${paths.dataDir}`);
        write("Initializing signet runtime...");
      }

      const runtimeResult = await resolvedDeps.createSignetRuntime(
        config,
        resolvedDeps.createProductionDeps(),
      );

      if (Result.isError(runtimeResult)) {
        write(
          formatOutput(
            {
              error: "Runtime creation failed",
              message: runtimeResult.error.message,
            },
            { json },
          ),
          "stderr",
        );
        resolvedDeps.exit(exitCodeFromCategory(runtimeResult.error.category));
        return;
      }

      const runtime = runtimeResult.value;

      if (!json) {
        write("Starting signet...");
      }

      const startResult = await runtime.start();

      if (Result.isError(startResult)) {
        write(
          formatOutput(
            {
              error: "Startup failed",
              message: startResult.error.message,
              state: runtime.state,
            },
            { json },
          ),
          "stderr",
        );
        resolvedDeps.exit(exitCodeFromCategory(startResult.error.category));
        return;
      }

      resolvedDeps.setupSignalHandlers(async () => {
        if (!json) {
          write("Shutting down signet...");
        }
        const shutdownResult = await runtime.shutdown();
        if (Result.isError(shutdownResult)) {
          write(
            formatOutput(
              {
                error: "Shutdown failed",
                message: shutdownResult.error.message,
              },
              { json },
            ),
            "stderr",
          );
        }
        resolvedDeps.exit(0);
      });

      write(
        formatOutput(
          {
            status: "running",
            pid: process.pid,
            ws: `ws://${config.ws.host}:${config.ws.port}`,
            adminSocket: paths.adminSocket,
            env: config.signet.env,
            dataDir: paths.dataDir,
          },
          { json },
        ),
      );
    });

  const stop = new Command("stop")
    .description("Stop the signet daemon")
    .option("--config <path>", "Path to config file")
    .option("--timeout <ms>", "Shutdown timeout in milliseconds", "10000")
    .option("--json", "JSON output")
    .action(async (options) => {
      const result = await resolvedDeps.withDaemonClient(
        {
          configPath:
            typeof options.config === "string" ? options.config : undefined,
        },
        (client) => client.request<{ stopped: true }>("signet.stop"),
      );

      if (result.isErr()) {
        writeError(resolvedDeps, result.error, Boolean(options.json));
        return;
      }

      resolvedDeps.writeStdout(
        formatOutput(result.value, { json: Boolean(options.json) }) + "\n",
      );
    });

  const status = new Command("status")
    .description("Show signet daemon status")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (options) => {
      const result = await resolvedDeps.withDaemonClient(
        {
          configPath:
            typeof options.config === "string" ? options.config : undefined,
        },
        (client) => client.request<DaemonStatus>("signet.status"),
      );

      if (result.isErr()) {
        writeError(resolvedDeps, result.error, Boolean(options.json));
        return;
      }

      resolvedDeps.writeStdout(
        formatOutput(result.value, { json: Boolean(options.json) }) + "\n",
      );
    });

  const config = new Command("config").description("Configuration management");

  config
    .command("show")
    .description("Show active merged configuration")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (options) => {
      const result = await resolvedDeps.loadConfig(
        typeof options.config === "string"
          ? { configPath: options.config }
          : {},
      );
      if (result.isErr()) {
        resolvedDeps.writeStderr(
          formatOutput(
            { error: result.error.message },
            { json: Boolean(options.json) },
          ) + "\n",
        );
        resolvedDeps.exit(exitCodeFromCategory(result.error.category));
        return;
      }
      const cfg = result.value;
      const paths = resolvedDeps.resolvePaths(cfg);
      resolvedDeps.writeStdout(
        formatOutput({ config: cfg, paths }, { json: Boolean(options.json) }) +
          "\n",
      );
    });

  config
    .command("validate")
    .description("Validate configuration file")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (options) => {
      const result = await resolvedDeps.loadConfig(
        typeof options.config === "string"
          ? { configPath: options.config }
          : {},
      );
      if (result.isErr()) {
        resolvedDeps.writeStderr(
          formatOutput(
            { valid: false, error: result.error.message },
            { json: Boolean(options.json) },
          ) + "\n",
        );
        resolvedDeps.exit(exitCodeFromCategory(result.error.category));
        return;
      }
      resolvedDeps.writeStdout(
        formatOutput(
          { valid: true, config: result.value },
          { json: Boolean(options.json) },
        ) + "\n",
      );
    });

  return [start, stop, status, config];
}

function writeError(
  deps: SignetLifecycleCommandDeps,
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
