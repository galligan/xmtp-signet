import { Command } from "commander";
import { Result } from "better-result";
import { existsSync, mkdirSync } from "node:fs";
import { createKeyManager } from "@xmtp/signet-keys";
import type { KeyManager } from "@xmtp/signet-keys";
import { loadConfig, defaultConfigPath } from "../config/loader.js";
import {
  applyInitPreset,
  describeInitPreset,
  resolveInitPreset,
  type InitPreset,
} from "../config/init-presets.js";
import { writeConfig } from "../config/writer.js";
import { resolvePaths } from "../config/paths.js";
import { formatOutput } from "../output/formatter.js";
import { exitCodeFromCategory } from "../output/exit-codes.js";
import { resolveOnboardingScheme } from "../onboarding-schemes.js";

/**
 * Identity bootstrap and listing commands (direct mode, no daemon required).
 *
 * - init: Create XMTP identity and key hierarchy
 * - list: List registered identities from the local store
 *
 * For daemon-backed equivalents see `xs inbox` and `xs key`.
 */
export function createIdentityCommands(): Command {
  const cmd = new Command("identity").description(
    "Direct-mode identity bootstrap and listing (see also: inbox, key)",
  );

  cmd.addCommand(createIdentityInitCommand());

  cmd
    .command("list")
    .description(
      "List registered identities (daemon equivalent: xs inbox list)",
    )
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

  return cmd;
}

/** Create the direct-mode identity bootstrap command used by `identity init` and `xs init`. */
export function createIdentityInitCommand(): Command {
  return new Command("init")
    .description(
      "Create a new XMTP identity and key hierarchy, optionally applying a posture preset",
    )
    .argument(
      "[preset]",
      "Initialization posture: recommended, trusted-local, or hardened",
    )
    .option("--config <path>", "Path to config file")
    .option("--json", "JSON output")
    .option("--env <env>", "XMTP environment (local|dev|production)")
    .option("--label <name>", "Human-readable label for this identity")
    .action(async (presetArg: string | undefined, options) => {
      const json = Boolean(options.json);
      const print = (data: unknown) =>
        process.stdout.write(formatOutput(data, { json }) + "\n");
      const printErr = (data: unknown) =>
        process.stderr.write(formatOutput(data, { json }) + "\n");

      const presetResult = resolveInitPreset(presetArg);
      if (presetResult.isErr()) {
        printErr({
          error: presetResult.error.message,
          ...(presetResult.error.context !== null
            ? { context: presetResult.error.context }
            : {}),
        });
        process.exit(exitCodeFromCategory(presetResult.error.category));
      }
      const preset = presetResult.value;
      const configPath =
        typeof options.config === "string"
          ? options.config
          : defaultConfigPath();
      const configExists = existsSync(configPath);

      const configResult = await loadConfig({
        configPath,
        envOverrides: {},
      });
      if (configResult.isErr()) {
        printErr({ error: configResult.error.message });
        process.exit(exitCodeFromCategory(configResult.error.category));
      }
      let config =
        !configExists || presetArg !== undefined
          ? applyInitPreset(configResult.value, preset)
          : configResult.value;
      const env = resolveEnv(options.env, config.signet.env);
      if (config.signet.env !== env) {
        config = {
          ...config,
          signet: {
            ...config.signet,
            env,
          },
        };
      }

      if (
        typeof options.label === "string" &&
        options.label.trim().length > 0 &&
        config.defaults.profileName === undefined
      ) {
        config = {
          ...config,
          defaults: {
            ...config.defaults,
            profileName: options.label.trim(),
          },
        };
      }

      const configWritten = !configExists || presetArg !== undefined;
      if (configWritten) {
        await writeConfig(configPath, config);
      }
      const paths = resolvePaths(config);

      mkdirSync(paths.dataDir, { recursive: true });

      if (!json) process.stdout.write("Initializing key hierarchy...\n");
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

      const initResult = await km.initialize();
      if (Result.isError(initResult)) {
        printErr({
          error: `Root key initialization failed: ${initResult.error.message}`,
        });
        process.exit(5);
      }
      const rootPublicKey = initResult.value.publicKey;

      const opResult = await km.createOperationalKey("default", null);
      if (Result.isError(opResult)) {
        printErr({
          error: `Operational key creation failed: ${opResult.error.message}`,
        });
        process.exit(5);
      }
      const opKey = opResult.value;

      const adminResult = await km.admin.create();
      let adminKeyFingerprint: string;
      if (Result.isError(adminResult)) {
        const existing = await km.admin.get();
        if (Result.isError(existing)) {
          printErr({
            error: `Admin key access failed: ${existing.error.message}`,
          });
          process.exit(5);
        }
        adminKeyFingerprint = existing.value.fingerprint;
      } else {
        adminKeyFingerprint = adminResult.value.fingerprint;
      }

      if (env !== "local") {
        await registerXmtpIdentity({
          km,
          paths,
          env,
          onboardingSchemeId: config.onboarding.scheme,
          label: typeof options.label === "string" ? options.label : "default",
          rootPublicKey,
          operationalKeyId: opKey.identityId,
          adminKeyFingerprint,
          platform: km.platform,
          configPath,
          configWritten,
          ...(configWritten ? { preset } : {}),
          print,
          printErr,
        });
        return;
      }

      print({
        initialized: true,
        ...(configWritten
          ? {
              preset,
              presetDescription: describeInitPreset(preset),
            }
          : {}),
        configPath,
        configWritten,
        onboardingScheme: config.onboarding.scheme,
        rootPublicKey,
        operationalKeyId: opKey.identityId,
        adminKeyFingerprint,
        platform: km.platform,
        dataDir: paths.dataDir,
      });
    });
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
  readonly onboardingSchemeId: "convos";
  readonly label: string;
  readonly rootPublicKey: string;
  readonly operationalKeyId: string;
  readonly adminKeyFingerprint: string;
  readonly platform: string;
  readonly configPath: string;
  readonly configWritten: boolean;
  readonly preset?: InitPreset;
  readonly print: (data: unknown) => void;
  readonly printErr: (data: unknown) => void;
}): Promise<void> {
  const {
    km,
    paths,
    env,
    onboardingSchemeId,
    label,
    rootPublicKey,
    operationalKeyId,
    adminKeyFingerprint,
    platform,
    configPath,
    configWritten,
    preset,
    print,
    printErr,
  } = opts;

  // Ensure db subdirectory exists for XMTP SDK databases
  mkdirSync(`${paths.dataDir}/db/${env}`, { recursive: true });

  // Dynamic imports — keeps @xmtp/node-sdk out of the critical path
  const { registerIdentity, SqliteIdentityStore, createSdkClientFactory } =
    await import("@xmtp/signet-core");
  const { createSignerProvider: createSignerProviderFn } =
    await import("@xmtp/signet-keys");

  const identityStore = new SqliteIdentityStore(
    `${paths.dataDir}/identities.db`,
  );
  const clientFactory = createSdkClientFactory({
    onboardingScheme: resolveOnboardingScheme(onboardingSchemeId),
  });
  const signerProviderFactory = (identityId: string) =>
    createSignerProviderFn(km, identityId);

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
    ...(preset !== undefined
      ? {
          preset,
          presetDescription: describeInitPreset(preset),
        }
      : {}),
    configPath,
    configWritten,
    onboardingScheme: onboardingSchemeId,
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
