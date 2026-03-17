import { Result } from "better-result";
import { InternalError } from "@xmtp/signet-schemas";
import { dirname } from "node:path";
import { mkdir, unlink, readFile, writeFile } from "node:fs/promises";

/** PID file data read from disk. */
export interface PidFileData {
  readonly pid: number;
}

/** PID file operations. */
export interface PidFile {
  /** Write PID to file. Creates parent directories if needed. */
  write(pid: number): Promise<Result<void, InternalError>>;

  /** Read PID from file. Returns null if file does not exist. */
  read(): Promise<Result<PidFileData | null, InternalError>>;

  /** Check if the process from the PID file is alive. */
  isAlive(): Promise<Result<boolean, InternalError>>;

  /** Remove the PID file. No-op if file does not exist. */
  cleanup(): Promise<Result<void, InternalError>>;
}

/**
 * Create a PID file manager for the given path.
 * PID file format: decimal PID followed by newline.
 */
export function createPidFile(pidPath: string): PidFile {
  return {
    async write(pid: number): Promise<Result<void, InternalError>> {
      try {
        await mkdir(dirname(pidPath), { recursive: true });
        await writeFile(pidPath, `${pid}\n`, "utf-8");
        return Result.ok(undefined);
      } catch (error: unknown) {
        return Result.err(
          InternalError.create(
            `Failed to write PID file: ${error instanceof Error ? error.message : String(error)}`,
            { pidPath },
          ),
        );
      }
    },

    async read(): Promise<Result<PidFileData | null, InternalError>> {
      try {
        const content = await readFile(pidPath, "utf-8");
        const pid = parseInt(content.trim(), 10);
        if (Number.isNaN(pid) || pid <= 0) {
          return Result.err(
            InternalError.create("Invalid PID file content", {
              pidPath,
              content,
            }),
          );
        }
        return Result.ok({ pid });
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return Result.ok(null);
        }
        return Result.err(
          InternalError.create(
            `Failed to read PID file: ${error instanceof Error ? error.message : String(error)}`,
            { pidPath },
          ),
        );
      }
    },

    async isAlive(): Promise<Result<boolean, InternalError>> {
      const readResult = await this.read();
      if (!readResult.isOk()) {
        return Result.err(readResult.error);
      }
      if (readResult.value === null) {
        return Result.ok(false);
      }

      try {
        process.kill(readResult.value.pid, 0);
        return Result.ok(true);
      } catch {
        return Result.ok(false);
      }
    },

    async cleanup(): Promise<Result<void, InternalError>> {
      try {
        await unlink(pidPath);
        return Result.ok(undefined);
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return Result.ok(undefined);
        }
        return Result.err(
          InternalError.create(
            `Failed to remove PID file: ${error instanceof Error ? error.message : String(error)}`,
            { pidPath },
          ),
        );
      }
    },
  };
}
