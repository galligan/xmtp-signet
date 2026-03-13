import { Database } from "bun:sqlite";
import { Result } from "better-result";
import { InternalError, NotFoundError } from "@xmtp-broker/schemas";

/** Represents a single agent identity managed by the broker. */
export interface AgentIdentity {
  readonly id: string;
  readonly inboxId: string | null;
  readonly groupId: string | null;
  readonly createdAt: string;
}

/** Row shape from SQLite. */
interface IdentityRow {
  id: string;
  inbox_id: string | null;
  group_id: string | null;
  created_at: string;
}

function rowToIdentity(row: IdentityRow): AgentIdentity {
  return {
    id: row.id,
    inboxId: row.inbox_id,
    groupId: row.group_id,
    createdAt: row.created_at,
  };
}

/** Generate a random 32-byte hex string for identity IDs. */
function generateId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * SQLite-backed persistent store for agent identity material.
 *
 * Each identity record tracks: a unique ID, optional XMTP inbox ID (set after
 * registration), optional group binding, and creation timestamp.
 */
export class SqliteIdentityStore {
  readonly #db: Database;

  constructor(dbPath: string) {
    this.#db = new Database(dbPath);
    this.#db.run("PRAGMA journal_mode = WAL");
    this.#db.run("PRAGMA foreign_keys = ON");
    this.#migrate();
  }

  #migrate(): void {
    this.#db.run(`
      CREATE TABLE IF NOT EXISTS identities (
        id TEXT PRIMARY KEY,
        inbox_id TEXT,
        group_id TEXT UNIQUE,
        created_at TEXT NOT NULL
      )
    `);
  }

  /** Create a new identity with fresh key material. */
  async create(
    groupId: string | null,
  ): Promise<Result<AgentIdentity, InternalError>> {
    const id = generateId();
    const createdAt = new Date().toISOString();

    try {
      this.#db
        .prepare(
          "INSERT INTO identities (id, inbox_id, group_id, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(id, null, groupId, createdAt);

      return Result.ok({
        id,
        inboxId: null,
        groupId,
        createdAt,
      });
    } catch (cause) {
      return Result.err(
        InternalError.create("Failed to create identity", {
          cause: String(cause),
        }),
      );
    }
  }

  /** Look up the identity for a given group. */
  async getByGroupId(groupId: string): Promise<AgentIdentity | null> {
    const row = this.#db
      .prepare("SELECT * FROM identities WHERE group_id = ?")
      .get(groupId) as IdentityRow | null;
    return row ? rowToIdentity(row) : null;
  }

  /** Look up an identity by its ID. */
  async getById(id: string): Promise<AgentIdentity | null> {
    const row = this.#db
      .prepare("SELECT * FROM identities WHERE id = ?")
      .get(id) as IdentityRow | null;
    return row ? rowToIdentity(row) : null;
  }

  /** List all identities. */
  async list(): Promise<readonly AgentIdentity[]> {
    const rows = this.#db
      .prepare("SELECT * FROM identities ORDER BY created_at ASC")
      .all() as IdentityRow[];
    return rows.map(rowToIdentity);
  }

  /** Update the inboxId after XMTP registration. */
  async setInboxId(
    id: string,
    inboxId: string,
  ): Promise<Result<AgentIdentity, NotFoundError>> {
    const existing = await this.getById(id);
    if (existing === null) {
      return Result.err(NotFoundError.create("identity", id));
    }

    this.#db
      .prepare("UPDATE identities SET inbox_id = ? WHERE id = ?")
      .run(inboxId, id);

    return Result.ok({
      ...existing,
      inboxId,
    });
  }

  /** Remove an identity and its associated data. */
  async remove(id: string): Promise<Result<void, NotFoundError>> {
    const existing = await this.getById(id);
    if (existing === null) {
      return Result.err(NotFoundError.create("identity", id));
    }

    this.#db.prepare("DELETE FROM identities WHERE id = ?").run(id);
    return Result.ok();
  }

  /** Close the database connection. */
  close(): void {
    this.#db.close();
  }
}
