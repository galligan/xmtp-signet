import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Result } from "better-result";
import { SqliteIdentityStore } from "../identity-store.js";

let store: SqliteIdentityStore;

beforeEach(() => {
  // In-memory SQLite for test isolation
  store = new SqliteIdentityStore(":memory:");
});

describe("SqliteIdentityStore", () => {
  describe("create", () => {
    test("creates identity with null groupId for shared mode", async () => {
      const result = await store.create(null);
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const identity = result.value;
      expect(identity.id).toMatch(/^inbox_[a-f0-9]{16}$/);
      expect(identity.inboxId).toBeNull();
      expect(identity.groupId).toBeNull();
      expect(identity.createdAt).toBeTruthy();
    });

    test("creates identity bound to a groupId", async () => {
      const result = await store.create("group-abc");
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      expect(result.value.groupId).toBe("group-abc");
    });

    test("generates unique IDs", async () => {
      const r1 = await store.create(null);
      const r2 = await store.create(null);
      expect(r1.isOk()).toBe(true);
      expect(r2.isOk()).toBe(true);
      if (!r1.isOk() || !r2.isOk()) return;

      expect(r1.value.id).not.toBe(r2.value.id);
    });
  });

  describe("getById", () => {
    test("returns identity by id", async () => {
      const created = await store.create("group-1");
      if (!created.isOk()) return;

      const found = await store.getById(created.value.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.value.id);
      expect(found?.groupId).toBe("group-1");
    });

    test("returns null for unknown id", async () => {
      const found = await store.getById("nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("getByGroupId", () => {
    test("returns identity bound to group", async () => {
      const created = await store.create("group-xyz");
      if (!created.isOk()) return;

      const found = await store.getByGroupId("group-xyz");
      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.value.id);
    });

    test("returns null for unknown group", async () => {
      const found = await store.getByGroupId("no-such-group");
      expect(found).toBeNull();
    });
  });

  describe("list", () => {
    test("returns empty array when no identities", async () => {
      const list = await store.list();
      expect(list).toHaveLength(0);
    });

    test("returns all identities", async () => {
      await store.create("group-1");
      await store.create("group-2");
      await store.create(null);

      const list = await store.list();
      expect(list).toHaveLength(3);
    });
  });

  describe("setInboxId", () => {
    test("updates inboxId on existing identity", async () => {
      const created = await store.create("group-1");
      if (!created.isOk()) return;

      const result = await store.setInboxId(created.value.id, "inbox-123");
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      expect(result.value.inboxId).toBe("inbox-123");

      // Verify persisted
      const found = await store.getById(created.value.id);
      expect(found?.inboxId).toBe("inbox-123");
    });

    test("returns NotFoundError for unknown id", async () => {
      const result = await store.setInboxId("nonexistent", "inbox-1");
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error._tag).toBe("NotFoundError");
    });

    test("rejects duplicate non-null inbox IDs", async () => {
      const first = await store.create("group-1");
      const second = await store.create("group-2");
      expect(first.isOk()).toBe(true);
      expect(second.isOk()).toBe(true);
      if (!first.isOk() || !second.isOk()) return;

      const initial = await store.setInboxId(first.value.id, "inbox-1");
      expect(initial.isOk()).toBe(true);

      const duplicate = await store.setInboxId(second.value.id, "inbox-1");
      expect(Result.isError(duplicate)).toBe(true);
      if (!Result.isError(duplicate)) return;
      expect(duplicate.error._tag).toBe("InternalError");
    });
  });

  describe("migration", () => {
    let tempDir: string;
    let dbPath: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "signet-identity-migration-"));
      dbPath = join(tempDir, "identities.db");
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    test("warns and skips unique index when pre-existing duplicate inbox_ids exist", () => {
      // Seed the database with duplicate inbox_id rows before migration runs.
      const seed = new Database(dbPath);
      seed.run(`
        CREATE TABLE identities (
          id TEXT PRIMARY KEY,
          inbox_id TEXT,
          group_id TEXT UNIQUE,
          label TEXT UNIQUE,
          created_at TEXT NOT NULL
        )
      `);
      const insert = seed.prepare(
        "INSERT INTO identities (id, inbox_id, group_id, label, created_at) VALUES (?, ?, ?, ?, ?)",
      );
      insert.run("inbox_a", "dup-inbox", "group-a", "label-a", "2025-01-01");
      insert.run("inbox_b", "dup-inbox", "group-b", "label-b", "2025-01-02");
      seed.close();

      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const migratedStore = new SqliteIdentityStore(dbPath);
        try {
          expect(warnSpy).toHaveBeenCalledTimes(1);
          const [message, payload] = warnSpy.mock.calls[0] ?? [];
          expect(String(message)).toContain("inbox_id");
          expect(String(message)).toContain("skipped");
          expect(String(message)).toContain("Clean up duplicates");
          expect(payload).toMatchObject({
            duplicateInboxIdCount: 1,
            indexSkipped: "idx_identities_inbox_id",
          });
        } finally {
          migratedStore.close();
        }
      } finally {
        warnSpy.mockRestore();
      }
    });

    test("does not warn when no duplicate inbox_ids exist", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const freshStore = new SqliteIdentityStore(dbPath);
        try {
          expect(warnSpy).not.toHaveBeenCalled();
        } finally {
          freshStore.close();
        }
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe("remove", () => {
    test("removes existing identity", async () => {
      const created = await store.create("group-1");
      if (!created.isOk()) return;

      const result = await store.remove(created.value.id);
      expect(result.isOk()).toBe(true);

      const found = await store.getById(created.value.id);
      expect(found).toBeNull();
    });

    test("returns NotFoundError for unknown id", async () => {
      const result = await store.remove("nonexistent");
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error._tag).toBe("NotFoundError");
    });
  });
});
