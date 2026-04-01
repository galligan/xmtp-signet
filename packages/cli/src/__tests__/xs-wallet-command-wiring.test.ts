import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { InternalError, type SignetError } from "@xmtp/signet-schemas";
import type { AdminClient } from "../admin/client.js";
import { createWalletCommands } from "../commands/xs-wallet.js";

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

describe("xs wallet commands", () => {
  test("routes create through the daemon client", async () => {
    const harness = createHarness({
      id: "wallet-1",
      label: "main",
      provider: "internal",
      accountCount: 0,
      createdAt: "2026-03-31T00:00:00.000Z",
    });
    const command = createWalletCommands(harness.deps);

    await command.parseAsync([
      "node",
      "wallet",
      "create",
      "--label",
      "main",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "wallet.create",
        params: { label: "main" },
      },
    ]);
  });

  test("routes list through the daemon client", async () => {
    const harness = createHarness([]);
    const command = createWalletCommands(harness.deps);

    await command.parseAsync([
      "node",
      "wallet",
      "list",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "wallet.list",
        params: {},
      },
    ]);
  });

  test("routes info through the daemon client", async () => {
    const harness = createHarness({
      id: "wallet-1",
      label: "main",
      provider: "internal",
      accountCount: 1,
      createdAt: "2026-03-31T00:00:00.000Z",
      accounts: [],
    });
    const command = createWalletCommands(harness.deps);

    await command.parseAsync([
      "node",
      "wallet",
      "info",
      "wallet-1",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "wallet.info",
        params: { walletId: "wallet-1" },
      },
    ]);
  });
});

describe("xs wallet command errors", () => {
  test("writes daemon errors to stderr", async () => {
    const harness = createErrorHarness(InternalError.create("boom"));
    const command = createWalletCommands(harness.deps);

    await command.parseAsync(["node", "wallet", "list"]);

    expect(harness.stdout).toEqual([]);
    expect(harness.stderr[0]).toContain("category: internal");
    expect(harness.exitCode).toBe(8);
  });
});
