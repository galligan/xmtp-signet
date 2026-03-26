import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Result } from "better-result";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createOperatorStorageManager,
  type OperatorStorageManager,
} from "../operator-storage.js";

describe("OperatorStorageManager", () => {
  let baseDir: string;
  let manager: OperatorStorageManager;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "signet-op-storage-"));
    const result = createOperatorStorageManager(baseDir);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error("setup failed");
    manager = result.value;
  });

  afterEach(() => {
    manager.close();
    rmSync(baseDir, { recursive: true, force: true });
  });

  test("creates isolated data directory per operator", () => {
    const partA = manager.getPartition("op_aaaa111122223333");
    const partB = manager.getPartition("op_bbbb444455556666");

    expect(Result.isOk(partA)).toBe(true);
    expect(Result.isOk(partB)).toBe(true);

    if (Result.isError(partA) || Result.isError(partB)) throw new Error("fail");

    expect(partA.value.dataDir).not.toBe(partB.value.dataDir);
    expect(partA.value.dataDir).toContain("op_aaaa111122223333");
    expect(partB.value.dataDir).toContain("op_bbbb444455556666");

    // Directories exist on disk
    expect(existsSync(partA.value.dataDir)).toBe(true);
    expect(existsSync(partB.value.dataDir)).toBe(true);
  });

  test("returns same partition for same operator ID (cached)", () => {
    const part1 = manager.getPartition("op_aaaa111122223333");
    const part2 = manager.getPartition("op_aaaa111122223333");

    expect(Result.isOk(part1)).toBe(true);
    expect(Result.isOk(part2)).toBe(true);

    if (Result.isError(part1) || Result.isError(part2)) throw new Error("fail");

    expect(part1.value.idMappings).toBe(part2.value.idMappings);
  });

  test("each partition has its own isolated ID mapping store", () => {
    const partA = manager.getPartition("op_aaaa111122223333");
    const partB = manager.getPartition("op_bbbb444455556666");

    if (Result.isError(partA) || Result.isError(partB)) throw new Error("fail");

    // Store a mapping in A
    partA.value.idMappings.set(
      "xmtp_aaa11111feedbabe",
      "msg_1234567890abcdef",
      "message",
    );

    // A can resolve it
    expect(partA.value.idMappings.getLocal("xmtp_aaa11111feedbabe")).toBe(
      "msg_1234567890abcdef",
    );

    // B cannot see it (separate database)
    expect(partB.value.idMappings.getLocal("xmtp_aaa11111feedbabe")).toBeNull();
  });

  test("lists active operator partitions", () => {
    manager.getPartition("op_aaaa111122223333");
    manager.getPartition("op_bbbb444455556666");

    const operators = manager.listOperators();
    expect(operators).toContain("op_aaaa111122223333");
    expect(operators).toContain("op_bbbb444455556666");
    expect(operators).toHaveLength(2);
  });

  test("creates operators/ subdirectory structure", () => {
    manager.getPartition("op_aaaa111122223333");

    expect(existsSync(join(baseDir, "operators"))).toBe(true);
    expect(existsSync(join(baseDir, "operators", "op_aaaa111122223333"))).toBe(
      true,
    );
    expect(
      existsSync(
        join(baseDir, "operators", "op_aaaa111122223333", "mappings.db"),
      ),
    ).toBe(true);
  });

  test("rejects invalid operator IDs (path traversal prevention)", () => {
    const bad1 = manager.getPartition("../escape");
    expect(Result.isError(bad1)).toBe(true);

    const bad2 = manager.getPartition("not-an-operator-id");
    expect(Result.isError(bad2)).toBe(true);

    const bad3 = manager.getPartition("");
    expect(Result.isError(bad3)).toBe(true);

    const bad4 = manager.getPartition("op_../../etc/passwd");
    expect(Result.isError(bad4)).toBe(true);
  });

  test("dataDir can be used as vault root for per-operator encryption", () => {
    // This test documents the composition pattern: callers pass
    // partition.dataDir to createVault() to get per-operator encryption.
    // We don't test vault here (that's in @xmtp/signet-keys) — we just
    // verify the directory is suitable as a vault root.
    const part = manager.getPartition("op_aaaa111122223333");
    if (Result.isError(part)) throw new Error("fail");

    const dataDir = part.value.dataDir;
    expect(existsSync(dataDir)).toBe(true);
    // The directory should be operator-scoped, not shared
    expect(dataDir).toContain("op_aaaa111122223333");
    expect(dataDir).not.toContain("op_bbbb");
  });
});
