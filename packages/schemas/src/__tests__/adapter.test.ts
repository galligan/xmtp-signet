import { describe, expect, test } from "bun:test";
import {
  AdapterManifest,
  AgentAdapterConfig,
  AgentAdaptersConfig,
  AdapterSetupResult,
  AdapterStatusResult,
} from "../adapter.js";

describe("AdapterManifest", () => {
  test("accepts a built-in manifest with supported verb entrypoints", () => {
    const result = AdapterManifest.safeParse({
      name: "openclaw",
      source: "builtin",
      supports: ["setup", "status", "doctor"],
      entrypoints: {
        setup: "builtin:openclaw:setup",
        status: "builtin:openclaw:status",
        doctor: "builtin:openclaw:doctor",
      },
    });

    expect(result.success).toBe(true);
  });

  test("rejects a supported verb without an entrypoint", () => {
    const result = AdapterManifest.safeParse({
      name: "openclaw",
      source: "builtin",
      supports: ["setup", "status"],
      entrypoints: {
        setup: "builtin:openclaw:setup",
      },
    });

    expect(result.success).toBe(false);
  });

  test("rejects an entrypoint for an unsupported verb", () => {
    const result = AdapterManifest.safeParse({
      name: "openclaw",
      source: "builtin",
      supports: ["setup"],
      entrypoints: {
        setup: "builtin:openclaw:setup",
        status: "builtin:openclaw:status",
      },
    });

    expect(result.success).toBe(false);
  });

  test("rejects invalid adapter names", () => {
    const result = AdapterManifest.safeParse({
      name: "OpenClaw",
      source: "builtin",
      supports: ["setup"],
      entrypoints: {
        setup: "builtin:openclaw:setup",
      },
    });

    expect(result.success).toBe(false);
  });
});

describe("AgentAdapterConfig", () => {
  test("accepts built-in adapter config", () => {
    const result = AgentAdapterConfig.safeParse({
      source: "builtin",
    });

    expect(result.success).toBe(true);
  });

  test("accepts external adapter config", () => {
    const result = AgentAdapterConfig.safeParse({
      source: "external",
      manifest: "/tmp/custom-adapter.toml",
      command: "/usr/local/bin/custom-adapter",
    });

    expect(result.success).toBe(true);
  });

  test("rejects incomplete external adapter config", () => {
    const result = AgentAdapterConfig.safeParse({
      source: "external",
      manifest: "/tmp/custom-adapter.toml",
    });

    expect(result.success).toBe(false);
  });
});

describe("AgentAdaptersConfig", () => {
  test("defaults to an empty mapping", () => {
    const result = AgentAdaptersConfig.parse(undefined);
    expect(result).toEqual({});
  });

  test("accepts mixed adapter source kinds", () => {
    const result = AgentAdaptersConfig.safeParse({
      openclaw: { source: "builtin" },
      "custom-harness": {
        source: "external",
        manifest: "/tmp/custom-adapter.toml",
        command: "/usr/local/bin/custom-adapter",
      },
    });

    expect(result.success).toBe(true);
  });
});

describe("adapter result schemas", () => {
  test("accepts setup results with shared output fields", () => {
    const result = AdapterSetupResult.safeParse({
      adapter: "openclaw",
      adapterSource: "builtin",
      status: "ok",
      created: ["policy:openclaw-readonly"],
      reused: ["operator:openclaw-main"],
      artifacts: {
        adapterConfigPath: "/tmp/adapter.toml",
      },
      nextSteps: ["Run xs agent status openclaw"],
    });

    expect(result.success).toBe(true);
  });

  test("accepts status results with open-ended details", () => {
    const result = AdapterStatusResult.safeParse({
      adapter: "openclaw",
      adapterSource: "builtin",
      status: "degraded",
      details: {
        wsReachable: false,
        wsUrl: "ws://127.0.0.1:8393",
      },
    });

    expect(result.success).toBe(true);
  });
});
