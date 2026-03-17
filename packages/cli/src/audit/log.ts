import { mkdir, readFile, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * A single entry in the signet's append-only audit log.
 * Covers admin operations: session issuance/revocation,
 * key rotation, daemon lifecycle events.
 */
export interface AuditEntry {
  readonly timestamp: string;
  readonly action: string;
  readonly actor: "admin" | "system";
  readonly target?: string;
  readonly detail?: Record<string, unknown>;
  readonly success: boolean;
}

/**
 * Append-only JSONL audit log for admin operations.
 */
export interface AuditLog {
  /** Append an entry to the audit log. */
  append(entry: AuditEntry): Promise<void>;

  /** Read the last N entries. */
  tail(count: number): Promise<readonly AuditEntry[]>;

  /** The file path of the audit log. */
  readonly path: string;
}

/**
 * Create an append-only JSONL audit log at the given file path.
 * Creates parent directories if they do not exist.
 */
export function createAuditLog(filePath: string): AuditLog {
  let dirEnsured = false;

  async function ensureDir(): Promise<void> {
    if (!dirEnsured) {
      await mkdir(dirname(filePath), { recursive: true });
      dirEnsured = true;
    }
  }

  return {
    get path(): string {
      return filePath;
    },

    async append(entry: AuditEntry): Promise<void> {
      await ensureDir();
      const line = JSON.stringify(entry) + "\n";
      await appendFile(filePath, line, "utf-8");
    },

    async tail(count: number): Promise<readonly AuditEntry[]> {
      let content: string;
      try {
        content = await readFile(filePath, "utf-8");
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return [];
        }
        throw error;
      }

      const lines = content.trim().split("\n").filter(Boolean);
      const start = Math.max(0, lines.length - count);
      return lines.slice(start).map((line) => JSON.parse(line) as AuditEntry);
    },
  };
}
