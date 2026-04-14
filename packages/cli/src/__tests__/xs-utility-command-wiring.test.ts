import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { InternalError, type SignetError } from "@xmtp/signet-schemas";
import type { AdminClient } from "../admin/client.js";
import { createUtilityCommands } from "../commands/xs-utility.js";

interface RequestCall {
  readonly method: string;
  readonly params: Record<string, unknown> | undefined;
}

function createHarness<T>(response: T) {
  const requestCalls: RequestCall[] = [];
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
        ) => Promise<Result<TResult, SignetError>>,
      ): Promise<Result<TResult, SignetError>> {
        expect(options).toEqual({ configPath: "/tmp/test.toml" });
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
    stdout,
    stderr,
    get exitCode() {
      return exitCode;
    },
  };
}

function createErrorHarness(error: SignetError) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode: number | undefined;

  return {
    deps: {
      async withDaemonClient<TResult>(): Promise<Result<TResult, SignetError>> {
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

describe("xs utility command wiring", () => {
  test("routes lookup through the daemon client", async () => {
    const harness = createHarness({
      query: "support",
      found: true,
      mapping: {
        localId: "inbox_1234567890abcdef",
        networkId: "xmtp-inbox-1",
      },
      inbox: {
        id: "inbox_1234567890abcdef",
        label: "support",
        networkInboxId: "xmtp-inbox-1",
        groupId: null,
        createdAt: "2026-04-13T00:00:00.000Z",
      },
      operator: null,
      policy: null,
      credential: null,
    });
    const commands = createUtilityCommands(harness.deps);
    const lookup = commands.find((command) => command.name() === "lookup");
    expect(lookup).toBeDefined();

    await lookup!.parseAsync([
      "node",
      "lookup",
      "support",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "lookup.resolve",
        params: { query: "support" },
      },
    ]);
    expect(harness.stdout[0]).toContain("Query: support");
  });

  test("routes message search through the daemon with admin read elevation flag", async () => {
    const harness = createHarness({
      query: "secret",
      matches: [],
      total: 0,
    });
    const commands = createUtilityCommands(harness.deps);
    const search = commands.find((command) => command.name() === "search");
    expect(search).toBeDefined();

    await search!.parseAsync([
      "node",
      "search",
      "secret",
      "--chat",
      "conv_secret",
      "--as",
      "tester",
      "--dangerously-allow-message-read",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "search.messages",
        params: {
          query: "secret",
          chatId: "conv_secret",
          identityLabel: "tester",
          dangerouslyAllowMessageRead: true,
        },
      },
    ]);
    expect(harness.stdout).toEqual(["No messages found.\n"]);
  });

  test("does not pass admin read elevation flag to resource search", async () => {
    const harness = createHarness({
      query: "policy",
      matches: [],
      total: 0,
    });
    const commands = createUtilityCommands(harness.deps);
    const search = commands.find((command) => command.name() === "search");
    expect(search).toBeDefined();

    await search!.parseAsync([
      "node",
      "search",
      "policy",
      "--type",
      "policy",
      "--dangerously-allow-message-read",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "search.resources",
        params: {
          query: "policy",
          type: "policy",
        },
      },
    ]);
    expect(harness.stdout).toEqual(["No resources found.\n"]);
  });
});

describe("xs utility command errors", () => {
  test("writes lookup errors to stderr", async () => {
    const harness = createErrorHarness(InternalError.create("boom"));
    const commands = createUtilityCommands(harness.deps);
    const lookup = commands.find((command) => command.name() === "lookup");
    expect(lookup).toBeDefined();

    await lookup!.parseAsync(["node", "lookup", "support"]);

    expect(harness.stdout).toEqual([]);
    expect(harness.stderr[0]).toContain("category");
    expect(harness.exitCode).toBe(8);
  });
});
