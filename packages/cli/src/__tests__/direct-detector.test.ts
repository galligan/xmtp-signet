import { describe, test, expect, afterEach, beforeAll } from "bun:test";
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectMode } from "../direct/detector.js";
import type { ResolvedPaths } from "../config/paths.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testCounter = 0;
const TEST_DIR = join(tmpdir(), "xb-detect-test");

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

function testPaths(overrides?: Partial<ResolvedPaths>): ResolvedPaths {
  testCounter++;
  const base = join(TEST_DIR, `run-${Date.now()}-${testCounter}`);
  mkdirSync(base, { recursive: true });
  return {
    configFile: join(base, "config.toml"),
    dataDir: join(base, "data"),
    pidFile: join(base, "signet.pid"),
    adminSocket: join(base, "admin.sock"),
    auditLog: join(base, "audit.jsonl"),
    identityKeyFile: join(base, "vault.db"),
    ...overrides,
  };
}

const cleanupSockets: string[] = [];

afterEach(() => {
  for (const s of cleanupSockets) {
    try {
      if (existsSync(s)) unlinkSync(s);
    } catch {
      // ignore
    }
  }
  cleanupSockets.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("detectMode", () => {
  test("returns direct mode when no socket file exists", async () => {
    const paths = testPaths();
    const result = await detectMode(paths);

    expect(result.mode).toBe("direct");
    expect(result.socketPath).toBeUndefined();
  });

  test("returns direct mode when socket file exists but daemon is not responsive", async () => {
    const paths = testPaths();
    // Create a stale socket file (regular file, not a real socket)
    writeFileSync(paths.adminSocket, "stale");
    cleanupSockets.push(paths.adminSocket);

    const result = await detectMode(paths);

    expect(result.mode).toBe("direct");
    expect(result.socketPath).toBeUndefined();
  });

  test("does not delete non-socket files at the admin socket path", async () => {
    const paths = testPaths();
    // Create a regular file (not a socket) at the admin socket path
    writeFileSync(paths.adminSocket, "not-a-socket");
    cleanupSockets.push(paths.adminSocket);

    await detectMode(paths);

    // Regular files should NOT be cleaned up — only actual stale Unix sockets
    expect(existsSync(paths.adminSocket)).toBe(true);
  });

  test("returns daemon mode with socketPath when daemon is responsive", async () => {
    const paths = testPaths();
    cleanupSockets.push(paths.adminSocket);

    // Start a real Unix socket server to simulate a running daemon
    const server = Bun.listen({
      unix: paths.adminSocket,
      socket: {
        data() {},
        open() {},
        close() {},
        error() {},
      },
    });

    try {
      const result = await detectMode(paths);
      expect(result.mode).toBe("daemon");
      expect(result.socketPath).toBe(paths.adminSocket);
    } finally {
      server.stop();
    }
  });

  test("returns direct mode when socket path directory does not exist", async () => {
    const paths = testPaths({
      adminSocket: join(TEST_DIR, "nonexistent-dir", "admin.sock"),
    });

    const result = await detectMode(paths);

    expect(result.mode).toBe("direct");
    expect(result.socketPath).toBeUndefined();
  });
});
