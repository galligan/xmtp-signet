import type { Database } from "bun:sqlite";
import type {
  IdMappingStore,
  IdMappingResourceTypeType,
} from "@xmtp/signet-schemas";

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS id_mappings (
    network_id   TEXT PRIMARY KEY,
    local_id     TEXT NOT NULL UNIQUE,
    resource_type TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

const UPSERT = `
  INSERT INTO id_mappings (network_id, local_id, resource_type)
  VALUES (?1, ?2, ?3)
  ON CONFLICT (network_id) DO UPDATE SET
    local_id = excluded.local_id,
    resource_type = excluded.resource_type
`;

const GET_BY_NETWORK = `SELECT local_id FROM id_mappings WHERE network_id = ?1`;
const GET_BY_LOCAL = `SELECT network_id FROM id_mappings WHERE local_id = ?1`;
const RESOLVE_BY_NETWORK = `SELECT network_id, local_id FROM id_mappings WHERE network_id = ?1`;
const RESOLVE_BY_LOCAL = `SELECT network_id, local_id FROM id_mappings WHERE local_id = ?1`;

/**
 * Creates a SQLite-backed implementation of {@link IdMappingStore}.
 *
 * Stores bidirectional mappings between XMTP network IDs and local signet
 * resource IDs. Uses `bun:sqlite` for zero-dependency persistence.
 *
 * @param db - A bun:sqlite Database instance (in-memory or file-backed)
 */
export function createSqliteIdMappingStore(db: Database): IdMappingStore {
  db.run(CREATE_TABLE);

  const upsertStmt = db.prepare(UPSERT);
  const getByNetworkStmt = db.prepare<{ local_id: string }, [string]>(
    GET_BY_NETWORK,
  );
  const getByLocalStmt = db.prepare<{ network_id: string }, [string]>(
    GET_BY_LOCAL,
  );
  const resolveByNetworkStmt = db.prepare<
    { network_id: string; local_id: string },
    [string]
  >(RESOLVE_BY_NETWORK);
  const resolveByLocalStmt = db.prepare<
    { network_id: string; local_id: string },
    [string]
  >(RESOLVE_BY_LOCAL);

  return {
    set(
      networkId: string,
      localId: string,
      _resourceType: IdMappingResourceTypeType,
    ): void {
      upsertStmt.run(networkId, localId, _resourceType);
    },

    getLocal(networkId: string): string | null {
      const row = getByNetworkStmt.get(networkId);
      return row?.local_id ?? null;
    },

    getNetwork(localId: string): string | null {
      const row = getByLocalStmt.get(localId);
      return row?.network_id ?? null;
    },

    resolve(id: string): { networkId: string; localId: string } | null {
      // Try network ID first (xmtp_ prefix is the common lookup path)
      const byNetwork = resolveByNetworkStmt.get(id);
      if (byNetwork) {
        return { networkId: byNetwork.network_id, localId: byNetwork.local_id };
      }

      // Fall back to local ID lookup
      const byLocal = resolveByLocalStmt.get(id);
      if (byLocal) {
        return { networkId: byLocal.network_id, localId: byLocal.local_id };
      }

      return null;
    },
  };
}
