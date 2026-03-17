import { Result } from "better-result";
import { readFile } from "node:fs/promises";
import { parse as parseToml } from "smol-toml";
import { ValidationError, InternalError } from "@xmtp/signet-schemas";
import { CliConfigSchema } from "./schema.js";
import type { CliConfig } from "./schema.js";
import { resolvePaths } from "./paths.js";

/**
 * Loads CLI configuration from a TOML file with env var overrides.
 *
 * Resolution order (later wins):
 * 1. Schema defaults
 * 2. TOML file values
 * 3. Environment variable overrides
 *
 * If the config file does not exist, returns schema defaults.
 */
export async function loadConfig(options?: {
  configPath?: string;
  envOverrides?: Record<string, string>;
}): Promise<Result<CliConfig, ValidationError | InternalError>> {
  const configPath = options?.configPath ?? defaultConfigPath();

  let rawData: Record<string, unknown> = {};

  try {
    const content = await readFile(configPath, "utf-8");
    try {
      rawData = parseToml(content) as Record<string, unknown>;
    } catch (parseErr) {
      return Result.err(
        ValidationError.create("config", `Invalid TOML: ${String(parseErr)}`),
      );
    }
  } catch (readErr: unknown) {
    // Only treat ENOENT (file missing) as "use defaults".
    // Permission errors, I/O failures, etc. should propagate.
    if (isEnoent(readErr)) {
      // File doesn't exist -- use defaults
    } else {
      return Result.err(
        InternalError.create(
          `Failed to read config file: ${readErr instanceof Error ? readErr.message : String(readErr)}`,
          { path: configPath },
        ),
      );
    }
  }

  const env = options?.envOverrides ?? process.env;
  applyEnvOverrides(rawData, env);

  const parseResult = CliConfigSchema.safeParse(rawData);
  if (!parseResult.success) {
    const issues = parseResult.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return Result.err(ValidationError.create("config", issues));
  }

  return Result.ok(parseResult.data);
}

function defaultConfigPath(): string {
  const defaults = resolvePaths(CliConfigSchema.parse({}));
  return defaults.configFile;
}

function applyEnvOverrides(
  data: Record<string, unknown>,
  env: Record<string, string | undefined>,
): void {
  const signetEnv = env["XMTP_SIGNET_ENV"];
  if (signetEnv !== undefined) {
    ensureSection(data, "signet");
    (data["signet"] as Record<string, unknown>)["env"] = signetEnv;
  }

  const dataDir = env["XMTP_SIGNET_DATA_DIR"];
  if (dataDir !== undefined) {
    ensureSection(data, "signet");
    (data["signet"] as Record<string, unknown>)["dataDir"] = dataDir;
  }

  const wsPort = env["XMTP_SIGNET_WS_PORT"];
  if (wsPort !== undefined) {
    const parsed = Number(wsPort);
    if (Number.isNaN(parsed)) {
      // Will fail schema validation downstream
      ensureSection(data, "ws");
      (data["ws"] as Record<string, unknown>)["port"] = wsPort;
    } else {
      ensureSection(data, "ws");
      (data["ws"] as Record<string, unknown>)["port"] = parsed;
    }
  }

  const logLevel = env["XMTP_SIGNET_LOG_LEVEL"];
  if (logLevel !== undefined) {
    ensureSection(data, "logging");
    (data["logging"] as Record<string, unknown>)["level"] = logLevel;
  }
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
}

function ensureSection(data: Record<string, unknown>, key: string): void {
  if (
    data[key] === undefined ||
    data[key] === null ||
    typeof data[key] !== "object"
  ) {
    data[key] = {};
  }
}
