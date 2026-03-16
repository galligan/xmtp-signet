import { Command } from "commander";
import { Result } from "better-result";
import { mkdirSync } from "node:fs";
import { createKeyManager } from "@xmtp-broker/keys";
import { loadConfig } from "../config/loader.js";
import { resolvePaths } from "../config/paths.js";
import { formatOutput } from "../output/formatter.js";
import { exitCodeFromCategory } from "../output/exit-codes.js";

/**
 * Identity (inbox/client) management commands.
 *
 * - init: Create XMTP identity and key hierarchy (direct mode)
 * - info: Display identity details (daemon mode)
 * - rotate-keys: Rotate operational keys (daemon mode, admin auth)
 * - export-public: Export public key material (daemon mode)
 */
export function createIdentityCommands(): Command {
  const cmd = new Command("identity").description(
    "XMTP identity and key management",
  );

  cmd
    .command("init")
    .description("Create a new XMTP identity and key hierarchy")
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .action(async (options) => {
      const json = Boolean(options.json);
      const print = (data: unknown) =>
        process.stdout.write(formatOutput(data, { json }) + "\n");
      const printErr = (data: unknown) =>
        process.stderr.write(formatOutput(data, { json }) + "\n");

      // 1. Load config
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

      // 2. Ensure data directory
      mkdirSync(paths.dataDir, { recursive: true });

      // 3. Create key manager
      if (!json) process.stdout.write("Initializing key hierarchy...\n");
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

      // 4. Initialize root key
      const initResult = await km.initialize();
      if (Result.isError(initResult)) {
        printErr({
          error: `Root key initialization failed: ${initResult.error.message}`,
        });
        process.exit(5);
      }
      const rootPublicKey = initResult.value.publicKey;

      // 5. Create default operational key
      const opResult = await km.createOperationalKey("default", null);
      if (Result.isError(opResult)) {
        printErr({
          error: `Operational key creation failed: ${opResult.error.message}`,
        });
        process.exit(5);
      }
      const opKey = opResult.value;

      // 6. Create admin key
      const adminResult = await km.admin.create();
      if (Result.isError(adminResult)) {
        // Already exists is OK — just get it
        const existing = await km.admin.get();
        if (Result.isError(existing)) {
          printErr({
            error: `Admin key access failed: ${existing.error.message}`,
          });
          process.exit(5);
        }
        print({
          initialized: true,
          alreadyExisted: true,
          rootPublicKey: rootPublicKey,
          operationalKeyId: opKey.identityId,
          adminKeyFingerprint: existing.value.fingerprint,
          platform: km.platform,
          dataDir: paths.dataDir,
        });
        return;
      }

      print({
        initialized: true,
        rootPublicKey: rootPublicKey,
        operationalKeyId: opKey.identityId,
        adminKeyFingerprint: adminResult.value.fingerprint,
        platform: km.platform,
        dataDir: paths.dataDir,
      });
    });

  cmd
    .command("info")
    .description("Display identity details")
    .option("--json", "JSON output")
    .action(async (_options) => {
      // Routed via AdminClient
    });

  cmd
    .command("rotate-keys")
    .description("Rotate operational keys")
    .option("--json", "JSON output")
    .action(async (_options) => {
      // Routed via AdminClient (admin auth required)
    });

  cmd
    .command("export-public")
    .description("Export public key material")
    .option("--json", "JSON output")
    .action(async (_options) => {
      // Routed via AdminClient
    });

  return cmd;
}
