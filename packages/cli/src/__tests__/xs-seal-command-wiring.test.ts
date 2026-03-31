import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { InternalError, type SignetError } from "@xmtp/signet-schemas";
import type { AdminClient } from "../admin/client.js";
import { createSealCommands } from "../commands/xs-seal.js";

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

describe("xs seal commands", () => {
  test("routes list filters through the daemon client", async () => {
    const harness = createHarness([]);
    const command = createSealCommands(harness.deps);

    await command.parseAsync([
      "node",
      "seal",
      "list",
      "--chat",
      "conv_abcd1234feedbabe",
      "--credential",
      "cred_abcd1234feedbabe",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "seal.list",
        params: {
          chatId: "conv_abcd1234feedbabe",
          credentialId: "cred_abcd1234feedbabe",
        },
      },
    ]);
  });

  test("routes verify through the daemon client", async () => {
    const harness = createHarness({
      sealId: "seal_abcd1234feedbabe",
      verdict: "verified",
      trustTier: "source-verified",
      checks: [],
    });
    const command = createSealCommands(harness.deps);

    await command.parseAsync([
      "node",
      "seal",
      "verify",
      "seal_abcd1234feedbabe",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "seal.verify",
        params: { sealId: "seal_abcd1234feedbabe" },
      },
    ]);
  });

  test("routes history with the required chat option", async () => {
    const harness = createHarness([]);
    const command = createSealCommands(harness.deps);

    await command.parseAsync([
      "node",
      "seal",
      "history",
      "cred_abcd1234feedbabe",
      "--chat",
      "conv_abcd1234feedbabe",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "seal.history",
        params: {
          credentialId: "cred_abcd1234feedbabe",
          chatId: "conv_abcd1234feedbabe",
        },
      },
    ]);
  });
});

describe("xs seal command errors", () => {
  test("writes daemon errors to stderr", async () => {
    const harness = createErrorHarness(InternalError.create("boom"));
    const command = createSealCommands(harness.deps);

    await command.parseAsync(["node", "seal", "info", "seal_abcd1234feedbabe"]);

    expect(harness.stdout).toEqual([]);
    expect(harness.stderr[0]).toContain("category: internal");
    expect(harness.exitCode).toBe(8);
  });
});
