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
});
