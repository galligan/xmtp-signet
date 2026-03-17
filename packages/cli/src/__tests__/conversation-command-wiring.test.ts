import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { InternalError, type BrokerError } from "@xmtp-broker/schemas";
import type { AdminClient } from "../admin/client.js";
import { createConversationCommands } from "../commands/conversation.js";

interface RequestCall {
  readonly method: string;
  readonly params: Record<string, unknown> | undefined;
}

function createHarness<T>(response: T) {
  const requestCalls: RequestCall[] = [];
  const withDaemonCalls: Array<{ configPath?: string | undefined }> = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode: number | undefined;

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
        ) => Promise<Result<TResult, BrokerError>>,
      ): Promise<Result<TResult, BrokerError>> {
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
        exitCode = code;
      },
    },
    requestCalls,
    withDaemonCalls,
    stdout,
    stderr,
    get exitCode() {
      return exitCode;
    },
  };
}

function createErrorHarness(error: BrokerError) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode: number | undefined;

  return {
    deps: {
      async withDaemonClient<TResult>(
        _options: { configPath?: string | undefined },
        _run: (
          adminClient: AdminClient,
        ) => Promise<Result<TResult, BrokerError>>,
      ): Promise<Result<TResult, BrokerError>> {
        return Result.err(error);
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
    stdout,
    stderr,
    get exitCode() {
      return exitCode;
    },
  };
}

describe("conversation create", () => {
  test("routes through daemon client with name and members", async () => {
    const created = { groupId: "grp_abc", name: "Test Group" };
    const harness = createHarness(created);

    const command = createConversationCommands(harness.deps);
    await command.parseAsync([
      "node",
      "conversation",
      "create",
      "--name",
      "Test Group",
      "--members",
      "inbox1,inbox2,inbox3",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.withDaemonCalls).toEqual([{ configPath: "/tmp/test.toml" }]);
    expect(harness.requestCalls).toEqual([
      {
        method: "conversation.create",
        params: {
          name: "Test Group",
          memberInboxIds: ["inbox1", "inbox2", "inbox3"],
          creatorIdentityLabel: undefined,
        },
      },
    ]);
    expect(harness.stderr).toEqual([]);
    expect(harness.stdout.join("")).toContain("grp_abc");
  });

  test("passes --as label as creatorIdentityLabel", async () => {
    const created = { groupId: "grp_def" };
    const harness = createHarness(created);

    const command = createConversationCommands(harness.deps);
    await command.parseAsync([
      "node",
      "conversation",
      "create",
      "--name",
      "My Group",
      "--members",
      "inbox1",
      "--as",
      "bot-alpha",
    ]);

    expect(harness.requestCalls[0]?.params).toMatchObject({
      creatorIdentityLabel: "bot-alpha",
    });
  });

  test("trims whitespace from comma-separated members", async () => {
    const harness = createHarness({ groupId: "grp_1" });

    const command = createConversationCommands(harness.deps);
    await command.parseAsync([
      "node",
      "conversation",
      "create",
      "--name",
      "G",
      "--members",
      " inbox1 , inbox2 , inbox3 ",
    ]);

    expect(harness.requestCalls[0]?.params).toMatchObject({
      memberInboxIds: ["inbox1", "inbox2", "inbox3"],
    });
  });
});

describe("conversation list", () => {
  test("routes through daemon client", async () => {
    const groups = [
      { groupId: "grp_1", name: "Group 1" },
      { groupId: "grp_2", name: "Group 2" },
    ];
    const harness = createHarness(groups);

    const command = createConversationCommands(harness.deps);
    await command.parseAsync([
      "node",
      "conversation",
      "list",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "conversation.list",
        params: { identityLabel: undefined },
      },
    ]);
    expect(harness.stderr).toEqual([]);
    expect(harness.stdout.join("")).toContain("grp_1");
  });

  test("passes --as label as identityLabel", async () => {
    const harness = createHarness([]);

    const command = createConversationCommands(harness.deps);
    await command.parseAsync([
      "node",
      "conversation",
      "list",
      "--as",
      "my-bot",
    ]);

    expect(harness.requestCalls[0]?.params).toMatchObject({
      identityLabel: "my-bot",
    });
  });
});

describe("conversation info", () => {
  test("routes group-id through daemon client", async () => {
    const info = {
      groupId: "grp_abc",
      name: "Test Group",
      memberCount: 3,
    };
    const harness = createHarness(info);

    const command = createConversationCommands(harness.deps);
    await command.parseAsync([
      "node",
      "conversation",
      "info",
      "grp_abc",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "conversation.info",
        params: { groupId: "grp_abc" },
      },
    ]);
    expect(harness.stderr).toEqual([]);
    expect(harness.stdout.join("")).toContain("grp_abc");
  });
});

describe("conversation add-member", () => {
  test("routes group-id and inbox-id through daemon client", async () => {
    const result = { added: true };
    const harness = createHarness(result);

    const command = createConversationCommands(harness.deps);
    await command.parseAsync([
      "node",
      "conversation",
      "add-member",
      "grp_abc",
      "inbox_xyz",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "conversation.add-member",
        params: { groupId: "grp_abc", inboxId: "inbox_xyz" },
      },
    ]);
    expect(harness.stderr).toEqual([]);
    expect(harness.stdout.join("")).toContain("added");
  });
});

describe("conversation error handling", () => {
  test("writes error to stderr on daemon client failure", async () => {
    const error = InternalError.create("Daemon not running");
    const harness = createErrorHarness(error);

    const command = createConversationCommands(harness.deps);
    await command.parseAsync(["node", "conversation", "list"]);

    expect(harness.stderr.join("")).toContain("Daemon not running");
    expect(harness.stdout).toEqual([]);
    expect(harness.exitCode).toBeDefined();
  });

  test("outputs JSON error when --json is set", async () => {
    const error = InternalError.create("Connection refused");
    const harness = createErrorHarness(error);

    const command = createConversationCommands(harness.deps);
    await command.parseAsync(["node", "conversation", "list", "--json"]);

    const output = harness.stderr.join("");
    // Should be valid JSON
    const parsed = JSON.parse(output.trim());
    expect(parsed).toHaveProperty("error");
    expect(parsed).toHaveProperty("message", "Connection refused");
  });
});
