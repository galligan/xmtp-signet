import { Database } from "bun:sqlite";
import { Result } from "better-result";
import { InternalError, NotFoundError } from "@xmtp/signet-schemas";
import { join } from "node:path";
import { chmodSync } from "node:fs";

/** Encrypted vault backed by bun:sqlite with AES-GCM encryption. */
export interface Vault {
  set(name: string, value: Uint8Array): Promise<Result<void, InternalError>>;
  get(name: string): Promise<Result<Uint8Array, NotFoundError | InternalError>>;
  delete(name: string): Promise<Result<void, NotFoundError>>;
  list(): readonly string[];
  close(): void;
}

/** AES-GCM IV length in bytes. */
const IV_BYTES = 12;

function asBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
}

/**
 * Get or create a random 256-bit vault encryption key.
 * For file-backed vaults, the key is stored in `<dataDir>/vault.key`.
 * For `:memory:` vaults (tests), an ephemeral random key is generated.
 */
async function getOrCreateVaultKey(dataDir: string): Promise<CryptoKey> {
  // In-memory vaults get an ephemeral key
  if (dataDir === ":memory:") {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
  }

  const keyPath = join(dataDir, "vault.key");
  const file = Bun.file(keyPath);

  if (await file.exists()) {
    const raw = new Uint8Array(await file.arrayBuffer());
    if (raw.byteLength !== 32) {
      throw new Error(
        `Vault key file has invalid length: expected 32 bytes, got ${raw.byteLength}`,
      );
    }
    return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
  }

  const raw = crypto.getRandomValues(new Uint8Array(32));
  await Bun.write(keyPath, raw);
  chmodSync(keyPath, 0o600);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encrypt(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    asBuffer(plaintext),
  );
  // Prepend IV to ciphertext
  const result = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), IV_BYTES);
  return result;
}

async function decrypt(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const iv = data.slice(0, IV_BYTES);
  const ciphertext = data.slice(IV_BYTES);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );
  return new Uint8Array(plaintext);
}

export async function createVault(
  dataDir: string,
): Promise<Result<Vault, InternalError>> {
  try {
    const dbPath = join(dataDir, "vault.db");
    const db = new Database(dbPath);
    db.run("PRAGMA journal_mode = WAL");
    db.run(`
      CREATE TABLE IF NOT EXISTS secrets (
        name TEXT PRIMARY KEY,
        encrypted_value BLOB NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Restrict vault database file permissions
    if (dataDir !== ":memory:") {
      chmodSync(dbPath, 0o600);
    }

    const encKey = await getOrCreateVaultKey(dataDir);

    const stmtGet = db.prepare<{ encrypted_value: Uint8Array }, [string]>(
      "SELECT encrypted_value FROM secrets WHERE name = ?",
    );

    const stmtUpsert = db.prepare<void, [string, Uint8Array]>(
      `INSERT INTO secrets (name, encrypted_value)
       VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET
         encrypted_value = excluded.encrypted_value,
         updated_at = datetime('now')`,
    );

    const stmtDelete = db.prepare<void, [string]>(
      "DELETE FROM secrets WHERE name = ?",
    );

    const stmtList = db.prepare<{ name: string }, []>(
      "SELECT name FROM secrets ORDER BY name",
    );

    const stmtExists = db.prepare<{ cnt: number }, [string]>(
      "SELECT COUNT(*) as cnt FROM secrets WHERE name = ?",
    );

    const vault: Vault = {
      async set(
        name: string,
        value: Uint8Array,
      ): Promise<Result<void, InternalError>> {
        try {
          const encrypted = await encrypt(encKey, value);
          stmtUpsert.run(name, encrypted);
          return Result.ok();
        } catch (e) {
          return Result.err(
            InternalError.create("Failed to set vault secret", {
              name,
              cause: String(e),
            }),
          );
        }
      },

      async get(
        name: string,
      ): Promise<Result<Uint8Array, NotFoundError | InternalError>> {
        try {
          const row = stmtGet.get(name);
          if (!row) {
            return Result.err(NotFoundError.create("VaultSecret", name));
          }
          const plaintext = await decrypt(encKey, row.encrypted_value);
          return Result.ok(plaintext);
        } catch (e) {
          return Result.err(
            InternalError.create("Failed to get vault secret", {
              name,
              cause: String(e),
            }),
          );
        }
      },

      async delete(name: string): Promise<Result<void, NotFoundError>> {
        const exists = stmtExists.get(name);
        if (!exists || exists.cnt === 0) {
          return Result.err(NotFoundError.create("VaultSecret", name));
        }
        stmtDelete.run(name);
        return Result.ok();
      },

      list(): readonly string[] {
        return stmtList.all().map((row) => row.name);
      },

      close(): void {
        db.close();
      },
    };

    return Result.ok(vault);
  } catch (e) {
    return Result.err(
      InternalError.create("Failed to create vault", {
        dataDir,
        cause: String(e),
      }),
    );
  }
}
