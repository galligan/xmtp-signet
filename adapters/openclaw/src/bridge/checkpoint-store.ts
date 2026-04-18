import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Result } from "better-result";
import { z } from "zod";
import { type SignetError } from "@xmtp/signet-schemas";
import {
  toBridgeInternalError,
  type OpenClawBridgeConfigType,
} from "./config.js";

/** Persisted bridge checkpoint for replay-safe reconnect and restart. */
export const OpenClawBridgeCheckpoint: z.ZodType<{
  credentialId: string;
  lastSeq: number;
  updatedAt: string;
}> = z
  .object({
    credentialId: z.string().min(1),
    lastSeq: z.number().int().nonnegative(),
    updatedAt: z.string().datetime(),
  })
  .strict();

/** Inferred bridge checkpoint type. */
export type OpenClawBridgeCheckpointType = z.infer<
  typeof OpenClawBridgeCheckpoint
>;

/** Filesystem-backed checkpoint persistence for the OpenClaw bridge. */
export interface OpenClawCheckpointStore {
  loadLatest(): Promise<
    Result<OpenClawBridgeCheckpointType | null, SignetError>
  >;
  loadForCredential(
    credentialId: string,
  ): Promise<Result<OpenClawBridgeCheckpointType | null, SignetError>>;
  save(
    checkpoint: OpenClawBridgeCheckpointType,
  ): Promise<Result<string, SignetError>>;
  pathForCredential(credentialId: string): string;
}

/** Dependencies for checkpoint store IO. */
export interface OpenClawCheckpointStoreDeps {
  readonly mkdir: typeof mkdir;
  readonly readFile: typeof readFile;
  readonly readdir: typeof readdir;
  readonly writeFile: typeof writeFile;
}

const defaultDeps: OpenClawCheckpointStoreDeps = {
  mkdir,
  readFile,
  readdir,
  writeFile,
};

function checkpointFilename(credentialId: string): string {
  return `${credentialId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
}

function updatedAtEpoch(updatedAt: string): number {
  const parsed = Date.parse(updatedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Create a checkpoint store rooted at the configured checkpoints directory. */
export function createOpenClawCheckpointStore(
  config: Pick<OpenClawBridgeConfigType, "checkpointsDir">,
  deps: Partial<OpenClawCheckpointStoreDeps> = {},
): OpenClawCheckpointStore {
  const resolvedDeps: OpenClawCheckpointStoreDeps = {
    ...defaultDeps,
    ...deps,
  };

  async function readCheckpointFile(
    path: string,
  ): Promise<Result<OpenClawBridgeCheckpointType | null, SignetError>> {
    try {
      const raw = await resolvedDeps.readFile(path, "utf-8");
      const parsed = OpenClawBridgeCheckpoint.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        return Result.err(
          toBridgeInternalError("Invalid OpenClaw checkpoint file", {
            path,
            issues: parsed.error.issues.map(
              (issue: { readonly message: string }) => issue.message,
            ),
          }),
        );
      }
      return Result.ok(parsed.data);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return Result.ok(null);
      }

      return Result.err(
        toBridgeInternalError("Failed to read OpenClaw checkpoint", {
          path,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  return {
    async loadLatest() {
      try {
        const entries = await resolvedDeps.readdir(config.checkpointsDir);
        const checkpoints: OpenClawBridgeCheckpointType[] = [];
        const issues: string[] = [];

        for (const entry of entries) {
          if (!entry.endsWith(".json")) {
            continue;
          }
          const checkpointResult = await readCheckpointFile(
            join(config.checkpointsDir, entry),
          );
          if (checkpointResult.isErr()) {
            issues.push(checkpointResult.error.message);
            continue;
          }
          if (checkpointResult.value !== null) {
            checkpoints.push(checkpointResult.value);
          }
        }

        if (checkpoints.length === 0) {
          if (issues.length > 0) {
            return Result.err(
              toBridgeInternalError(
                "All OpenClaw checkpoint files were unreadable",
                {
                  checkpointsDir: config.checkpointsDir,
                  issues,
                },
              ),
            );
          }
          return Result.ok(null);
        }

        checkpoints.sort(
          (a, b) => updatedAtEpoch(b.updatedAt) - updatedAtEpoch(a.updatedAt),
        );
        return Result.ok(checkpoints[0] ?? null);
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return Result.ok(null);
        }

        return Result.err(
          toBridgeInternalError("Failed to enumerate OpenClaw checkpoints", {
            checkpointsDir: config.checkpointsDir,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    },

    async loadForCredential(credentialId) {
      return readCheckpointFile(
        join(config.checkpointsDir, checkpointFilename(credentialId)),
      );
    },

    async save(checkpoint) {
      try {
        await resolvedDeps.mkdir(config.checkpointsDir, { recursive: true });
        const path = join(
          config.checkpointsDir,
          checkpointFilename(checkpoint.credentialId),
        );
        await resolvedDeps.writeFile(
          path,
          JSON.stringify(OpenClawBridgeCheckpoint.parse(checkpoint), null, 2),
        );
        return Result.ok(path);
      } catch (error) {
        return Result.err(
          toBridgeInternalError("Failed to persist OpenClaw checkpoint", {
            checkpointsDir: config.checkpointsDir,
            credentialId: checkpoint.credentialId,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    },

    pathForCredential(credentialId) {
      return join(config.checkpointsDir, checkpointFilename(credentialId));
    },
  };
}
