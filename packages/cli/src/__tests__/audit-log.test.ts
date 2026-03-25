import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, rm, readFile } from "node:fs/promises";
import { createAuditLog, type AuditEntry } from "../audit/log.js";

function makeTempDir(): string {
  return join(
    tmpdir(),
    `audit-log-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

function makeEntry(overrides?: Partial<AuditEntry>): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    action: "credential.issue",
    actor: "admin",
    success: true,
    ...overrides,
  };
}

describe("AuditLog", () => {
  let tempDir: string;
  let logPath: string;

  beforeEach(async () => {
    tempDir = makeTempDir();
    await mkdir(tempDir, { recursive: true });
    logPath = join(tempDir, "audit.jsonl");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("append writes a JSONL line", async () => {
    const log = createAuditLog(logPath);
    const entry = makeEntry();

    await log.append(entry);

    const content = await readFile(logPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] as string) as AuditEntry;
    expect(parsed.action).toBe("credential.issue");
    expect(parsed.actor).toBe("admin");
    expect(parsed.success).toBe(true);
  });

  test("multiple appends produce multiple lines", async () => {
    const log = createAuditLog(logPath);

    await log.append(makeEntry({ action: "credential.issue" }));
    await log.append(makeEntry({ action: "credential.revoke" }));
    await log.append(makeEntry({ action: "key.rotate" }));

    const content = await readFile(logPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(3);
  });

  test("tail returns last N entries", async () => {
    const log = createAuditLog(logPath);

    await log.append(makeEntry({ action: "first" }));
    await log.append(makeEntry({ action: "second" }));
    await log.append(makeEntry({ action: "third" }));

    const entries = await log.tail(2);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.action).toBe("second");
    expect(entries[1]?.action).toBe("third");
  });

  test("tail on empty log returns empty array", async () => {
    const log = createAuditLog(logPath);
    const entries = await log.tail(10);
    expect(entries).toHaveLength(0);
  });

  test("creates parent directory if missing", async () => {
    const nestedPath = join(tempDir, "nested", "deep", "audit.jsonl");
    const log = createAuditLog(nestedPath);

    await log.append(makeEntry());

    const content = await readFile(nestedPath, "utf-8");
    expect(content.trim()).not.toBe("");
  });

  test("append includes optional target and detail fields", async () => {
    const log = createAuditLog(logPath);
    const entry = makeEntry({
      action: "credential.revoke",
      target: "cred_abc12345feedbabe",
      detail: { reason: "policy-change" },
    });

    await log.append(entry);

    const content = await readFile(logPath, "utf-8");
    const parsed = JSON.parse(content.trim()) as AuditEntry;
    expect(parsed.target).toBe("cred_abc12345feedbabe");
    expect(parsed.detail).toEqual({ reason: "policy-change" });
  });

  test("path property returns the file path", () => {
    const log = createAuditLog(logPath);
    expect(log.path).toBe(logPath);
  });
});
