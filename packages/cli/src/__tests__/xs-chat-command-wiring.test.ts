import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import type { AdminClient } from "../admin/client.js";
import { createChatCommands } from "../commands/xs-chat.js";

interface RequestCall {
  readonly method: string;
  readonly params: Record<string, unknown> | undefined;
}

function createHarness<T>(response: T) {
  const requestCalls: RequestCall[] = [];

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
    requestCalls,
    deps: {
      async withDaemonClient<TResult>(
        _options: { configPath?: string | undefined },
        run: (
          adminClient: AdminClient,
        ) => Promise<Result<TResult, SignetError>>,
      ): Promise<Result<TResult, SignetError>> {
        return run(client);
      },
      writeStdout() {},
      writeStderr() {},
      exit() {},
    },
  };
}

describe("xs chat command wiring", () => {
  test("forwards --as on chat sync as identityLabel", async () => {
    const harness = createHarness({ synced: true });
    const command = createChatCommands(harness.deps);

    await command.parseAsync([
      "node",
      "chat",
      "sync",
      "conv_0123456789abcdef",
      "--as",
      "alpha",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "chat.sync",
        params: {
          chatId: "conv_0123456789abcdef",
          identityLabel: "alpha",
        },
      },
    ]);
  });

  test("forwards --as on chat member rm as identityLabel", async () => {
    const harness = createHarness({ chatId: "conv_0123456789abcdef" });
    const command = createChatCommands(harness.deps);

    await command.parseAsync([
      "node",
      "chat",
      "member",
      "rm",
      "conv_0123456789abcdef",
      "inbox_abc",
      "--as",
      "moderator",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "chat.remove-member",
        params: {
          chatId: "conv_0123456789abcdef",
          inboxId: "inbox_abc",
          identityLabel: "moderator",
        },
      },
    ]);
  });
});
