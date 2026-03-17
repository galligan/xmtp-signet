import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import type { Command } from "commander";
import type { AdminClient } from "../admin/client.js";
import { createLifecycleCommands } from "../commands/lifecycle.js";
import { createSessionCommands } from "../commands/session.js";

const view = {
  mode: "full" as const,
  threadScopes: [{ groupId: "group-1", threadId: null }],
  contentTypes: ["xmtp.org/text:1.0"],
};

const grant = {
  messaging: {
    send: true,
    reply: false,
    react: false,
    draftOnly: false,
  },
  groupManagement: {
    addMembers: false,
    removeMembers: false,
    updateMetadata: false,
    inviteUsers: false,
  },
  tools: { scopes: [] },
  egress: {
    storeExcerpts: false,
    useForMemory: false,
    forwardToProviders: false,
    quoteRevealed: false,
    summarize: false,
  },
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
  test("session issue parses JSON inputs and routes through daemon client", async () => {
    const issued = {
      token: "session-token",
      session: {
        sessionId: "sess_123",
        agentInboxId: "agent_1",
        sessionKeyFingerprint: "fp_session",
        issuedAt: "2024-01-01T00:00:00.000Z",
        expiresAt: "2024-01-01T01:00:00.000Z",
      },
    };
    const harness = createHarness(issued);

    const command = createSessionCommands(harness.deps);
    await command.parseAsync([
      "node",
      "session",
      "issue",
      "--config",
      "/tmp/test-config.toml",
      "--agent",
      "agent_1",
      "--ttl",
      "120",
      "--view",
      JSON.stringify(view),
      "--grant",
      JSON.stringify(grant),
    ]);

    expect(harness.withDaemonCalls).toEqual([
      { configPath: "/tmp/test-config.toml" },
    ]);
    expect(harness.requestCalls).toEqual([
      {
        method: "session.issue",
        params: {
          agentInboxId: "agent_1",
          ttlSeconds: 120,
          heartbeatInterval: 30,
          view,
          grant,
        },
      },
    ]);
    expect(harness.stderr).toEqual([]);
    expect(harness.stdout.join("")).toContain("session-token");
    expect(harness.stdout.join("")).toContain("sess_123");
  });

  test("status routes through daemon client and prints response", async () => {
    const harness = createHarness({
      state: "running",
      coreState: "ready",
      pid: 1234,
      uptime: 5,
      activeSessions: 2,
      activeConnections: 1,
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
    expect(harness.stdout.join("")).toContain("8393");
  });
});
