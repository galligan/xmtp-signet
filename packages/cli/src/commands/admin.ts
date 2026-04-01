import { Command } from "commander";
import { Result } from "better-result";
import { mkdirSync } from "node:fs";
import { createKeyManager } from "@xmtp/signet-keys";
import { loadConfig } from "../config/loader.js";
import { resolvePaths } from "../config/paths.js";
import { formatOutput } from "../output/formatter.js";
import { exitCodeFromCategory } from "../output/exit-codes.js";
import { withDaemonClient } from "./admin-rpc.js";
import type { AuditEntry } from "../audit/log.js";
import type { KeyVerificationReport } from "../actions/signet-actions.js";
import type { RuntimeStateSnapshot } from "../actions/signet-actions.js";

/**
 * Administrative operation commands.
 *
 * - token: Generate admin JWT (direct mode — no daemon needed)
 * - verify-keys: Verify key hierarchy integrity (daemon)
 * - export-state: Export runtime state snapshot (daemon)
 * - audit-log: Read and display the audit trail (daemon)
 */
export function createAdminCommands(): Command {
  const cmd = new Command("admin").description("Administrative operations");

  cmd
    .command("token")
    .description("Generate an admin JWT for CLI-to-daemon auth")
    .option("--config <path>", "Path to config file")
    .option("--ttl <seconds>", "Token TTL in seconds", "120")
    .option("--json", "JSON output")
    .action(async (options) => {
      const json = Boolean(options.json);
      const print = (data: unknown) =>
        process.stdout.write(formatOutput(data, { json }) + "\n");
      const printErr = (data: unknown) =>
        process.stderr.write(formatOutput(data, { json }) + "\n");

      // 1. Load config and resolve paths
      const configResult = await loadConfig(
        typeof options.config === "string"
          ? { configPath: options.config }
          : {},
      );
      if (configResult.isErr()) {
        printErr({ error: configResult.error.message });
        process.exit(exitCodeFromCategory(configResult.error.category));
      }
      const config = configResult.value;
      const paths = resolvePaths(config);
      mkdirSync(paths.dataDir, { recursive: true });

      // 2. Open key manager (must already be initialized)
      const kmResult = await createKeyManager({
        rootKeyPolicy: config.keys.rootKeyPolicy,
        operationalKeyPolicy: config.keys.operationalKeyPolicy,
        vaultKeyPolicy: config.keys.vaultKeyPolicy,
        biometricGating: config.biometricGating,
        dataDir: paths.dataDir,
      });
      if (Result.isError(kmResult)) {
        printErr({
          error: `Key manager creation failed: ${kmResult.error.message}`,
        });
        process.exit(5);
      }
      const km = kmResult.value;

      // 3. Initialize (loads existing keys)
      const initResult = await km.initialize();
      if (Result.isError(initResult)) {
        printErr({
          error: `Key initialization failed: ${initResult.error.message}`,
        });
        process.exit(5);
      }

      // 4. Check admin key exists
      if (!km.admin.exists()) {
        printErr({ error: "No admin key found. Run 'xs init' first." });
        process.exit(2);
      }

      // 5. Sign JWT
      const ttl = parseInt(String(options.ttl), 10);
      const jwtResult = await km.admin.signJwt({ ttlSeconds: ttl });
      if (Result.isError(jwtResult)) {
        printErr({ error: `JWT signing failed: ${jwtResult.error.message}` });
        process.exit(5);
      }

      print({ token: jwtResult.value, ttlSeconds: ttl });
    });

  cmd
    .command("verify-keys")
    .description("Verify key hierarchy integrity")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (options: { config?: string; json?: boolean }) => {
      const json = Boolean(options.json);
      const print = (data: unknown) =>
        process.stdout.write(formatOutput(data, { json }) + "\n");
      const printErr = (data: unknown) =>
        process.stderr.write(formatOutput(data, { json }) + "\n");

      const result = await withDaemonClient(options, {}, async (client) =>
        client.request<KeyVerificationReport>("admin.verify-keys", {}),
      );

      if (Result.isError(result)) {
        printErr({ error: result.error.message });
        process.exit(exitCodeFromCategory(result.error.category));
      }

      print(result.value);
    });

  cmd
    .command("export-state")
    .description("Export runtime state snapshot")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (options: { config?: string; json?: boolean }) => {
      const json = Boolean(options.json);
      const print = (data: unknown) =>
        process.stdout.write(formatOutput(data, { json }) + "\n");
      const printErr = (data: unknown) =>
        process.stderr.write(formatOutput(data, { json }) + "\n");

      const result = await withDaemonClient(options, {}, async (client) =>
        client.request<RuntimeStateSnapshot>("admin.export-state", {}),
      );

      if (Result.isError(result)) {
        printErr({ error: result.error.message });
        process.exit(exitCodeFromCategory(result.error.category));
      }

      print(result.value);
    });

  cmd
    .command("audit-log")
    .description("Display audit trail")
    .option("--limit <n>", "Maximum number of entries", "50")
    .option("--since <timestamp>", "Filter entries after timestamp (ISO 8601)")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(
      async (options: {
        limit?: string;
        since?: string;
        config?: string;
        json?: boolean;
      }) => {
        const json = Boolean(options.json);
        const print = (data: unknown) =>
          process.stdout.write(formatOutput(data, { json }) + "\n");
        const printErr = (data: unknown) =>
          process.stderr.write(formatOutput(data, { json }) + "\n");

        const input: Record<string, unknown> = {};
        if (options.limit !== undefined) {
          input["limit"] = parseInt(options.limit, 10);
        }
        if (options.since !== undefined) {
          input["since"] = options.since;
        }

        const result = await withDaemonClient(options, {}, async (client) =>
          client.request<readonly AuditEntry[]>("admin.logs", input),
        );

        if (Result.isError(result)) {
          printErr({ error: result.error.message });
          process.exit(1);
        }

        print(result.value);
      },
    );

  return cmd;
}
