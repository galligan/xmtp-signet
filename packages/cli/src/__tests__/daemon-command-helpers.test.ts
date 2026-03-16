import { afterEach, describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  AuthError,
  InternalError,
  ValidationError,
} from "@xmtp-broker/schemas";
import { CliConfigSchema } from "../config/schema.js";
import {
  createWithDaemonClient,
  parseJsonInput,
} from "../commands/daemon-client.js";

const testDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    testDirs.splice(0).map((dir) =>
      rm(dir, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

function makeConfig(dataDir: string) {
  return CliConfigSchema.parse({
    broker: { dataDir },
    admin: { socketPath: join(dataDir, "admin.sock") },
    logging: { auditLogPath: join(dataDir, "audit.jsonl") },
  });
}

describe("parseJsonInput", () => {
  test("parses inline JSON against the provided schema", async () => {
    const result = await parseJsonInput(
      '{"mode":"full","threadScopes":[{"groupId":"g1","threadId":null}],"contentTypes":["xmtp.org/text:1.0"]}',
      "view",
      z.object({
        mode: z.literal("full"),
        threadScopes: z.array(
          z.object({
            groupId: z.string(),
            threadId: z.string().nullable(),
          }),
        ),
        contentTypes: z.array(z.string()),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.mode).toBe("full");
      expect(result.value.threadScopes[0]?.groupId).toBe("g1");
    }
  });

  test("parses @file JSON input", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xmtp-broker-cli-json-"));
    testDirs.push(dir);
    const filePath = join(dir, "grant.json");

    await writeFile(
      filePath,
      JSON.stringify({
        messaging: {
          send: true,
          reply: false,
          react: false,
          draftOnly: false,
        },
      }),
    );

    const result = await parseJsonInput(
      `@${filePath}`,
      "grant",
      z.object({
        messaging: z.object({
          send: z.boolean(),
          reply: z.boolean(),
          react: z.boolean(),
          draftOnly: z.boolean(),
        }),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.messaging.send).toBe(true);
      expect(result.value.messaging.reply).toBe(false);
    }
  });

  test("returns a validation error for invalid JSON", async () => {
    const result = await parseJsonInput("{not-json}", "view", z.object({}));

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ValidationError);
    }
  });
});

describe("withDaemonClient", () => {
  test("loads config, signs an admin JWT, connects, runs the callback, and closes the client", async () => {
    const calls: string[] = [];
    const dir = await mkdtemp(join(tmpdir(), "xmtp-broker-cli-daemon-"));
    testDirs.push(dir);
    const config = makeConfig(dir);
    const withDaemonClient = createWithDaemonClient({
      loadConfig: async () => Result.ok(config),
      resolvePaths: () => ({
        configFile: join(dir, "config.toml"),
        dataDir: dir,
        pidFile: join(dir, "broker.pid"),
        adminSocket: join(dir, "admin.sock"),
        auditLog: join(dir, "audit.jsonl"),
      }),
      createKeyManager: async () =>
        Result.ok({
          initialize: async () => {
            calls.push("initialize");
            return Result.ok({
              publicKey: "pub",
              fingerprint: "fp",
              trustTier: "software" as const,
            });
          },
          close: () => {
            calls.push("closeKeyManager");
          },
          admin: {
            exists: () => true,
            signJwt: async () => {
              calls.push("signJwt");
              return Result.ok("admin-jwt");
            },
          },
        }),
      createAdminClient: () => ({
        connect: async (token: string) => {
          calls.push(`connect:${token}`);
          return Result.ok(undefined);
        },
        request: async () => Result.ok({ ok: true }),
        close: async () => {
          calls.push("closeClient");
        },
      }),
    });

    const result = await withDaemonClient({}, async (client, ctx) => {
      calls.push(`run:${ctx.paths.adminSocket}`);
      const requestResult = await client.request<{ ok: boolean }>(
        "broker.status",
      );
      if (requestResult.isErr()) {
        return requestResult;
      }
      return Result.ok(requestResult.value.ok);
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(true);
    }
    expect(calls).toEqual([
      "initialize",
      "signJwt",
      "connect:admin-jwt",
      `run:${join(dir, "admin.sock")}`,
      "closeClient",
      "closeKeyManager",
    ]);
  });

  test("returns an auth error when no admin key is available", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xmtp-broker-cli-no-admin-"));
    testDirs.push(dir);
    const config = makeConfig(dir);
    const withDaemonClient = createWithDaemonClient({
      loadConfig: async () => Result.ok(config),
      resolvePaths: () => ({
        configFile: join(dir, "config.toml"),
        dataDir: dir,
        pidFile: join(dir, "broker.pid"),
        adminSocket: join(dir, "admin.sock"),
        auditLog: join(dir, "audit.jsonl"),
      }),
      createKeyManager: async () =>
        Result.ok({
          initialize: async () =>
            Result.ok({
              publicKey: "pub",
              fingerprint: "fp",
              trustTier: "software" as const,
            }),
          close: () => {},
          admin: {
            exists: () => false,
            signJwt: async () => Result.ok("admin-jwt"),
          },
        }),
      createAdminClient: () => ({
        connect: async () => Result.ok(undefined),
        request: async () => Result.ok({}),
        close: async () => {},
      }),
    });

    const result = await withDaemonClient({}, async () => Result.ok(undefined));

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(AuthError);
    }
  });

  test("still closes the client when the callback returns an error", async () => {
    const calls: string[] = [];
    const dir = await mkdtemp(join(tmpdir(), "xmtp-broker-cli-close-"));
    testDirs.push(dir);
    const config = makeConfig(dir);
    const withDaemonClient = createWithDaemonClient({
      loadConfig: async () => Result.ok(config),
      resolvePaths: () => ({
        configFile: join(dir, "config.toml"),
        dataDir: dir,
        pidFile: join(dir, "broker.pid"),
        adminSocket: join(dir, "admin.sock"),
        auditLog: join(dir, "audit.jsonl"),
      }),
      createKeyManager: async () =>
        Result.ok({
          initialize: async () =>
            Result.ok({
              publicKey: "pub",
              fingerprint: "fp",
              trustTier: "software" as const,
            }),
          close: () => {
            calls.push("closeKeyManager");
          },
          admin: {
            exists: () => true,
            signJwt: async () => Result.ok("admin-jwt"),
          },
        }),
      createAdminClient: () => ({
        connect: async () => Result.ok(undefined),
        request: async () => Result.ok({}),
        close: async () => {
          calls.push("closeClient");
        },
      }),
    });

    const result = await withDaemonClient({}, async () =>
      Result.err(InternalError.create("boom")),
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("boom");
    }
    expect(calls).toEqual(["closeClient", "closeKeyManager"]);
  });

  test("awaits the callback before closing the admin client", async () => {
    const calls: string[] = [];
    let resolveRequest: (() => void) | undefined;
    const requestFinished = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    });
    const dir = await mkdtemp(join(tmpdir(), "xmtp-broker-cli-await-"));
    testDirs.push(dir);
    const config = makeConfig(dir);
    const withDaemonClient = createWithDaemonClient({
      loadConfig: async () => Result.ok(config),
      resolvePaths: () => ({
        configFile: join(dir, "config.toml"),
        dataDir: dir,
        pidFile: join(dir, "broker.pid"),
        adminSocket: join(dir, "admin.sock"),
        auditLog: join(dir, "audit.jsonl"),
      }),
      createKeyManager: async () =>
        Result.ok({
          initialize: async () =>
            Result.ok({
              publicKey: "pub",
              fingerprint: "fp",
              trustTier: "software" as const,
            }),
          close: () => {
            calls.push("closeKeyManager");
          },
          admin: {
            exists: () => true,
            signJwt: async () => Result.ok("admin-jwt"),
          },
        }),
      createAdminClient: () => ({
        connect: async () => Result.ok(undefined),
        request: async () => {
          calls.push("request:start");
          await requestFinished;
          calls.push("request:done");
          return Result.ok({ ok: true });
        },
        close: async () => {
          calls.push("closeClient");
        },
      }),
    });

    const pending = withDaemonClient({}, async (client) => {
      const result = await client.request("broker.status");
      if (result.isErr()) {
        return result;
      }
      return Result.ok(result.value);
    });

    calls.push("before-resolve");
    resolveRequest?.();
    const result = await pending;

    expect(result.isOk()).toBe(true);
    expect(calls).toContain("request:start");
    expect(calls).toContain("request:done");
    expect(calls.indexOf("request:done")).toBeLessThan(
      calls.indexOf("closeClient"),
    );
    expect(calls.indexOf("closeClient")).toBeLessThan(
      calls.indexOf("closeKeyManager"),
    );
  });
});
