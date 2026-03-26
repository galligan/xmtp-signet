import { Result } from "better-result";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { mkdirSync, existsSync, chmodSync } from "node:fs";
import { InternalError, OperatorId } from "@xmtp/signet-schemas";
import type { IdMappingStore } from "@xmtp/signet-schemas";
import { createSqliteIdMappingStore } from "./id-mapping-store.js";

/**
 * An isolated storage partition for a single operator.
 *
 * Each partition has its own:
 * - Data directory
 * - ID mapping store (separate SQLite database per operator)
 */
export interface OperatorPartition {
  /** The operator ID this partition belongs to. */
  readonly operatorId: string;
  /** The operator's isolated data directory. */
  readonly dataDir: string;
  /** Network ID <-> local ID mapping store scoped to this operator. */
  readonly idMappings: IdMappingStore;
}

/**
 * Manages per-operator encrypted storage partitions.
 *
 * Each operator gets its own subdirectory under the base data directory
 * with a separate ID mapping store (separate SQLite database). The vault
 * layer is composed externally — callers use the operator's `dataDir` as
 * the vault root to get per-operator encryption keys.
 *
 * This provides storage isolation at the filesystem layer. When combined
 * with the vault (which creates a separate encryption key per data
 * directory), each operator's data is cryptographically isolated.
 */
export interface OperatorStorageManager {
  /** Get or create an isolated storage partition for an operator. */
  getPartition(operatorId: string): Result<OperatorPartition, InternalError>;

  /** List operator IDs with active partitions. */
  listOperators(): readonly string[];

  /** Release all held resources. */
  close(): void;
}

/**
 * Create an operator storage manager rooted at the given base directory.
 *
 * Directory structure:
 * ```
 * baseDir/
 *   operators/
 *     op_aaaa111122223333/
 *       mappings.db
 *     op_bbbb444455556666/
 *       mappings.db
 * ```
 *
 * Callers compose vault access by passing `partition.dataDir` to
 * `createVault()` from `@xmtp/signet-keys`.
 */
export function createOperatorStorageManager(
  baseDir: string,
): Result<OperatorStorageManager, InternalError> {
  try {
    const operatorsDir = join(baseDir, "operators");
    if (!existsSync(operatorsDir)) {
      mkdirSync(operatorsDir, { recursive: true });
      chmodSync(operatorsDir, 0o700);
    }

    const partitions = new Map<string, OperatorPartition>();
    const databases: Database[] = [];

    return Result.ok({
      getPartition(
        operatorId: string,
      ): Result<OperatorPartition, InternalError> {
        const existing = partitions.get(operatorId);
        if (existing) return Result.ok(existing);

        // Validate operator ID format to prevent path traversal
        const parsed = OperatorId.safeParse(operatorId);
        if (!parsed.success) {
          return Result.err(
            InternalError.create(`Invalid operator ID: ${operatorId}`, {
              cause: "Must match op_<16hex> format",
            }),
          );
        }

        try {
          const opDir = join(operatorsDir, operatorId);
          if (!existsSync(opDir)) {
            mkdirSync(opDir, { recursive: true });
            chmodSync(opDir, 0o700);
          }

          const dbPath = join(opDir, "mappings.db");
          const db = new Database(dbPath);
          databases.push(db);
          const idMappings = createSqliteIdMappingStore(db);

          const partition: OperatorPartition = {
            operatorId,
            dataDir: opDir,
            idMappings,
          };

          partitions.set(operatorId, partition);
          return Result.ok(partition);
        } catch (e) {
          return Result.err(
            InternalError.create(
              `Failed to create storage partition for operator ${operatorId}`,
              { cause: String(e) },
            ),
          );
        }
      },

      listOperators(): readonly string[] {
        return [...partitions.keys()].sort();
      },

      close(): void {
        for (const db of databases) {
          db.close();
        }
        partitions.clear();
        databases.length = 0;
      },
    });
  } catch (e) {
    return Result.err(
      InternalError.create("Failed to create operator storage manager", {
        cause: String(e),
      }),
    );
  }
}
