import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resolvePaths } from "../config/paths.js";
import type { CliConfig } from "../config/schema.js";
import { CliConfigSchema } from "../config/schema.js";
import { homedir, tmpdir } from "node:os";

function defaultConfig(): CliConfig {
  return CliConfigSchema.parse({});
}

describe("resolvePaths", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_RUNTIME_DIR",
    "XDG_STATE_HOME",
  ];

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  test("default paths use XDG defaults", () => {
    const config = defaultConfig();
    const paths = resolvePaths(config);
    const home = homedir();

    expect(paths.configFile).toBe(`${home}/.config/xmtp-signet/config.toml`);
    expect(paths.dataDir).toBe(`${home}/.local/share/xmtp-signet`);
    expect(paths.auditLog).toBe(`${home}/.local/state/xmtp-signet/audit.jsonl`);
    expect(paths.identityKeyFile).toBe(
      `${home}/.local/share/xmtp-signet/vault.db`,
    );
  });

  test("XDG_CONFIG_HOME overrides config file path", () => {
    process.env["XDG_CONFIG_HOME"] = "/custom/config";
    const paths = resolvePaths(defaultConfig());
    expect(paths.configFile).toBe("/custom/config/xmtp-signet/config.toml");
  });

  test("XDG_DATA_HOME overrides data directory", () => {
    process.env["XDG_DATA_HOME"] = "/custom/data";
    const paths = resolvePaths(defaultConfig());
    expect(paths.dataDir).toBe("/custom/data/xmtp-signet");
    expect(paths.identityKeyFile).toBe("/custom/data/xmtp-signet/vault.db");
  });

  test("XDG_RUNTIME_DIR overrides pid and socket paths", () => {
    process.env["XDG_RUNTIME_DIR"] = "/custom/runtime";
    const paths = resolvePaths(defaultConfig());
    expect(paths.pidFile).toBe("/custom/runtime/xmtp-signet/signet.pid");
    expect(paths.adminSocket).toBe("/custom/runtime/xmtp-signet/admin.sock");
  });

  test("XDG_STATE_HOME overrides audit log path", () => {
    process.env["XDG_STATE_HOME"] = "/custom/state";
    const paths = resolvePaths(defaultConfig());
    expect(paths.auditLog).toBe("/custom/state/xmtp-signet/audit.jsonl");
  });

  test("macOS: TMPDIR used as XDG_RUNTIME_DIR fallback", () => {
    // XDG_RUNTIME_DIR is unset in beforeEach
    const paths = resolvePaths(defaultConfig());
    const expected = `${tmpdir()}/xmtp-signet`;
    expect(paths.pidFile).toBe(`${expected}/signet.pid`);
    expect(paths.adminSocket).toBe(`${expected}/admin.sock`);
  });

  test("config dataDir override is respected", () => {
    const config = CliConfigSchema.parse({
      signet: { dataDir: "/custom/signet-data" },
    });
    const paths = resolvePaths(config);
    expect(paths.dataDir).toBe("/custom/signet-data");
    expect(paths.identityKeyFile).toBe("/custom/signet-data/vault.db");
  });

  test("tilde expansion works in config dataDir", () => {
    const config = CliConfigSchema.parse({
      signet: { dataDir: "~/my-signet-data" },
    });
    const paths = resolvePaths(config);
    const home = homedir();
    expect(paths.dataDir).toBe(`${home}/my-signet-data`);
    expect(paths.identityKeyFile).toBe(`${home}/my-signet-data/vault.db`);
  });

  test("admin socketPath from config overrides default", () => {
    const config = CliConfigSchema.parse({
      admin: { socketPath: "/var/run/custom.sock" },
    });
    const paths = resolvePaths(config);
    expect(paths.adminSocket).toBe("/var/run/custom.sock");
  });

  test("audit log path from config overrides default", () => {
    const config = CliConfigSchema.parse({
      logging: { auditLogPath: "/var/log/signet-audit.jsonl" },
    });
    const paths = resolvePaths(config);
    expect(paths.auditLog).toBe("/var/log/signet-audit.jsonl");
  });

  test("all returned paths are readonly strings", () => {
    const paths = resolvePaths(defaultConfig());
    expect(typeof paths.configFile).toBe("string");
    expect(typeof paths.dataDir).toBe("string");
    expect(typeof paths.pidFile).toBe("string");
    expect(typeof paths.adminSocket).toBe("string");
    expect(typeof paths.auditLog).toBe("string");
    expect(typeof paths.identityKeyFile).toBe("string");
  });
});
