import { Result } from "better-result";
import type { z } from "zod";
import { createKeyManager, type KeyManager } from "@xmtp/signet-keys";
import {
  AuthError,
  InternalError,
  ValidationError,
  type SignetError,
} from "@xmtp/signet-schemas";
import type { AdminClient } from "../admin/client.js";
import { createAdminClient } from "../admin/client.js";
import { loadConfig } from "../config/loader.js";
import { resolvePaths, type ResolvedPaths } from "../config/paths.js";
import type { CliConfig } from "../config/schema.js";

export interface DaemonCommandContext {
  readonly config: CliConfig;
  readonly paths: ResolvedPaths;
}

export interface DaemonCommandDeps {
  readonly loadConfig: typeof loadConfig;
  readonly resolvePaths: typeof resolvePaths;
  readonly createKeyManager: (
    config: Parameters<typeof createKeyManager>[0],
  ) => Promise<Result<RpcKeyManager, SignetError>>;
  readonly createAdminClient: (socketPath: string) => AdminClient;
}

export interface DaemonCommandOptions {
  readonly configPath?: string | undefined;
}

export type WithDaemonClient = <T>(
  options: DaemonCommandOptions,
  run: (
    client: AdminClient,
    context: DaemonCommandContext,
  ) => Promise<Result<T, SignetError>>,
) => Promise<Result<T, SignetError>>;

const defaultDeps: DaemonCommandDeps = {
  loadConfig,
  resolvePaths,
  createKeyManager,
  createAdminClient,
};

type RpcKeyManager = Pick<KeyManager, "initialize" | "admin"> & {
  close?: () => void;
};

export function createWithDaemonClient(
  deps: Partial<DaemonCommandDeps> = {},
): WithDaemonClient {
  const resolvedDeps: DaemonCommandDeps = {
    ...defaultDeps,
    ...deps,
  };

  return async <T>(
    options: DaemonCommandOptions,
    run: (
      client: AdminClient,
      context: DaemonCommandContext,
    ) => Promise<Result<T, SignetError>>,
  ): Promise<Result<T, SignetError>> => {
    const configResult = await resolvedDeps.loadConfig(
      options.configPath !== undefined
        ? { configPath: options.configPath }
        : {},
    );
    if (configResult.isErr()) {
      return configResult;
    }

    const config = configResult.value;
    const paths = resolvedDeps.resolvePaths(config);
    const keyManagerResult = await resolvedDeps.createKeyManager({
      rootKeyPolicy: config.keys.rootKeyPolicy,
      operationalKeyPolicy: config.keys.operationalKeyPolicy,
      dataDir: paths.dataDir,
    });
    if (keyManagerResult.isErr()) {
      return keyManagerResult;
    }

    const keyManager = keyManagerResult.value;
    return runWithKeyManager(
      keyManager,
      paths,
      { config, paths },
      resolvedDeps.createAdminClient,
      run,
    );
  };
}

async function runWithKeyManager<T>(
  keyManager: RpcKeyManager,
  paths: ResolvedPaths,
  context: DaemonCommandContext,
  makeClient: (socketPath: string) => AdminClient,
  run: (
    client: AdminClient,
    context: DaemonCommandContext,
  ) => Promise<Result<T, SignetError>>,
): Promise<Result<T, SignetError>> {
  const client = makeClient(paths.adminSocket);

  try {
    const initResult = await keyManager.initialize();
    if (initResult.isErr()) {
      return initResult;
    }

    if (!keyManager.admin.exists()) {
      return Result.err(
        AuthError.create(
          "No admin key found. Run 'xmtp-signet identity init' first.",
        ),
      );
    }

    const tokenResult = await keyManager.admin.signJwt({ ttlSeconds: 120 });
    if (tokenResult.isErr()) {
      return tokenResult;
    }

    const connectResult = await client.connect(tokenResult.value);
    if (connectResult.isErr()) {
      return connectResult;
    }

    return await run(client, context);
  } finally {
    await client.close();
    keyManager.close?.();
  }
}

export async function parseJsonInput<T>(
  value: string,
  field: string,
  schema: z.ZodType<T>,
): Promise<Result<T, SignetError>> {
  let rawText: string;
  try {
    rawText = await readInputValue(value);
  } catch (error) {
    return Result.err(
      error instanceof InternalError
        ? error
        : InternalError.create("Failed to read JSON input", {
            field,
            cause: error instanceof Error ? error.message : String(error),
          }),
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch (error: unknown) {
    return Result.err(
      ValidationError.create(field, "Expected valid JSON", {
        cause: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  const parsed = schema.safeParse(parsedJson);
  if (!parsed.success) {
    return Result.err(
      ValidationError.create(field, "Value did not match schema", {
        issues: parsed.error.issues,
      }),
    );
  }

  return Result.ok(parsed.data);
}

async function readInputValue(value: string): Promise<string> {
  if (!value.startsWith("@")) {
    return value;
  }

  const file = Bun.file(value.slice(1));
  if (!(await file.exists())) {
    throw InternalError.create("Failed to read JSON input file", {
      filePath: value.slice(1),
      cause: "File does not exist",
    });
  }

  try {
    return await file.text();
  } catch (error) {
    throw InternalError.create("Failed to read JSON input file", {
      filePath: value.slice(1),
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}
