import { Command } from "commander";
import { Result } from "better-result";
import { mkdirSync } from "node:fs";
import { createKeyManager } from "@xmtp/signet-keys";
import type { KeyManager } from "@xmtp/signet-keys";
import { loadConfig } from "../config/loader.js";
import { resolvePaths } from "../config/paths.js";
import { formatOutput } from "../output/formatter.js";
import { exitCodeFromCategory } from "../output/exit-codes.js";

/**
 * Identity (inbox/client) management commands.
 *
 * - init: Create XMTP identity and key hierarchy (direct mode)
 * - list: List registered identities (direct mode)
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
    .option("--env <env>", "XMTP environment (local|dev|production)")
    .option("--label <name>", "Human-readable label for this identity")
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

        // 7. Register XMTP identity (skip for local env)
        const env = resolveEnv(options.env, config.signet.env);
        if (env !== "local") {
          await registerXmtpIdentity({
            km,
            paths,
            env,
            label:
              typeof options.label === "string" ? options.label : "default",
            rootPublicKey,
            operationalKeyId: opKey.identityId,
            adminKeyFingerprint: existing.value.fingerprint,
            platform: km.platform,
            print,
            printErr,
          });
          return;
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

      // 7. Register XMTP identity (skip for local env)
      const env = resolveEnv(options.env, config.signet.env);
      if (env !== "local") {
        await registerXmtpIdentity({
          km,
          paths,
          env,
          label: typeof options.label === "string" ? options.label : "default",
          rootPublicKey,
          operationalKeyId: opKey.identityId,
          adminKeyFingerprint: adminResult.value.fingerprint,
          platform: km.platform,
          print,
          printErr,
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
    .command("list")
    .description("List registered identities")
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
      const paths = resolvePaths(configResult.value);

      // 2. Open identity store directly (no daemon needed)
      const { SqliteIdentityStore } = await import("@xmtp/signet-core");
      const store = new SqliteIdentityStore(`${paths.dataDir}/identities.db`);

      // 3. List and output
      const identities = await store.list();
      store.close();

      print(identities);
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

// -- Internal helpers --

type XmtpEnvLiteral = "local" | "dev" | "production";

const VALID_ENVS = new Set<string>(["local", "dev", "production"]);

/**
 * Resolve and validate the XMTP environment from CLI flag + config.
 * Throws on invalid values so the caller gets a narrowed type.
 */
function resolveEnv(
  flagValue: unknown,
  configValue: XmtpEnvLiteral,
): XmtpEnvLiteral {
  const raw = typeof flagValue === "string" ? flagValue : configValue;
  if (!VALID_ENVS.has(raw)) {
    process.stderr.write(
      `Invalid --env value: "${raw}". Must be local, dev, or production.\n`,
    );
    process.exit(1);
  }
  return raw as XmtpEnvLiteral;
}

/**
 * Shared XMTP registration logic for `identity init`.
 * Dynamically imports heavy deps to avoid loading @xmtp/node-sdk
 * when running in local mode.
 */
async function registerXmtpIdentity(opts: {
  readonly km: KeyManager;
  readonly paths: ReturnType<typeof resolvePaths>;
  readonly env: "dev" | "production";
  readonly label: string;
  readonly rootPublicKey: string;
  readonly operationalKeyId: string;
  readonly adminKeyFingerprint: string;
  readonly platform: string;
  readonly print: (data: unknown) => void;
  readonly printErr: (data: unknown) => void;
}): Promise<void> {
  const {
    km,
    paths,
    env,
    label,
    rootPublicKey,
    operationalKeyId,
    adminKeyFingerprint,
    platform,
    print,
    printErr,
  } = opts;

  // Ensure db subdirectory exists for XMTP SDK databases
  mkdirSync(`${paths.dataDir}/db/${env}`, { recursive: true });

  // Dynamic imports — keeps @xmtp/node-sdk out of the critical path
  const { registerIdentity, SqliteIdentityStore, createSdkClientFactory } =
    await import("@xmtp/signet-core");
  const { createSignerProvider } = await import("@xmtp/signet-keys");

  const identityStore = new SqliteIdentityStore(
    `${paths.dataDir}/identities.db`,
  );
  const clientFactory = createSdkClientFactory();
  const signerProviderFactory = (identityId: string) =>
    createSignerProvider(km, identityId);

  const regResult = await registerIdentity(
    {
      identityStore,
      clientFactory,
      signerProviderFactory,
      config: {
        dataDir: paths.dataDir,
        env,
        appVersion: "xmtp-signet/0.1.0",
      },
    },
    { label },
  );

  identityStore.close();

  if (Result.isError(regResult)) {
    printErr({
      error: `XMTP registration failed: ${regResult.error.message}`,
    });
    process.exit(exitCodeFromCategory(regResult.error.category));
  }

  print({
    initialized: true,
    rootPublicKey,
    operationalKeyId,
    adminKeyFingerprint,
    inboxId: regResult.value.inboxId,
    address: regResult.value.address,
    env,
    label,
    platform,
    dataDir: paths.dataDir,
  });
}
