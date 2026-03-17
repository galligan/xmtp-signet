import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, rm, readFile } from "node:fs/promises";
import { createPidFile } from "../daemon/pid.js";

describe("PidFile", () => {
  let testDir: string;
  let pidPath: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `xmtp-broker-test-pid-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(testDir, { recursive: true });
    pidPath = join(testDir, "broker.pid");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("write creates file with PID as decimal string", async () => {
    const pid = createPidFile(pidPath);
    const result = await pid.write(12345);
    expect(result.isOk()).toBe(true);

    const content = await readFile(pidPath, "utf-8");
    expect(content.trim()).toBe("12345");
  });

  test("read returns pid from existing file", async () => {
    const pid = createPidFile(pidPath);
    await pid.write(12345);

    const result = await pid.read();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).not.toBeNull();
      expect(result.value?.pid).toBe(12345);
    }
  });

  test("read returns null for non-existent file", async () => {
    const pid = createPidFile(pidPath);
    const result = await pid.read();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBeNull();
    }
  });

  test("isAlive returns true for current process", async () => {
    const pid = createPidFile(pidPath);
    await pid.write(process.pid);

    const result = await pid.isAlive();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(true);
    }
  });

  test("isAlive returns false for non-existent PID", async () => {
    const pid = createPidFile(pidPath);
    // Use a very high PID that almost certainly does not exist
    await pid.write(4_000_000);

    const result = await pid.isAlive();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(false);
    }
  });

  test("isAlive returns false when no PID file exists", async () => {
    const pid = createPidFile(pidPath);
    const result = await pid.isAlive();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(false);
    }
  });

  test("cleanup removes the file", async () => {
    const pid = createPidFile(pidPath);
    await pid.write(12345);

    const result = await pid.cleanup();
    expect(result.isOk()).toBe(true);

    const exists = await Bun.file(pidPath).exists();
    expect(exists).toBe(false);
  });

  test("cleanup succeeds when file does not exist", async () => {
    const pid = createPidFile(pidPath);
    const result = await pid.cleanup();
    expect(result.isOk()).toBe(true);
  });

  test("creates parent directory if missing", async () => {
    const nestedPath = join(testDir, "nested", "deep", "broker.pid");
    const pid = createPidFile(nestedPath);

    const result = await pid.write(12345);
    expect(result.isOk()).toBe(true);

    const content = await readFile(nestedPath, "utf-8");
    expect(content.trim()).toBe("12345");
  });
});
