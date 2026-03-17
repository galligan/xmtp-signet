import { Command } from "commander";
import { Result } from "better-result";
import { mkdirSync } from "node:fs";
import { createKeyManager } from "@xmtp/signet-keys";
import { loadConfig } from "../config/loader.js";
import { resolvePaths } from "../config/paths.js";
import { formatOutput } from "../output/formatter.js";
import { exitCodeFromCategory } from "../output/exit-codes.js";

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
        printErr({ error: "No admin key found. Run 'identity init' first." });
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
    .option("--json", "JSON output")
    .action(async (_options) => {
      // Routed via AdminClient
    });

  cmd
    .command("export-state")
    .description("Export runtime state snapshot")
    .option("--json", "JSON output")
    .action(async (_options) => {
      // Routed via AdminClient
    });

  cmd
    .command("audit-log")
    .description("Display audit trail")
    .option("--limit <n>", "Maximum number of entries", "50")
    .option("--since <timestamp>", "Filter entries after timestamp")
    .option("--json", "JSON output")
    .action(async (_options) => {
      // Routed via AdminClient
    });

  return cmd;
}
