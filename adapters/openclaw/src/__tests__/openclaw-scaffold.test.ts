import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  OPENCLAW_ADAPTER_MANIFEST,
  openclawAdapterDefinition,
  runOpenClawDoctor,
  runOpenClawStatus,
} from "../index.js";

describe("openclaw adapter scaffold", () => {
  test("exports a built-in manifest for setup, status, and doctor", () => {
    expect(OPENCLAW_ADAPTER_MANIFEST.name).toBe("openclaw");
    expect(OPENCLAW_ADAPTER_MANIFEST.source).toBe("builtin");
    expect(OPENCLAW_ADAPTER_MANIFEST.supports).toEqual([
      "setup",
      "status",
      "doctor",
    ]);
    expect(OPENCLAW_ADAPTER_MANIFEST.entrypoints.setup).toBe(
      "builtin:openclaw:setup",
    );
  });

  test("exports process-backed registration metadata", () => {
    expect(openclawAdapterDefinition.command).toBe("bun");
    expect(openclawAdapterDefinition.args.length).toBe(1);
    expect(openclawAdapterDefinition.args[0]).toContain("bin.ts");
  });

  test("returns structured outputs for status and doctor", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "openclaw-status-"));
    const configPath = join(dataDir, "config.toml");
    await mkdir(join(dataDir, "adapters", "openclaw", "checkpoints"), {
      recursive: true,
    });
    await writeFile(
      configPath,
      `
[signet]
env = "dev"
dataDir = "${dataDir}"

[defaults]

[keys]
rootKeyPolicy = "biometric"
operationalKeyPolicy = "open"
vaultKeyPolicy = "open"

[biometricGating]
rootKeyCreation = false
operationalKeyRotation = false
scopeExpansion = false
egressExpansion = false
agentCreation = false
adminReadElevation = false

[ws]
port = 8393
host = "127.0.0.1"

[http]
enabled = false
port = 8081
host = "127.0.0.1"

[admin]
authMode = "admin-key"
socketPath = "${join(dataDir, "admin.sock")}"

[credentials]
defaultTtlSeconds = 3600
maxConcurrentPerOperator = 3
actionExpirySeconds = 300

[logging]
level = "info"

[onboarding]
scheme = "convos"
`,
    );

    const status = await runOpenClawStatus({ configPath });
    const doctor = await runOpenClawDoctor({ configPath });

    expect(status.details["phase"]).toBe("runtime");
    expect(doctor.details["phase"]).toBe("runtime");
    expect(status.details["bridgePhase"]).toBe("read-only");
    expect(status.details["missingArtifacts"]).toBeDefined();

    await rm(dataDir, {
      recursive: true,
      force: true,
    });
  });
});
