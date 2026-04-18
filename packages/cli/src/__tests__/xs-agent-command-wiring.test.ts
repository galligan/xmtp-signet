import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { NotFoundError } from "@xmtp/signet-schemas";
import { createAgentCommands } from "../commands/xs-agent.js";
import type { CliConfig } from "../config/schema.js";

function stubConfig(): CliConfig {
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
      adapters: {},
    },
  };
}

function createHarness() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const loadConfigCalls: Array<{ configPath?: string | undefined }> = [];
  const resolveCalls: Array<{
    adapterName: string;
    verb: "setup" | "status" | "doctor";
    configPath: string;
  }> = [];
  const runCalls: Array<{
    adapterName: string;
    verb: "setup" | "status" | "doctor";
    configPath: string;
    json: boolean;
  }> = [];
  let exitCode: number | undefined;

  return {
    deps: {
      async loadConfig(options?: { configPath?: string }) {
        loadConfigCalls.push(options ?? {});
        return Result.ok(stubConfig());
      },
      defaultConfigPath() {
        return "/tmp/default-config.toml";
      },
      async resolveAdapterCommand(options: {
        adapterName: string;
        verb: "setup" | "status" | "doctor";
        config: CliConfig;
        configPath: string;
      }) {
        resolveCalls.push({
          adapterName: options.adapterName,
          verb: options.verb,
          configPath: options.configPath,
        });
        return Result.ok({
          adapterName: options.adapterName,
          verb: options.verb,
          source: "builtin" as const,
          command: "/usr/local/bin/openclaw-adapter",
          manifest: {
            name: options.adapterName,
            source: "builtin" as const,
            supports: [options.verb],
            entrypoints: {
              [options.verb]: options.verb,
            },
          },
        });
      },
      async runAdapterCommand(
        adapter: {
          adapterName: string;
        },
        options: {
          verb: "setup" | "status" | "doctor";
          configPath: string;
          json: boolean;
        },
      ) {
        runCalls.push({
          adapterName: adapter.adapterName,
          verb: options.verb,
          configPath: options.configPath,
          json: options.json,
        });
        return Result.ok({
          exitCode: 0,
          stdout: '{"status":"ok"}\n',
          stderr: "",
        });
      },
      writeStdout(message: string) {
        stdout.push(message);
      },
      writeStderr(message: string) {
        stderr.push(message);
      },
      exit(code: number) {
        exitCode = code;
      },
    },
    loadConfigCalls,
    resolveCalls,
    runCalls,
    stdout,
    stderr,
    get exitCode() {
      return exitCode;
    },
  };
}

describe("xs agent command wiring", () => {
  test("routes setup requests through config loading, registry resolution, and adapter execution", async () => {
    const harness = createHarness();
    const command = createAgentCommands(harness.deps);

    await command.parseAsync([
      "node",
      "agent",
      "setup",
      "openclaw",
      "--config",
      "/tmp/signet.toml",
      "--json",
    ]);

    expect(harness.loadConfigCalls).toEqual([
      { configPath: "/tmp/signet.toml" },
    ]);
    expect(harness.resolveCalls).toEqual([
      {
        adapterName: "openclaw",
        verb: "setup",
        configPath: "/tmp/signet.toml",
      },
    ]);
    expect(harness.runCalls).toEqual([
      {
        adapterName: "openclaw",
        verb: "setup",
        configPath: "/tmp/signet.toml",
        json: true,
      },
    ]);
    expect(harness.stdout).toEqual(['{"status":"ok"}\n']);
    expect(harness.stderr).toEqual([]);
    expect(harness.exitCode).toBeUndefined();
  });

  test("uses the default config path when one is not provided", async () => {
    const harness = createHarness();
    const command = createAgentCommands(harness.deps);

    await command.parseAsync(["node", "agent", "status", "openclaw"]);

    expect(harness.loadConfigCalls).toEqual([
      { configPath: "/tmp/default-config.toml" },
    ]);
    expect(harness.resolveCalls[0]?.configPath).toBe(
      "/tmp/default-config.toml",
    );
    expect(harness.runCalls[0]?.configPath).toBe("/tmp/default-config.toml");
  });

  test("normalizes registry errors through the shared CLI error surface", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let exitCode: number | undefined;
    const command = createAgentCommands({
      async loadConfig() {
        return Result.ok(stubConfig());
      },
      defaultConfigPath() {
        return "/tmp/default-config.toml";
      },
      async resolveAdapterCommand() {
        return Result.err(NotFoundError.create("adapter", "openclaw"));
      },
      async runAdapterCommand() {
        throw new Error("should not execute the adapter process");
      },
      writeStdout(message: string) {
        stdout.push(message);
      },
      writeStderr(message: string) {
        stderr.push(message);
      },
      exit(code: number) {
        exitCode = code;
      },
    });

    await command.parseAsync(["node", "agent", "doctor", "openclaw", "--json"]);

    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain('"category": "not_found"');
    expect(stderr.join("")).toContain("adapter 'openclaw' not found");
    expect(exitCode).toBe(2);
  });

  test("forwards adapter stderr and exit codes unchanged", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let exitCode: number | undefined;
    const command = createAgentCommands({
      async loadConfig() {
        return Result.ok(stubConfig());
      },
      defaultConfigPath() {
        return "/tmp/default-config.toml";
      },
      async resolveAdapterCommand() {
        return Result.ok({
          adapterName: "openclaw",
          verb: "setup",
          source: "builtin" as const,
          command: "/usr/local/bin/openclaw-adapter",
          manifest: {
            name: "openclaw",
            source: "builtin" as const,
            supports: ["setup"],
            entrypoints: {
              setup: "setup",
            },
          },
        });
      },
      async runAdapterCommand() {
        return Result.ok({
          exitCode: 23,
          stdout: "partial output\n",
          stderr: "adapter failed\n",
        });
      },
      writeStdout(message: string) {
        stdout.push(message);
      },
      writeStderr(message: string) {
        stderr.push(message);
      },
      exit(code: number) {
        exitCode = code;
      },
    });

    await command.parseAsync(["node", "agent", "setup", "openclaw"]);

    expect(stdout).toEqual(["partial output\n"]);
    expect(stderr).toEqual(["adapter failed\n"]);
    expect(exitCode).toBe(23);
  });
});
