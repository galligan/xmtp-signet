import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import type { Command } from "commander";
import type { AdminClient } from "../admin/client.js";
import { createLifecycleCommands } from "../commands/lifecycle.js";
import { createCredentialCommands } from "../commands/credential.js";

const credentialConfig = {
  operatorId: "op_deadbeeffeedbabe",
  chatIds: ["conv_c0ffee12feedbabe"],
  allow: ["send", "read-messages"],
  deny: [],
};

interface RequestCall {
  readonly method: string;
  readonly params: Record<string, unknown> | undefined;
}

function findCommand(commands: Command[], name: string): Command {
  const command = commands.find((candidate) => candidate.name() === name);
  if (command === undefined) {
    throw new Error(`Command not found: ${name}`);
  }
  return command;
}

function createHarness<T>(response: T) {
  const requestCalls: RequestCall[] = [];
  const withDaemonCalls: Array<{ configPath?: string | undefined }> = [];
  const stdout: string[] = [];
  const stderr: string[] = [];

  const client: AdminClient = {
    async connect() {
      return Result.ok(undefined);
    },
    async request(method, params) {
      requestCalls.push({ method, params });
      return Result.ok(response);
    },
    async close() {},
  };

  return {
    deps: {
      async withDaemonClient<TResult>(
        options: { configPath?: string | undefined },
        run: (
          adminClient: AdminClient,
        ) => Promise<Result<TResult, SignetError>>,
      ): Promise<Result<TResult, SignetError>> {
        withDaemonCalls.push(options);
        return run(client);
      },
      writeStdout(message: string) {
        stdout.push(message);
      },
      writeStderr(message: string) {
        stderr.push(message);
      },
      exit(code: number) {
        throw new Error(`unexpected exit ${String(code)}`);
      },
    },
    requestCalls,
    withDaemonCalls,
    stdout,
    stderr,
  };
}

