import { describe, expect, test } from "bun:test";
import { CliConfigSchema, AdminServerConfigSchema } from "../config/schema.js";

describe("CliConfigSchema", () => {
  test("empty object produces valid config with all defaults", () => {
    const result = CliConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;

    const config = result.data;
    expect(config.onboarding.scheme).toBe("convos");
    expect(config.signet.env).toBe("dev");
    expect(config.signet.identityMode).toBe("per-group");
    expect(config.signet.dataDir).toBeUndefined();
    expect(config.defaults.profileName).toBeUndefined();
    expect(config.keys.rootKeyPolicy).toBe("biometric");
    expect(config.keys.operationalKeyPolicy).toBe("open");
    expect(config.keys.vaultKeyPolicy).toBe("open");
    expect(config.biometricGating.rootKeyCreation).toBe(false);
    expect(config.biometricGating.adminReadElevation).toBe(false);
    expect(config.ws.port).toBe(8393);
    expect(config.ws.host).toBe("127.0.0.1");
    expect(config.admin.authMode).toBe("admin-key");
    expect(config.admin.socketPath).toBeUndefined();
    expect(config.credentials.defaultTtlSeconds).toBe(3600);
    expect(config.credentials.maxConcurrentPerOperator).toBe(3);
    expect(config.credentials.actionExpirySeconds).toBe(300);
    expect(config.logging.level).toBe("info");
    expect(config.logging.auditLogPath).toBeUndefined();
    expect(config.agent.adapters).toEqual({});
  });

  test("signet section defaults correctly", () => {
    const result = CliConfigSchema.safeParse({
      signet: {},
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.onboarding.scheme).toBe("convos");
    expect(result.data.signet.env).toBe("dev");
    expect(result.data.signet.identityMode).toBe("per-group");
  });

  test("onboarding section defaults correctly", () => {
    const result = CliConfigSchema.safeParse({
      onboarding: {},
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.onboarding.scheme).toBe("convos");
  });

  test("accepts a default Convos profile name", () => {
    const result = CliConfigSchema.safeParse({
      defaults: { profileName: "Codex" },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.defaults.profileName).toBe("Codex");
  });

  test("rejects unknown legacy section", () => {
    const result = CliConfigSchema.safeParse({
      legacy_signet: { env: "production" },
    });
    expect(result.success).toBe(false);
  });

  test("accepts valid signet env values", () => {
    for (const env of ["local", "dev", "production"]) {
      const result = CliConfigSchema.safeParse({
        signet: { env },
      });
      expect(result.success).toBe(true);
    }
  });

  test("rejects invalid signet env", () => {
    const result = CliConfigSchema.safeParse({
      signet: { env: "staging" },
    });
    expect(result.success).toBe(false);
  });

  test("rejects negative ws port", () => {
    const result = CliConfigSchema.safeParse({
      ws: { port: -1 },
    });
    expect(result.success).toBe(false);
  });

  test("accepts zero ws port for dynamic allocation", () => {
    const result = CliConfigSchema.safeParse({
      ws: { port: 0 },
    });
    expect(result.success).toBe(true);
  });

  test("rejects negative ws port", () => {
    const result = CliConfigSchema.safeParse({
      ws: { port: -1 },
    });
    expect(result.success).toBe(false);
  });

  test("rejects non-integer ws port", () => {
    const result = CliConfigSchema.safeParse({
      ws: { port: 8393.5 },
    });
    expect(result.success).toBe(false);
  });

  test("accepts custom ws port", () => {
    const result = CliConfigSchema.safeParse({
      ws: { port: 9000 },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.ws.port).toBe(9000);
  });

  test("rejects invalid logging level", () => {
    const result = CliConfigSchema.safeParse({
      logging: { level: "trace" },
    });
    expect(result.success).toBe(false);
  });

  test("accepts all valid logging levels", () => {
    for (const level of ["debug", "info", "warn", "error"]) {
      const result = CliConfigSchema.safeParse({
        logging: { level },
      });
      expect(result.success).toBe(true);
    }
  });

  test("rejects negative credential TTL", () => {
    const result = CliConfigSchema.safeParse({
      credentials: { defaultTtlSeconds: -100 },
    });
    expect(result.success).toBe(false);
  });

  test("accepts partial config and fills defaults for omitted fields", () => {
    const result = CliConfigSchema.safeParse({
      signet: { env: "production" },
      ws: { port: 4000 },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.signet.env).toBe("production");
    expect(result.data.signet.identityMode).toBe("per-group");
    expect(result.data.ws.port).toBe(4000);
    expect(result.data.ws.host).toBe("127.0.0.1");
    expect(result.data.credentials.defaultTtlSeconds).toBe(3600);
  });

  test("admin.authMode only accepts admin-key", () => {
    const result = CliConfigSchema.safeParse({
      admin: { authMode: "password" },
    });
    expect(result.success).toBe(false);
  });

  test("accepts optional admin socketPath", () => {
    const result = CliConfigSchema.safeParse({
      admin: { socketPath: "/tmp/custom.sock" },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.admin.socketPath).toBe("/tmp/custom.sock");
  });

  test("accepts built-in adapter registry entries", () => {
    const result = CliConfigSchema.safeParse({
      agent: {
        adapters: {
          openclaw: { source: "builtin" },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  test("accepts external adapter registry entries", () => {
    const result = CliConfigSchema.safeParse({
      agent: {
        adapters: {
          "custom-harness": {
            source: "external",
            manifest: "/tmp/custom-adapter.toml",
            command: "/usr/local/bin/custom-adapter",
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  test("rejects incomplete external adapter registry entries", () => {
    const result = CliConfigSchema.safeParse({
      agent: {
        adapters: {
          "custom-harness": {
            source: "external",
            manifest: "/tmp/custom-adapter.toml",
          },
        },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("AdminServerConfigSchema", () => {
  test("empty object produces valid defaults", () => {
    const result = AdminServerConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.authMode).toBe("admin-key");
    expect(result.data.socketPath).toBeUndefined();
  });

  test("accepts custom socketPath", () => {
    const result = AdminServerConfigSchema.safeParse({
      socketPath: "/var/run/signet.sock",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.socketPath).toBe("/var/run/signet.sock");
  });
});
