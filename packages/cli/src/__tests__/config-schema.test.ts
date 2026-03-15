import { describe, expect, test } from "bun:test";
import { CliConfigSchema, AdminServerConfigSchema } from "../config/schema.js";

describe("CliConfigSchema", () => {
  test("empty object produces valid config with all defaults", () => {
    const result = CliConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;

    const config = result.data;
    expect(config.broker.env).toBe("dev");
    expect(config.broker.identityMode).toBe("per-group");
    expect(config.broker.dataDir).toBeUndefined();
    expect(config.keys.rootKeyPolicy).toBe("biometric");
    expect(config.keys.operationalKeyPolicy).toBe("open");
    expect(config.ws.port).toBe(8393);
    expect(config.ws.host).toBe("127.0.0.1");
    expect(config.admin.authMode).toBe("admin-key");
    expect(config.admin.socketPath).toBeUndefined();
    expect(config.sessions.defaultTtlSeconds).toBe(3600);
    expect(config.sessions.maxConcurrentPerAgent).toBe(3);
    expect(config.sessions.heartbeatIntervalSeconds).toBe(30);
    expect(config.logging.level).toBe("info");
    expect(config.logging.auditLogPath).toBeUndefined();
  });

  test("broker section defaults correctly", () => {
    const result = CliConfigSchema.safeParse({
      broker: {},
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.broker.env).toBe("dev");
    expect(result.data.broker.identityMode).toBe("per-group");
  });

  test("accepts valid broker env values", () => {
    for (const env of ["local", "dev", "production"]) {
      const result = CliConfigSchema.safeParse({
        broker: { env },
      });
      expect(result.success).toBe(true);
    }
  });

  test("rejects invalid broker env", () => {
    const result = CliConfigSchema.safeParse({
      broker: { env: "staging" },
    });
    expect(result.success).toBe(false);
  });

  test("rejects negative ws port", () => {
    const result = CliConfigSchema.safeParse({
      ws: { port: -1 },
    });
    expect(result.success).toBe(false);
  });

  test("rejects zero ws port", () => {
    const result = CliConfigSchema.safeParse({
      ws: { port: 0 },
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

  test("rejects negative session TTL", () => {
    const result = CliConfigSchema.safeParse({
      sessions: { defaultTtlSeconds: -100 },
    });
    expect(result.success).toBe(false);
  });

  test("accepts partial config and fills defaults for omitted fields", () => {
    const result = CliConfigSchema.safeParse({
      broker: { env: "production" },
      ws: { port: 4000 },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.broker.env).toBe("production");
    expect(result.data.broker.identityMode).toBe("per-group");
    expect(result.data.ws.port).toBe(4000);
    expect(result.data.ws.host).toBe("127.0.0.1");
    expect(result.data.sessions.defaultTtlSeconds).toBe(3600);
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
      socketPath: "/var/run/broker.sock",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.socketPath).toBe("/var/run/broker.sock");
  });
});
