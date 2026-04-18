import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { Result } from "better-result";
import { z } from "zod";
import {
  InternalError,
  ValidationError,
  type SignetError,
} from "@xmtp/signet-schemas";
import {
  loadConfig,
  resolvePaths,
  type CliConfig,
  type ResolvedPaths,
} from "@xmtp/signet-cli";
import { OPENCLAW_ADAPTER_NAME } from "../config/index.js";

/** Local delivery modes supported by the first bridge spike. */
export const OpenClawBridgeDeliveryMode: z.ZodEnum<["local"]> = z.enum([
  "local",
]);

/** Parsed bridge runtime configuration for the OpenClaw sidecar. */
type OpenClawBridgeConfigInput = {
  adapter: string;
  wsUrl: string;
  token: string;
  checkpointsDir: string;
  deliveryMode?: "local" | undefined;
  reconnect?:
    | {
        enabled?: boolean | undefined;
        maxAttempts?: number | undefined;
        baseDelayMs?: number | undefined;
        maxDelayMs?: number | undefined;
        jitter?: boolean | undefined;
      }
    | undefined;
};

/** Parsed bridge runtime configuration for the OpenClaw sidecar. */
export const OpenClawBridgeConfig: z.ZodType<
  {
    adapter: string;
    wsUrl: string;
    token: string;
    checkpointsDir: string;
    deliveryMode: "local";
    reconnect: {
      enabled: boolean;
      maxAttempts: number;
      baseDelayMs: number;
      maxDelayMs: number;
      jitter: boolean;
    };
  },
  z.ZodTypeDef,
  OpenClawBridgeConfigInput
> = z
  .object({
    adapter: z.literal(OPENCLAW_ADAPTER_NAME),
    wsUrl: z
      .string()
      .min(1)
      .regex(/^wss?:\/\//, "Bridge wsUrl must begin with ws:// or wss://"),
    token: z.string().min(1),
    checkpointsDir: z.string().min(1),
    deliveryMode: OpenClawBridgeDeliveryMode.default("local"),
    reconnect: z
      .object({
        enabled: z.boolean().default(true),
        maxAttempts: z.number().int().nonnegative().default(10),
        baseDelayMs: z.number().int().positive().default(1_000),
        maxDelayMs: z.number().int().positive().default(30_000),
        jitter: z.boolean().default(true),
      })
      .default({}),
  })
  .strict();

/** Inferred OpenClaw bridge runtime config type. */
export type OpenClawBridgeConfigType = z.infer<typeof OpenClawBridgeConfig>;

/** Signet-derived paths relevant to the OpenClaw adapter. */
export interface OpenClawAdapterPaths {
  readonly config: CliConfig;
  readonly paths: ResolvedPaths;
  readonly adapterDir: string;
  readonly checkpointsDir: string;
}

/** Dependencies for resolving OpenClaw adapter paths. */
export interface OpenClawAdapterPathDeps {
  readonly loadConfig: typeof loadConfig;
  readonly resolvePaths: typeof resolvePaths;
  readonly pathExists: (path: string) => Promise<boolean>;
}

const defaultPathDeps: OpenClawAdapterPathDeps = {
  loadConfig,
  resolvePaths,
  async pathExists(path) {
    try {
      await access(path, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  },
};

/** Resolve the signet-derived filesystem paths used by the OpenClaw adapter. */
export async function resolveOpenClawAdapterPaths(
  options: {
    readonly configPath: string;
  },
  deps: Partial<OpenClawAdapterPathDeps> = {},
): Promise<Result<OpenClawAdapterPaths, SignetError>> {
  const resolvedDeps: OpenClawAdapterPathDeps = { ...defaultPathDeps, ...deps };
  const configResult = await resolvedDeps.loadConfig({
    configPath: options.configPath,
  });
  if (configResult.isErr()) {
    return configResult;
  }

  const config = configResult.value;
  const paths = resolvedDeps.resolvePaths(config);
  const adapterDir = join(paths.dataDir, "adapters", OPENCLAW_ADAPTER_NAME);
  const checkpointsDir = join(adapterDir, "checkpoints");

  return Result.ok({
    config,
    paths,
    adapterDir,
    checkpointsDir,
  });
}

/** Shared artifact/runtime presence snapshot for status and doctor commands. */
export interface OpenClawRuntimePresence {
  readonly adapterDir: string;
  readonly checkpointsDir: string;
  readonly presentFiles: readonly string[];
  readonly missingFiles: readonly string[];
  readonly checkpointsDirExists: boolean;
}

/** Inspect which OpenClaw adapter artifacts are currently present on disk. */
export async function inspectOpenClawRuntimePresence(
  options: {
    readonly configPath: string;
    readonly expectedFiles: readonly string[];
  },
  deps: Partial<OpenClawAdapterPathDeps> = {},
): Promise<Result<OpenClawRuntimePresence, SignetError>> {
  const resolvedDeps: OpenClawAdapterPathDeps = { ...defaultPathDeps, ...deps };
  const pathsResult = await resolveOpenClawAdapterPaths(options, resolvedDeps);
  if (pathsResult.isErr()) {
    return pathsResult;
  }

  const { adapterDir, checkpointsDir } = pathsResult.value;
  const presentFiles: string[] = [];
  const missingFiles: string[] = [];

  for (const file of options.expectedFiles) {
    const exists = await resolvedDeps.pathExists(join(adapterDir, file));
    if (exists) {
      presentFiles.push(file);
    } else {
      missingFiles.push(file);
    }
  }

  const checkpointsDirExists = await resolvedDeps.pathExists(checkpointsDir);

  return Result.ok({
    adapterDir,
    checkpointsDir,
    presentFiles,
    missingFiles,
    checkpointsDirExists,
  });
}

/** Resolve the last-seen sequence hint from bridge checkpoints. */
export function resolveResumeSeq(
  checkpoint: { readonly lastSeq: number } | null,
): number | null {
  if (checkpoint === null) {
    return null;
  }

  if (!Number.isInteger(checkpoint.lastSeq) || checkpoint.lastSeq < 0) {
    throw ValidationError.create(
      "bridge.lastSeq",
      "Checkpoint lastSeq must be a non-negative integer",
      {
        lastSeq: checkpoint.lastSeq,
      },
    );
  }

  return checkpoint.lastSeq;
}

/** Convert a transport or persistence failure into a stable SignetError. */
export function toBridgeInternalError(
  message: string,
  context?: Record<string, unknown>,
): SignetError {
  return InternalError.create(message, context);
}
