import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createBrokerRuntime } from "../runtime.js";
import { createProductionDeps } from "../start.js";
import { loadConfig } from "../config/loader.js";
import { resolvePaths } from "../config/paths.js";

async function createTempConfig(rootDir: string): Promise<{
  configPath: string;
  dataDir: string;
  socketPath: string;
}> {
  const wsPort = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Failed to allocate a test port"));
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });

  const dataDir = join(rootDir, "data");
  const socketPath = join(rootDir, "admin.sock");
  const auditLogPath = join(rootDir, "audit.jsonl");
  const configPath = join(rootDir, "config.toml");

  await writeFile(
    configPath,
    [
      "[broker]",
      `dataDir = "${dataDir}"`,
      "",
      "[ws]",
      `port = ${wsPort}`,
      "",
      "[admin]",
      `socketPath = "${socketPath}"`,
      "",
      "[logging]",
      `auditLogPath = "${auditLogPath}"`,
      "",
      "[keys]",
      'rootKeyPolicy = "open"',
      'operationalKeyPolicy = "open"',
      "",
    ].join("\n"),
  );

  return { configPath, dataDir, socketPath };
}

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  cleanupDirs.length = 0;
});

let testCounter = 0;

describe("empty-dir broker boot", () => {
  test("runtime starts from an empty dir without creating admin or operational keys", async () => {
    testCounter += 1;
    const rootDir = join(tmpdir(), `xbe-${Date.now()}-${testCounter}`);
    cleanupDirs.push(rootDir);
    await mkdir(rootDir, { recursive: true });

    const { configPath, dataDir, socketPath } = await createTempConfig(rootDir);
    const configResult = await loadConfig({ configPath });
    expect(configResult.isOk()).toBe(true);
    if (configResult.isErr()) {
      return;
    }

    const paths = resolvePaths(configResult.value);
    for (const dir of [
      paths.dataDir,
      dirname(paths.pidFile),
      dirname(paths.adminSocket),
      dirname(paths.auditLog),
    ]) {
      await mkdir(dir, { recursive: true });
    }

    const runtimeResult = await createBrokerRuntime(
      configResult.value,
      createProductionDeps(),
    );
    expect(runtimeResult.isOk()).toBe(true);
    if (runtimeResult.isErr()) {
      return;
    }

    const runtime = runtimeResult.value;

    try {
      const startResult = await runtime.start();
      expect(startResult.isOk()).toBe(true);

      const status = await runtime.status();
      expect(status.state).toBe("running");
      expect(["ready", "ready-local"]).toContain(status.coreState);
      expect(existsSync(socketPath)).toBe(true);

      expect(runtime.keyManager.admin.exists()).toBe(false);
      expect(runtime.keyManager.listOperationalKeys()).toHaveLength(0);

      expect(existsSync(dataDir)).toBe(true);
    } finally {
      await runtime.shutdown();
    }
  });
});
