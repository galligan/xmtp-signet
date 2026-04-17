import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config/loader.js";
import { applyInitPreset, resolveInitPreset } from "../config/init-presets.js";
import { CliConfigSchema } from "../config/schema.js";
import { writeConfig } from "../config/writer.js";

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

describe("init posture presets", () => {
  test("defaults to the recommended posture when no preset is provided", () => {
    const result = resolveInitPreset(undefined);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value).toBe("recommended");
  });

  test("recommended posture preserves per-group isolation and owner-gated reads", () => {
    const base = CliConfigSchema.parse({});
    const config = applyInitPreset(base, "recommended");

    expect(config.signet.identityMode).toBe("per-group");
    expect(config.onboarding.scheme).toBe("convos");
    expect(config.keys.rootKeyPolicy).toBe("biometric");
    expect(config.keys.vaultKeyPolicy).toBe("open");
    expect(config.biometricGating.adminReadElevation).toBe(true);
    expect(config.biometricGating.scopeExpansion).toBe(false);
    expect(config.credentials.defaultTtlSeconds).toBe(3600);
  });

  test("trusted-local posture flattens ceremony without breaking custody defaults", () => {
    const base = CliConfigSchema.parse({});
    const config = applyInitPreset(base, "trusted-local");

    expect(config.signet.identityMode).toBe("shared");
    expect(config.onboarding.scheme).toBe("convos");
    expect(config.keys.rootKeyPolicy).toBe("biometric");
    expect(config.keys.operationalKeyPolicy).toBe("open");
    expect(config.keys.vaultKeyPolicy).toBe("open");
    expect(config.biometricGating.adminReadElevation).toBe(false);
    expect(config.credentials.defaultTtlSeconds).toBe(43_200);
  });

  test("hardened posture enables approval gates and shorter-lived defaults", () => {
    const base = CliConfigSchema.parse({});
    const config = applyInitPreset(base, "hardened");

    expect(config.signet.identityMode).toBe("per-group");
    expect(config.onboarding.scheme).toBe("convos");
    expect(config.keys.rootKeyPolicy).toBe("biometric");
    expect(config.keys.vaultKeyPolicy).toBe("passcode");
    expect(config.biometricGating.scopeExpansion).toBe(true);
    expect(config.biometricGating.egressExpansion).toBe(true);
    expect(config.biometricGating.agentCreation).toBe(true);
    expect(config.biometricGating.adminReadElevation).toBe(true);
    expect(config.credentials.defaultTtlSeconds).toBe(900);
    expect(config.credentials.maxConcurrentPerOperator).toBe(1);
  });

  test("loadConfig with envOverrides: {} ignores process env vars", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xmtp-signet-init-presets-"));
    tempDirs.push(dir);
    const configPath = join(dir, "config.toml");

    const config = applyInitPreset(CliConfigSchema.parse({}), "recommended");
    await writeConfig(configPath, config);

    const original = process.env["XMTP_SIGNET_ENV"];
    try {
      process.env["XMTP_SIGNET_ENV"] = "production";

      const withEmpty = await loadConfig({ configPath, envOverrides: {} });
      expect(withEmpty.isOk()).toBe(true);
      if (!withEmpty.isOk()) return;
      expect(withEmpty.value.signet.env).toBe("dev");

      const withDefault = await loadConfig({ configPath });
      expect(withDefault.isOk()).toBe(true);
      if (!withDefault.isOk()) return;
      expect(withDefault.value.signet.env).toBe("production");
    } finally {
      if (original === undefined) {
        delete process.env["XMTP_SIGNET_ENV"];
      } else {
        process.env["XMTP_SIGNET_ENV"] = original;
      }
    }
  });

  test("config round-trip with envOverrides: {} does not bake in env vars", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xmtp-signet-init-presets-"));
    tempDirs.push(dir);
    const configPath = join(dir, "config.toml");

    const original = process.env["XMTP_SIGNET_ENV"];
    try {
      process.env["XMTP_SIGNET_ENV"] = "production";

      const loaded = await loadConfig({ configPath, envOverrides: {} });
      expect(loaded.isOk()).toBe(true);
      if (!loaded.isOk()) return;

      const config = applyInitPreset(loaded.value, "recommended");
      await writeConfig(configPath, config);

      delete process.env["XMTP_SIGNET_ENV"];

      const reloaded = await loadConfig({ configPath });
      expect(reloaded.isOk()).toBe(true);
      if (!reloaded.isOk()) return;
      expect(reloaded.value.signet.env).toBe("dev");
    } finally {
      if (original === undefined) {
        delete process.env["XMTP_SIGNET_ENV"];
      } else {
        process.env["XMTP_SIGNET_ENV"] = original;
      }
    }
  });

  test("rejects unknown preset names with a validation error", () => {
    const result = resolveInitPreset("yolo");
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.category).toBe("validation");
  });

  test("persists preset configs as parseable TOML", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xmtp-signet-init-presets-"));
    tempDirs.push(dir);
    const configPath = join(dir, "config.toml");

    const config = applyInitPreset(CliConfigSchema.parse({}), "hardened");
    config.defaults.profileName = "Codex";
    await writeConfig(configPath, config);

    const raw = await readFile(configPath, "utf8");
    expect(raw).toContain("[onboarding]");
    expect(raw).toContain('scheme = "convos"');
    expect(raw).toContain("[signet]");
    expect(raw).toContain('identityMode = "per-group"');
    expect(raw).toContain("[biometricGating]");

    const loaded = await loadConfig({ configPath });
    expect(loaded.isOk()).toBe(true);
    if (!loaded.isOk()) return;
    expect(loaded.value.onboarding.scheme).toBe("convos");
    expect(loaded.value.defaults.profileName).toBe("Codex");
    expect(loaded.value.keys.vaultKeyPolicy).toBe("passcode");
    expect(loaded.value.biometricGating.adminReadElevation).toBe(true);
  });
});
