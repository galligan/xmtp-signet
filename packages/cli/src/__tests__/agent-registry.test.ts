import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveAgentAdapterCommand } from "../agent/registry.js";
import type { CliConfig } from "../config/schema.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      rm(dir, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

function stubConfig(adapters: CliConfig["agent"]["adapters"] = {}): CliConfig {
  return {
    onboarding: {
      scheme: "convos",
    },
    signet: {
      env: "dev",
      identityMode: "per-group",
      dataDir: undefined,
    },
    defaults: {
      profileName: undefined,
    },
    keys: {
      rootKeyPolicy: "biometric",
      operationalKeyPolicy: "open",
      vaultKeyPolicy: "open",
    },
    biometricGating: {
      rootKeyCreation: false,
      operationalKeyRotation: false,
      scopeExpansion: false,
      egressExpansion: false,
      agentCreation: false,
      adminReadElevation: false,
    },
    ws: {
      port: 8393,
      host: "127.0.0.1",
    },
    http: {
      enabled: false,
      port: 8081,
      host: "127.0.0.1",
    },
    admin: {
      authMode: "admin-key",
      socketPath: undefined,
    },
    credentials: {
      defaultTtlSeconds: 3600,
      maxConcurrentPerOperator: 3,
      actionExpirySeconds: 300,
    },
    logging: {
      level: "info",
      auditLogPath: undefined,
    },
    agent: {
      adapters,
    },
  };
}

async function makeConfigDir(): Promise<{ dir: string; configPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "agent-registry-test-"));
  tempDirs.push(dir);
  return {
    dir,
    configPath: join(dir, "config.toml"),
  };
}

describe("resolveAgentAdapterCommand", () => {
  test("resolves built-in adapters without config overrides", async () => {
    const { configPath } = await makeConfigDir();
    const result = await resolveAgentAdapterCommand(
      {
        adapterName: "openclaw",
        verb: "setup",
        config: stubConfig(),
        configPath,
      },
      {
        builtinRegistry: {
          openclaw: {
            manifest: {
              name: "openclaw",
              source: "builtin",
              supports: ["setup", "status"],
              entrypoints: {
                setup: "setup",
                status: "status",
              },
            },
            command: "/usr/local/bin/openclaw-adapter",
          },
        },
      },
    );

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.source).toBe("builtin");
    expect(result.value.command).toBe("/usr/local/bin/openclaw-adapter");
    expect(result.value.manifest.entrypoints.setup).toBe("setup");
  });

  test("resolves explicit external adapter adoption from config", async () => {
    const { dir, configPath } = await makeConfigDir();
    const manifestPath = join(dir, "custom-adapter.toml");
    await writeFile(
      manifestPath,
      [
        `name = "custom-harness"`,
        `source = "external"`,
        `supports = ["setup", "doctor"]`,
        "",
        "[entrypoints]",
        `setup = "bootstrap"`,
        `doctor = "doctor"`,
      ].join("\n"),
    );

    const result = await resolveAgentAdapterCommand({
      adapterName: "custom-harness",
      verb: "doctor",
      config: stubConfig({
        "custom-harness": {
          source: "external",
          manifest: "./custom-adapter.toml",
          command: "./bin/custom-adapter",
        },
      }),
      configPath,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.source).toBe("external");
    expect(result.value.command).toBe(join(dir, "bin", "custom-adapter"));
    expect(result.value.manifest.entrypoints.doctor).toBe("doctor");
  });

  test("rejects unsupported verbs from the adapter manifest", async () => {
    const { configPath } = await makeConfigDir();
    const result = await resolveAgentAdapterCommand(
      {
        adapterName: "openclaw",
        verb: "doctor",
        config: stubConfig(),
        configPath,
      },
      {
        builtinRegistry: {
          openclaw: {
            manifest: {
              name: "openclaw",
              source: "builtin",
              supports: ["setup"],
              entrypoints: {
                setup: "setup",
              },
            },
            command: "/usr/local/bin/openclaw-adapter",
          },
        },
      },
    );

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;

    expect(result.error.category).toBe("validation");
    expect(result.error.message).toContain("does not support 'doctor'");
  });

  test("rejects external manifests whose name does not match the adapter", async () => {
    const { dir, configPath } = await makeConfigDir();
    const manifestPath = join(dir, "custom-adapter.toml");
    await writeFile(
      manifestPath,
      [
        `name = "wrong-name"`,
        `source = "external"`,
        `supports = ["setup"]`,
        "",
        "[entrypoints]",
        `setup = "bootstrap"`,
      ].join("\n"),
    );

    const result = await resolveAgentAdapterCommand({
      adapterName: "custom-harness",
      verb: "setup",
      config: stubConfig({
        "custom-harness": {
          source: "external",
          manifest: "./custom-adapter.toml",
          command: "./bin/custom-adapter",
        },
      }),
      configPath,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;

    expect(result.error.category).toBe("validation");
    expect(result.error.message).toContain("Manifest name 'wrong-name'");
  });

  test("returns not_found when no built-in or adopted adapter is available", async () => {
    const { configPath } = await makeConfigDir();
    const result = await resolveAgentAdapterCommand({
      adapterName: "unknown-harness",
      verb: "setup",
      config: stubConfig(),
      configPath,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;

    expect(result.error.category).toBe("not_found");
    expect(result.error.message).toContain(
      "adapter 'unknown-harness' not found",
    );
  });
});
