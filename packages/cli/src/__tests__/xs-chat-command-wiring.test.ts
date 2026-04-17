import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { InternalError, type SignetError } from "@xmtp/signet-schemas";
import type { AdminClient } from "../admin/client.js";
import { createChatCommands } from "../commands/xs-chat.js";
import type { DaemonCommandContext } from "../commands/daemon-client.js";
import type { CliConfig } from "../config/schema.js";

interface RequestCall {
  readonly method: string;
  readonly params: Record<string, unknown> | undefined;
}

function stubConfig(profileNameDefault?: string): CliConfig {
  return {
    signet: {
      env: "dev",
      identityMode: "per-group",
      dataDir: undefined,
    },
    defaults: {
      profileName: profileNameDefault,
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
  };
}

function createHarness<T>(
  response: T | readonly T[],
  options?: {
    readonly profileNameDefault?: string | undefined;
  },
) {
  const requestCalls: RequestCall[] = [];
  const withDaemonCalls: Array<{ configPath?: string | undefined }> = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode: number | undefined;
  const queuedResponses = Array.isArray(response) ? [...response] : [response];

  const client: AdminClient = {
    async connect() {
      return Result.ok(undefined);
    },
    async request(method, params) {
      requestCalls.push({ method, params });
      const next = queuedResponses.shift();
      if (next === undefined) {
        throw new Error(`No queued response left for ${method}`);
      }
      return Result.ok(next);
    },
    async close() {},
  };

  return {
    deps: {
      async withDaemonClient<TResult>(
        options: { configPath?: string | undefined },
        run: (
          adminClient: AdminClient,
          context: DaemonCommandContext,
        ) => Promise<Result<TResult, SignetError>>,
      ): Promise<Result<TResult, SignetError>> {
        withDaemonCalls.push(options);
        return run(client, {} as DaemonCommandContext);
      },
      async loadConfig() {
        return Result.ok(stubConfig(options?.profileNameDefault));
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

function createMixedHarness(
  responses: readonly Result<unknown, SignetError>[],
  options?: {
    readonly profileNameDefault?: string | undefined;
  },
) {
  const requestCalls: RequestCall[] = [];
  const withDaemonCalls: Array<{ configPath?: string | undefined }> = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode: number | undefined;
  const queuedResponses = [...responses];

  const client: AdminClient = {
    async connect() {
      return Result.ok(undefined);
    },
    async request<T>(method: string, params?: Record<string, unknown>) {
      requestCalls.push({ method, params });
      const next = queuedResponses.shift();
      if (next === undefined) {
        throw new Error(`No queued response left for ${method}`);
      }
      return next as Result<T, SignetError>;
    },
    async close() {},
  };

  return {
    deps: {
      async withDaemonClient<TResult>(
        opts: { configPath?: string | undefined },
        run: (
          adminClient: AdminClient,
          context: DaemonCommandContext,
        ) => Promise<Result<TResult, SignetError>>,
      ): Promise<Result<TResult, SignetError>> {
        withDaemonCalls.push(opts);
        return run(client, {} as DaemonCommandContext);
      },
      async loadConfig() {
        return Result.ok(stubConfig(options?.profileNameDefault));
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

function createErrorHarness(error: SignetError) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode: number | undefined;

  return {
    deps: {
      async withDaemonClient<TResult>(): Promise<Result<TResult, SignetError>> {
        return Result.err(error);
      },
      async loadConfig() {
        return Result.ok(stubConfig());
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

describe("xs chat update", () => {
  test("routes metadata fields through the daemon client", async () => {
    const harness = createHarness({ groupId: "g1", name: "Renamed" });
    const command = createChatCommands(harness.deps);

    await command.parseAsync([
      "node",
      "chat",
      "update",
      "conv_abc",
      "--name",
      "Renamed",
      "--description",
      "Updated description",
      "--image",
      "https://example.com/group.png",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.withDaemonCalls).toEqual([{ configPath: "/tmp/test.toml" }]);
    expect(harness.requestCalls).toEqual([
      {
        method: "chat.update",
        params: {
          chatId: "conv_abc",
          name: "Renamed",
          description: "Updated description",
          imageUrl: "https://example.com/group.png",
        },
      },
    ]);
    expect(harness.stderr).toEqual([]);
  });
});

describe("xs chat join", () => {
  test("routes operator and explicit profile options through the daemon client", async () => {
    const harness = createHarness({ groupId: "g1", profileName: "Codex" });
    const command = createChatCommands(harness.deps);

    await command.parseAsync([
      "node",
      "chat",
      "join",
      "https://popup.convos.org/v2?i=test",
      "--as",
      "joiner",
      "--op",
      "op_codex",
      "--profile-name",
      "Codex",
      "--timeout",
      "45",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.withDaemonCalls).toEqual([{ configPath: "/tmp/test.toml" }]);
    expect(harness.requestCalls).toEqual([
      {
        method: "chat.join",
        params: {
          inviteUrl: "https://popup.convos.org/v2?i=test",
          label: "joiner",
          operatorId: "op_codex",
          profileName: "Codex",
          timeoutSeconds: 45,
        },
      },
    ]);
  });

  test("falls back to the configured default profile name when none is passed", async () => {
    const harness = createHarness(
      { groupId: "g1", profileName: "Codex" },
      { profileNameDefault: "Codex" },
    );
    const command = createChatCommands(harness.deps);

    await command.parseAsync([
      "node",
      "chat",
      "join",
      "https://popup.convos.org/v2?i=test",
      "--timeout",
      "45",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "chat.join",
        params: {
          inviteUrl: "https://popup.convos.org/v2?i=test",
          profileName: "Codex",
          timeoutSeconds: 45,
        },
      },
    ]);
  });

  test("skips default profile name when --op is provided", async () => {
    const harness = createHarness(
      { groupId: "g1" },
      { profileNameDefault: "DefaultProfile" },
    );
    const command = createChatCommands(harness.deps);

    await command.parseAsync([
      "node",
      "chat",
      "join",
      "https://popup.convos.org/v2?i=test",
      "--op",
      "op_agent1",
    ]);

    expect(harness.requestCalls).toHaveLength(1);
    expect(harness.requestCalls[0]?.method).toBe("chat.join");
    expect(harness.requestCalls[0]?.params).not.toHaveProperty("profileName");
  });
});

describe("xs chat invite", () => {
  test("preserves the legacy key-value output for non-JSON invite consumers", async () => {
    const harness = createHarness({
      inviteUrl: "https://popup.convos.org/v2?i=test",
      groupName: "Codex Group",
      groupId: "g1",
    });
    const command = createChatCommands(harness.deps);

    await command.parseAsync([
      "node",
      "chat",
      "invite",
      "conv_abc",
      "--format",
      "link",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "chat.invite",
        params: {
          chatId: "conv_abc",
        },
      },
    ]);
    expect(harness.stdout.join("")).toContain("groupName: Codex Group");
    expect(harness.stdout.join("")).toContain(
      "https://popup.convos.org/v2?i=test",
    );
    expect(harness.stdout.join("")).toContain("inviteUrl:");
  });

  test("includes a QR data URL in JSON output", async () => {
    const harness = createHarness({
      inviteUrl: "https://popup.convos.org/v2?i=test",
      groupName: "Codex Group",
      groupId: "g1",
    });
    const command = createChatCommands(harness.deps);

    await command.parseAsync(["node", "chat", "invite", "conv_abc", "--json"]);

    const parsed = JSON.parse(harness.stdout.join(""));
    expect(parsed.inviteUrl).toBe("https://popup.convos.org/v2?i=test");
    expect(parsed.qrDataUrl).toMatch(/^data:image\/png;base64,/);
  });
});

describe("xs chat create", () => {
  test("can create, publish a profile, and invite in one flow", async () => {
    const harness = createHarness([
      { chatId: "conv_new", groupId: "g1", name: "Codex Group" },
      { profileApplied: true, profileName: "Codex" },
      {
        inviteUrl: "https://popup.convos.org/v2?i=test",
        groupName: "Codex Group",
        groupId: "g1",
      },
    ]);
    const command = createChatCommands(harness.deps);

    await command.parseAsync([
      "node",
      "chat",
      "create",
      "--name",
      "Codex Group",
      "--invite",
      "--profile-name",
      "Codex",
      "--invite-description",
      "Join this test chat",
      "--format",
      "link",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "chat.create",
        params: {
          name: "Codex Group",
          memberInboxIds: [],
        },
      },
      {
        method: "chat.update-profile",
        params: {
          chatId: "conv_new",
          profileName: "Codex",
        },
      },
      {
        method: "chat.invite",
        params: {
          chatId: "conv_new",
          description: "Join this test chat",
        },
      },
    ]);
    expect(harness.stdout.join("")).toContain("inviteUrl:");
  });

  test("converts invite failure to a non-fatal warning preserving chatId", async () => {
    const harness = createMixedHarness([
      Result.ok({ chatId: "conv_new", name: "Test" }),
      Result.ok({ profileApplied: true }),
      Result.err(
        InternalError.create("invite service unavailable") as SignetError,
      ),
    ]);
    const command = createChatCommands(harness.deps);

    await command.parseAsync([
      "node",
      "chat",
      "create",
      "--name",
      "Test",
      "--invite",
      "--profile-name",
      "Codex",
      "--format",
      "link",
    ]);

    expect(harness.requestCalls).toHaveLength(3);
    expect(harness.requestCalls[0]?.method).toBe("chat.create");
    expect(harness.requestCalls[1]?.method).toBe("chat.update-profile");
    expect(harness.requestCalls[2]?.method).toBe("chat.invite");
    expect(harness.stdout.join("")).toContain("conv_new");
    expect(harness.stderr.join("")).toContain("warning: invite failed");
    expect(harness.exitCode).toBeUndefined();
  });

  test("skips default profile name when --op is provided", async () => {
    const harness = createHarness(
      { chatId: "conv_new", name: "Op Chat" },
      { profileNameDefault: "DefaultProfile" },
    );
    const command = createChatCommands(harness.deps);

    await command.parseAsync([
      "node",
      "chat",
      "create",
      "--name",
      "Op Chat",
      "--op",
      "op_agent1",
    ]);

    expect(harness.requestCalls).toHaveLength(1);
    expect(harness.requestCalls[0]?.method).toBe("chat.create");
    expect(harness.requestCalls[0]?.params).not.toHaveProperty("profileName");
  });
});

describe("xs chat update-profile", () => {
  test("routes identity and operator-backed defaults through the daemon client", async () => {
    const harness = createHarness({ profileApplied: true });
    const command = createChatCommands(harness.deps);

    await command.parseAsync([
      "node",
      "chat",
      "update-profile",
      "conv_abc",
      "--as",
      "joiner",
      "--op",
      "op_codex",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.withDaemonCalls).toEqual([{ configPath: "/tmp/test.toml" }]);
    expect(harness.requestCalls).toEqual([
      {
        method: "chat.update-profile",
        params: {
          chatId: "conv_abc",
          identityLabel: "joiner",
          operatorId: "op_codex",
        },
      },
    ]);
  });

  test("uses the configured default profile name when no explicit override is provided", async () => {
    const harness = createHarness(
      { profileApplied: true, profileName: "Codex" },
      { profileNameDefault: "Codex" },
    );
    const command = createChatCommands(harness.deps);

    await command.parseAsync([
      "node",
      "chat",
      "update-profile",
      "conv_abc",
      "--config",
      "/tmp/test.toml",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "chat.update-profile",
        params: {
          chatId: "conv_abc",
          profileName: "Codex",
        },
      },
    ]);
  });

  test("skips default profile name when --op is provided", async () => {
    const harness = createHarness(
      { profileApplied: true },
      { profileNameDefault: "DefaultProfile" },
    );
    const command = createChatCommands(harness.deps);

    await command.parseAsync([
      "node",
      "chat",
      "update-profile",
      "conv_abc",
      "--op",
      "op_agent1",
    ]);

    expect(harness.requestCalls).toHaveLength(1);
    expect(harness.requestCalls[0]?.method).toBe("chat.update-profile");
    expect(harness.requestCalls[0]?.params).not.toHaveProperty("profileName");
  });
});

describe("xs chat leave", () => {
  test("without --force prints dry-run message and does not dispatch", async () => {
    const harness = createHarness({ leftGroup: true });
    const command = createChatCommands(harness.deps);

    await command.parseAsync(["node", "chat", "leave", "conv_abc"]);

    expect(harness.requestCalls).toEqual([]);
    expect(harness.stderr.join("")).toContain("This will");
    expect(harness.stderr.join("")).toContain("--force");
    expect(harness.exitCode).toBe(0);
  });

  test("with --force routes purge flag through the daemon client", async () => {
    const harness = createHarness({ leftGroup: true });
    const command = createChatCommands(harness.deps);

    await command.parseAsync([
      "node",
      "chat",
      "leave",
      "conv_abc",
      "--purge",
      "--force",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "chat.leave",
        params: {
          chatId: "conv_abc",
          purge: true,
        },
      },
    ]);
  });
});

describe("xs chat rm", () => {
  test("without --force prints dry-run message and does not dispatch", async () => {
    const harness = createHarness({ removed: true });
    const command = createChatCommands(harness.deps);

    await command.parseAsync(["node", "chat", "rm", "conv_abc"]);

    expect(harness.requestCalls).toEqual([]);
    expect(harness.stderr.join("")).toContain("This will");
    expect(harness.stderr.join("")).toContain("--force");
    expect(harness.exitCode).toBe(0);
  });

  test("with --force dispatches through the daemon client", async () => {
    const harness = createHarness({ removed: true });
    const command = createChatCommands(harness.deps);

    await command.parseAsync(["node", "chat", "rm", "conv_abc", "--force"]);

    expect(harness.requestCalls).toEqual([
      {
        method: "chat.rm",
        params: {
          chatId: "conv_abc",
          force: true,
        },
      },
    ]);
  });
});

describe("xs chat member admin commands", () => {
  test("routes member rm with identity label", async () => {
    const harness = createHarness({ memberCount: 1 });
    const command = createChatCommands(harness.deps);

    await command.parseAsync([
      "node",
      "chat",
      "member",
      "rm",
      "conv_abc",
      "inbox_member",
      "--as",
      "agent-alpha",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "chat.remove-member",
        params: {
          chatId: "conv_abc",
          inboxId: "inbox_member",
          identityLabel: "agent-alpha",
        },
      },
    ]);
  });

  test("routes member promote and demote", async () => {
    const harness = createHarness([{ role: "admin" }, { role: "member" }]);
    const command = createChatCommands(harness.deps);

    await command.parseAsync([
      "node",
      "chat",
      "member",
      "promote",
      "conv_abc",
      "inbox_member",
    ]);
    await command.parseAsync([
      "node",
      "chat",
      "member",
      "demote",
      "conv_abc",
      "inbox_member",
    ]);

    expect(harness.requestCalls).toEqual([
      {
        method: "chat.promote-member",
        params: {
          chatId: "conv_abc",
          inboxId: "inbox_member",
        },
      },
      {
        method: "chat.demote-member",
        params: {
          chatId: "conv_abc",
          inboxId: "inbox_member",
        },
      },
    ]);
  });
});

describe("xs chat error handling", () => {
  test("writes error output on daemon failure", async () => {
    const harness = createErrorHarness(InternalError.create("daemon offline"));
    const command = createChatCommands(harness.deps);

    await command.parseAsync(["node", "chat", "update", "conv_abc"]);

    expect(harness.stderr.join("")).toContain("daemon offline");
    expect(harness.stdout).toEqual([]);
    expect(harness.exitCode).toBeDefined();
  });
});
