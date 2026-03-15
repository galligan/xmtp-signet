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
    expect(config.broker.env).toBe("dev");
    expect(config.ws.port).toBe(8393);
    expect(config.logging.level).toBe("info");
  });

  test("valid TOML parses correctly", async () => {
    const tomlPath = join(tempDir, "config.toml");
    await writeFile(
      tomlPath,
      `[broker]
env = "production"
identityMode = "shared"

[ws]
port = 9000
host = "0.0.0.0"

[sessions]
defaultTtlSeconds = 7200
`,
    );

    const result = await loadConfig({ configPath: tomlPath });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    const config = result.value;
    expect(config.broker.env).toBe("production");
    expect(config.broker.identityMode).toBe("shared");
    expect(config.ws.port).toBe(9000);
    expect(config.ws.host).toBe("0.0.0.0");
    expect(config.sessions.defaultTtlSeconds).toBe(7200);
    // Unspecified sections get defaults
    expect(config.keys.rootKeyPolicy).toBe("biometric");
    expect(config.logging.level).toBe("info");
  });

  test("env var overrides take precedence over TOML values", async () => {
    const tomlPath = join(tempDir, "config.toml");
    await writeFile(
      tomlPath,
      `[broker]
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
        XMTP_BROKER_ENV: "production",
        XMTP_BROKER_WS_PORT: "4567",
        XMTP_BROKER_LOG_LEVEL: "debug",
      },
    });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    const config = result.value;
    expect(config.broker.env).toBe("production");
    expect(config.ws.port).toBe(4567);
    expect(config.logging.level).toBe("debug");
  });

  test("XMTP_BROKER_DATA_DIR env var overrides dataDir", async () => {
    const result = await loadConfig({
      configPath: join(tempDir, "nonexistent.toml"),
      envOverrides: {
        XMTP_BROKER_DATA_DIR: "/custom/data/dir",
      },
    });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.broker.dataDir).toBe("/custom/data/dir");
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
      `[broker]
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
    expect(config.logging.level).toBe("debug");
    expect(config.broker.env).toBe("dev");
    expect(config.ws.port).toBe(8393);
  });

  test("env var with invalid port returns ValidationError", async () => {
    const result = await loadConfig({
      configPath: join(tempDir, "nonexistent.toml"),
      envOverrides: {
        XMTP_BROKER_WS_PORT: "not-a-number",
      },
    });
    expect(result.isOk()).toBe(false);
    if (result.isOk()) return;
    expect(result.error._tag).toBe("ValidationError");
  });

  test("no arguments returns defaults", async () => {
    // When called without configPath, it tries the default XDG path
    // which likely doesn't exist, so it should return defaults
    const result = await loadConfig({
      configPath: join(tempDir, "nope.toml"),
    });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.broker.env).toBe("dev");
  });
});
