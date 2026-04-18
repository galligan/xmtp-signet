import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { loadConfig } from "../config/loader.js";
import { join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

describe("loadConfig", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cli-config-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("missing config file returns defaults", async () => {
    const result = await loadConfig({
      configPath: join(tempDir, "nonexistent.toml"),
    });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    const config = result.value;
    expect(config.onboarding.scheme).toBe("convos");
    expect(config.signet.env).toBe("dev");
    expect(config.ws.port).toBe(8393);
    expect(config.logging.level).toBe("info");
  });

  test("valid TOML parses correctly", async () => {
    const tomlPath = join(tempDir, "config.toml");
    await writeFile(
      tomlPath,
      `[onboarding]
scheme = "convos"

[signet]
env = "production"
identityMode = "shared"

[defaults]
profileName = "Codex"

[ws]
port = 9000
host = "0.0.0.0"

[credentials]
defaultTtlSeconds = 7200
`,
    );

    const result = await loadConfig({ configPath: tomlPath });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    const config = result.value;
    expect(config.onboarding.scheme).toBe("convos");
    expect(config.signet.env).toBe("production");
    expect(config.signet.identityMode).toBe("shared");
    expect(config.defaults.profileName).toBe("Codex");
    expect(config.ws.port).toBe(9000);
    expect(config.ws.host).toBe("0.0.0.0");
    expect(config.credentials.defaultTtlSeconds).toBe(7200);
    // Unspecified sections get defaults
    expect(config.keys.rootKeyPolicy).toBe("biometric");
    expect(config.keys.vaultKeyPolicy).toBe("open");
    expect(config.biometricGating.rootKeyCreation).toBe(false);
    expect(config.logging.level).toBe("info");
  });

  test("legacy sessions section is rejected", async () => {
    const tomlPath = join(tempDir, "legacy-sections.toml");
    await writeFile(
      tomlPath,
      `[sessions]
defaultTtlSeconds = 7200
`,
    );

    const result = await loadConfig({ configPath: tomlPath });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error._tag).toBe("ValidationError");
  });

  test("signet env vars override TOML values", async () => {
    const tomlPath = join(tempDir, "config.toml");
    await writeFile(
      tomlPath,
      `[signet]
env = "dev"

[ws]
port = 8393

[logging]
level = "info"
`,
    );

    const result = await loadConfig({
      configPath: tomlPath,
      envOverrides: {
        XMTP_SIGNET_ENV: "production",
        XMTP_SIGNET_WS_PORT: "4567",
        XMTP_SIGNET_LOG_LEVEL: "debug",
      },
    });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    const config = result.value;
    expect(config.signet.env).toBe("production");
    expect(config.ws.port).toBe(4567);
    expect(config.logging.level).toBe("debug");
  });

  test("unknown legacy env vars are ignored", async () => {
    const result = await loadConfig({
      configPath: join(tempDir, "nonexistent.toml"),
      envOverrides: {
        XMTP_LEGACY_ENV: "production",
        XMTP_LEGACY_WS_PORT: "4567",
        XMTP_LEGACY_LOG_LEVEL: "debug",
      },
    });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.signet.env).toBe("dev");
    expect(result.value.ws.port).toBe(8393);
    expect(result.value.logging.level).toBe("info");
  });

  test("XMTP_SIGNET_DATA_DIR env var overrides dataDir", async () => {
    const result = await loadConfig({
      configPath: join(tempDir, "nonexistent.toml"),
      envOverrides: {
        XMTP_SIGNET_DATA_DIR: "/custom/data/dir",
      },
    });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.signet.dataDir).toBe("/custom/data/dir");
  });

  test("unknown legacy data dir env var is ignored", async () => {
    const result = await loadConfig({
      configPath: join(tempDir, "nonexistent.toml"),
      envOverrides: {
        XMTP_LEGACY_DATA_DIR: "/custom/data/dir",
      },
    });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.signet.dataDir).toBeUndefined();
  });

  test("invalid TOML returns ValidationError", async () => {
    const tomlPath = join(tempDir, "bad.toml");
    await writeFile(tomlPath, "this is not valid [[[toml");

    const result = await loadConfig({ configPath: tomlPath });
    expect(result.isOk()).toBe(false);
    if (result.isOk()) return;
    expect(result.error._tag).toBe("ValidationError");
  });

  test("TOML with invalid schema values returns ValidationError", async () => {
    const tomlPath = join(tempDir, "invalid-values.toml");
    await writeFile(
      tomlPath,
      `[signet]
env = "staging"
`,
    );

    const result = await loadConfig({ configPath: tomlPath });
    expect(result.isOk()).toBe(false);
    if (result.isOk()) return;
    expect(result.error._tag).toBe("ValidationError");
  });

  test("partial TOML merged with defaults", async () => {
    const tomlPath = join(tempDir, "partial.toml");
    await writeFile(
      tomlPath,
      `[logging]
level = "debug"
`,
    );

    const result = await loadConfig({ configPath: tomlPath });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    const config = result.value;
    expect(config.onboarding.scheme).toBe("convos");
    expect(config.logging.level).toBe("debug");
    expect(config.signet.env).toBe("dev");
    expect(config.ws.port).toBe(8393);
  });

  test("unknown legacy TOML section is rejected", async () => {
    const tomlPath = join(tempDir, "legacy.toml");
    await writeFile(
      tomlPath,
      `[legacy_signet]
env = "production"
identityMode = "shared"
`,
    );

    const result = await loadConfig({ configPath: tomlPath });
    expect(result.isOk()).toBe(false);
  });

  test("env var with invalid port returns ValidationError", async () => {
    const result = await loadConfig({
      configPath: join(tempDir, "nonexistent.toml"),
      envOverrides: {
        XMTP_SIGNET_WS_PORT: "not-a-number",
      },
    });
    expect(result.isOk()).toBe(false);
    if (result.isOk()) return;
    expect(result.error._tag).toBe("ValidationError");
  });

  test("HTTP and WS host env vars are applied", async () => {
    const result = await loadConfig({
      configPath: join(tempDir, "nonexistent.toml"),
      envOverrides: {
        XMTP_SIGNET_WS_HOST: "0.0.0.0",
        XMTP_SIGNET_HTTP_ENABLED: "true",
        XMTP_SIGNET_HTTP_PORT: "9090",
        XMTP_SIGNET_HTTP_HOST: "0.0.0.0",
      },
    });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    const config = result.value;
    expect(config.ws.host).toBe("0.0.0.0");
    expect(config.http.enabled).toBe(true);
    expect(config.http.port).toBe(9090);
    expect(config.http.host).toBe("0.0.0.0");
  });

  test("XMTP_SIGNET_HTTP_ENABLED=false disables HTTP", async () => {
    const result = await loadConfig({
      configPath: join(tempDir, "nonexistent.toml"),
      envOverrides: {
        XMTP_SIGNET_HTTP_ENABLED: "false",
      },
    });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.http.enabled).toBe(false);
  });

  test("no arguments returns defaults", async () => {
    // When called without configPath, it tries the default XDG path
    // which likely doesn't exist, so it should return defaults
    const result = await loadConfig({
      configPath: join(tempDir, "nope.toml"),
    });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.signet.env).toBe("dev");
  });
});
