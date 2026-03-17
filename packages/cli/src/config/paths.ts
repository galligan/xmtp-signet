import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { CliConfig } from "./schema.js";

const APP_NAME = "xmtp-signet";

/**
 * Resolved filesystem paths for the signet runtime.
 * All paths are absolute with tilde and XDG variables resolved.
 */
export interface ResolvedPaths {
  readonly configFile: string;
  readonly dataDir: string;
  readonly pidFile: string;
  readonly adminSocket: string;
  readonly auditLog: string;
  readonly identityKeyFile: string;
}

function expandTilde(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

function xdgConfigHome(): string {
  return process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config");
}

function xdgDataHome(): string {
  return process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share");
}

function xdgRuntimeDir(): string {
  return process.env["XDG_RUNTIME_DIR"] ?? tmpdir();
}

function xdgStateHome(): string {
  return process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local", "state");
}

/**
 * Resolves all filesystem paths from config and XDG environment variables.
 * Config values override XDG defaults where applicable.
 */
export function resolvePaths(config: CliConfig): ResolvedPaths {
  const dataDir =
    config.signet.dataDir !== undefined
      ? expandTilde(config.signet.dataDir)
      : join(xdgDataHome(), APP_NAME);
  const runtimeDir = join(xdgRuntimeDir(), APP_NAME);

  const adminSocket = config.admin.socketPath ?? join(runtimeDir, "admin.sock");

  const auditLog =
    config.logging.auditLogPath ??
    join(xdgStateHome(), APP_NAME, "audit.jsonl");

  return {
    configFile: join(xdgConfigHome(), APP_NAME, "config.toml"),
    dataDir,
    pidFile: join(runtimeDir, "signet.pid"),
    adminSocket,
    auditLog,
    identityKeyFile: join(dataDir, "vault.db"),
  };
}