describe("daemon-backed CLI command wiring", () => {
  test("credential issue parses JSON inputs and routes through daemon client", async () => {
    const issued = {
      token: "credential-token",
      credential: {
        id: "cred_cafe1234feedbabe",
        config: credentialConfig,
        inboxIds: [],
        status: "active",
        issuedAt: "2024-01-01T00:00:00.000Z",
        expiresAt: "2024-01-01T01:00:00.000Z",
        issuedBy: "op_deadbeeffeedbabe",
      },
    };
    const harness = createHarness(issued);

    const command = createCredentialCommands(harness.deps);
    await command.parseAsync([
      "node",
      "credential",
      "issue",
      "--config",
      "/tmp/test-config.toml",
      "--operator",
      "op_deadbeeffeedbabe",
      "--ttl",
      "120",
      "--credential",
      JSON.stringify(credentialConfig),
    ]);

    expect(harness.withDaemonCalls).toEqual([
      { configPath: "/tmp/test-config.toml" },
    ]);
    expect(harness.requestCalls).toEqual([
      {
        method: "credential.issue",
        params: {
          operatorId: "op_deadbeeffeedbabe",
          chatIds: ["conv_c0ffee12feedbabe"],
          allow: ["send", "read-messages"],
          deny: [],
          ttlSeconds: 120,
        },
      },
    ]);
    expect(harness.stderr).toEqual([]);
    expect(harness.stdout.join("")).toContain("credential-token");
    expect(harness.stdout.join("")).toContain("cred_cafe1234feedbabe");
  });

  test("credential issue preserves ttlSeconds from credential JSON", async () => {
    const issued = {
      token: "credential-token",
      credential: {
        id: "cred_cafe1234feedbabe",
        config: {
          ...credentialConfig,
          ttlSeconds: 900,
        },
        inboxIds: [],
        status: "active",
        issuedAt: "2024-01-01T00:00:00.000Z",
        expiresAt: "2024-01-01T01:00:00.000Z",
        issuedBy: "op_deadbeeffeedbabe",
      },
    };
    const harness = createHarness(issued);

    const command = createCredentialCommands(harness.deps);
    await command.parseAsync([
      "node",
      "credential",
      "issue",
      "--operator",
      "op_deadbeeffeedbabe",
      "--credential",
      JSON.stringify({
        ...credentialConfig,
        ttlSeconds: 900,
      }),
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "credential.issue",
        params: {
          operatorId: "op_deadbeeffeedbabe",
          chatIds: ["conv_c0ffee12feedbabe"],
          allow: ["send", "read-messages"],
          deny: [],
          ttlSeconds: 900,
        },
      },
    ]);
  });

  test("status routes through daemon client and prints response", async () => {
    const harness = createHarness({
      state: "running",
      coreState: "ready",
      pid: 1234,
      uptime: 5,
      activeCredentials: 2,
      activeConnections: 1,
      onboardingScheme: "convos" as const,
      xmtpEnv: "local" as const,
      identityMode: "per-group" as const,
      wsPort: 8393,
      version: "0.1.0",
    });

    const command = findCommand(
      createLifecycleCommands(harness.deps),
      "status",
    );
    await command.parseAsync([
      "node",
      "status",
      "--config",
      "/tmp/test-config.toml",
    ]);

    expect(harness.withDaemonCalls).toEqual([
      { configPath: "/tmp/test-config.toml" },
    ]);
    expect(harness.requestCalls).toEqual([
      {
        method: "signet.status",
        params: undefined,
      },
    ]);
    expect(harness.stderr).toEqual([]);
    expect(harness.stdout.join("")).toContain("running");
  });

  test("start --daemon delegates to background startup and exits after printing the startup payload", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exits: number[] = [];
    let daemonizeCalls = 0;
    let signalRegistrations = 0;

    const command = findCommand(
      createLifecycleCommands({
        async daemonizeCurrentProcess() {
          daemonizeCalls += 1;
          return Result.ok({
            status: "running",
            pid: 4321,
            ws: "ws://127.0.0.1:4242",
            adminSocket: "/tmp/signet-admin.sock",
            env: "local",
            dataDir: "/tmp/signet-data",
          });
        },
        async loadConfig() {
          throw new Error("loadConfig should not run in the parent daemonizer");
        },
        resolvePaths() {
          throw new Error(
            "resolvePaths should not run in the parent daemonizer",
          );
        },
        async createSignetRuntime() {
          throw new Error(
            "createSignetRuntime should not run in the parent daemonizer",
          );
        },
        createProductionDeps() {
          throw new Error(
            "createProductionDeps should not run in the parent daemonizer",
          );
        },
        setupSignalHandlers() {
          signalRegistrations += 1;
          return () => {};
        },
        async withDaemonClient() {
          throw new Error("withDaemonClient should not be used in start");
        },
        writeStdout(message: string) {
          stdout.push(message);
        },
        writeStderr(message: string) {
          stderr.push(message);
        },
        exit(code: number) {
          exits.push(code);
        },
      }),
      "start",
    );

    await command.parseAsync(["node", "start", "--daemon", "--json"]);

    expect(daemonizeCalls).toBe(1);
    expect(signalRegistrations).toBe(0);
    expect(stderr).toEqual([]);
    expect(exits).toEqual([0]);
    const parsed = JSON.parse(stdout.join("")) as { ws: string };
    expect(parsed.ws).toBe("ws://127.0.0.1:4242");
  });

  test("start reports the bound ws port from runtime status instead of the config port", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let signalRegistrations = 0;

    const command = findCommand(
      createLifecycleCommands({
        async loadConfig() {
          return Result.ok({
            signet: {
              env: "local" as const,
              identityMode: "per-group" as const,
              dataDir: "/tmp/config-data",
            },
            keys: {
              rootKeyPolicy: "open" as const,
              operationalKeyPolicy: "open" as const,
              vaultKeyPolicy: "open" as const,
            },
            credentials: {
              defaultTtlSeconds: 3600,
              maxConcurrentPerOperator: 5,
            },
            ws: {
              host: "127.0.0.1",
              port: 0,
            },
            admin: {
              socketPath: "/tmp/admin.sock",
            },
            http: {
              enabled: false,
              host: "127.0.0.1",
              port: 8080,
            },
            logging: {
              level: "info" as const,
              auditLogPath: "/tmp/audit.jsonl",
            },
            onboarding: {
              scheme: "convos" as const,
            },
            biometricGating: {
              adminReadElevation: true,
              agentCreation: false,
              egressExpansion: false,
              scopeExpansion: false,
            },
            defaults: {
              profileName: undefined,
            },
          });
        },
        resolvePaths() {
          return {
            configFile: "/tmp/config.toml",
            dataDir: "/tmp/config-data",
            pidFile: "/tmp/signet.pid",
            adminSocket: "/tmp/admin.sock",
            auditLog: "/tmp/audit.jsonl",
            identityKeyFile: "/tmp/vault.db",
          };
        },
        async createSignetRuntime() {
          return Result.ok({
            state: "running" as const,
            core: {} as never,
            credentialManager: {} as never,
            sealManager: {} as never,
            keyManager: {} as never,
            wsServer: {} as never,
            adminServer: {} as never,
            httpServer: null,
            auditLog: {} as never,
            config: {} as never,
            paths: {} as never,
            async start() {
              return Result.ok(undefined);
            },
            async shutdown() {
              return Result.ok(undefined);
            },
            async status() {
              return {
                state: "running" as const,
                coreState: "ready" as const,
                pid: 2468,
                uptime: 1,
                activeCredentials: 0,
                activeConnections: 0,
                onboardingScheme: "convos" as const,
                xmtpEnv: "local" as const,
                identityMode: "per-group" as const,
                wsPort: 4242,
                version: "0.1.0",
              };
            },
          });
        },
        createProductionDeps() {
          return {} as never;
        },
        async daemonizeCurrentProcess() {
          throw new Error("daemonizeCurrentProcess should not run");
        },
        setupSignalHandlers() {
          signalRegistrations += 1;
          return () => {};
        },
        async withDaemonClient() {
          throw new Error("withDaemonClient should not be used in start");
        },
        writeStdout(message: string) {
          stdout.push(message);
        },
        writeStderr(message: string) {
          stderr.push(message);
        },
        exit(code: number) {
          throw new Error(`unexpected exit ${String(code)}`);
        },
      }),
      "start",
    );

    await command.parseAsync(["node", "start", "--json"]);

    expect(signalRegistrations).toBe(1);
    expect(stderr).toEqual([]);
    const parsed = JSON.parse(stdout.join("")) as { ws: string };
    expect(parsed.ws).toBe("ws://127.0.0.1:4242");
    expect(parsed.ws).not.toBe("ws://127.0.0.1:0");
  });
});
