import { describe, expect, test } from "bun:test";
import {
  BrokerCoreConfigSchema,
  IdentityModeSchema,
  XmtpEnvSchema,
} from "../config.js";

describe("XmtpEnvSchema", () => {
  test("accepts valid environments", () => {
    expect(XmtpEnvSchema.parse("local")).toBe("local");
    expect(XmtpEnvSchema.parse("dev")).toBe("dev");
    expect(XmtpEnvSchema.parse("production")).toBe("production");
  });

  test("rejects invalid environment", () => {
    const result = XmtpEnvSchema.safeParse("staging");
    expect(result.success).toBe(false);
  });
});

describe("IdentityModeSchema", () => {
  test("accepts valid modes", () => {
    expect(IdentityModeSchema.parse("per-group")).toBe("per-group");
    expect(IdentityModeSchema.parse("shared")).toBe("shared");
  });

  test("rejects invalid mode", () => {
    const result = IdentityModeSchema.safeParse("custom");
    expect(result.success).toBe(false);
  });
});

describe("BrokerCoreConfigSchema", () => {
  test("requires dataDir", () => {
    const result = BrokerCoreConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  test("accepts minimal config with defaults", () => {
    const config = BrokerCoreConfigSchema.parse({
      dataDir: "/tmp/broker",
    });
    expect(config.dataDir).toBe("/tmp/broker");
    expect(config.env).toBe("dev");
    expect(config.identityMode).toBe("per-group");
    expect(config.heartbeatIntervalMs).toBe(30_000);
    expect(config.syncTimeoutMs).toBe(30_000);
    expect(config.appVersion).toBe("xmtp-broker/0.1.0");
  });

  test("accepts fully specified config", () => {
    const config = BrokerCoreConfigSchema.parse({
      dataDir: "/data/broker",
      env: "production",
      identityMode: "shared",
      heartbeatIntervalMs: 10_000,
      syncTimeoutMs: 60_000,
      appVersion: "custom/1.0.0",
    });
    expect(config.env).toBe("production");
    expect(config.identityMode).toBe("shared");
    expect(config.heartbeatIntervalMs).toBe(10_000);
    expect(config.syncTimeoutMs).toBe(60_000);
    expect(config.appVersion).toBe("custom/1.0.0");
  });

  test("rejects non-positive heartbeatIntervalMs", () => {
    const result = BrokerCoreConfigSchema.safeParse({
      dataDir: "/tmp",
      heartbeatIntervalMs: 0,
    });
    expect(result.success).toBe(false);
  });

  test("rejects non-positive syncTimeoutMs", () => {
    const result = BrokerCoreConfigSchema.safeParse({
      dataDir: "/tmp",
      syncTimeoutMs: -1,
    });
    expect(result.success).toBe(false);
  });

  test("rejects non-integer heartbeatIntervalMs", () => {
    const result = BrokerCoreConfigSchema.safeParse({
      dataDir: "/tmp",
      heartbeatIntervalMs: 1.5,
    });
    expect(result.success).toBe(false);
  });
});
