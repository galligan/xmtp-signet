import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { InternalError, type SignetError } from "@xmtp/signet-schemas";
import type { AdminClient } from "../admin/client.js";
import { createKeyCommands } from "../commands/xs-key.js";

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

describe("xs key commands", () => {
  test("routes init through the daemon client", async () => {
    const harness = createHarness({
      operatorId: "op_abc12345feedbabe",
      walletId: "wallet-1",
    });
    const command = createKeyCommands(harness.deps);

    await command.parseAsync([
      "node",
      "key",
      "init",
      "--operator",
      "alpha",
      "--wallet",
      "wallet-1",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "keys.init",
        params: { operatorId: "alpha", walletId: "wallet-1" },
      },
    ]);
  });

  test("routes rotate through the daemon client", async () => {
    const harness = createHarness({ rotated: 1, failed: 0, errors: [] });
    const command = createKeyCommands(harness.deps);

    await command.parseAsync([
      "node",
      "key",
      "rotate",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "keys.rotate",
        params: {},
      },
    ]);
  });

  test("routes list through the daemon client", async () => {
    const harness = createHarness([]);
    const command = createKeyCommands(harness.deps);

    await command.parseAsync([
      "node",
      "key",
      "list",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "keys.list",
        params: {},
      },
    ]);
  });

  test("routes info through the daemon client", async () => {
    const harness = createHarness({
      keyId: "key_abc12345feedbabe",
    });
    const command = createKeyCommands(harness.deps);

    await command.parseAsync([
      "node",
      "key",
      "info",
      "key_abc12345feedbabe",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "keys.info",
        params: { keyId: "key_abc12345feedbabe" },
      },
    ]);
  });
});

describe("xs key command errors", () => {
  test("writes daemon errors to stderr", async () => {
    const harness = createErrorHarness(InternalError.create("boom"));
    const command = createKeyCommands(harness.deps);

    await command.parseAsync([
      "node",
      "key",
      "list",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.stdout).toEqual([]);
    expect(harness.stderr[0]).toContain("category: internal");
    expect(harness.exitCode).toBe(8);
  });
});
