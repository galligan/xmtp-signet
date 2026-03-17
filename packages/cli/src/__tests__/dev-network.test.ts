/**
 * Dev network smoke tests.
 *
 * These tests hit the real XMTP dev network and are excluded from default
 * test runs. Set XMTP_NETWORK_TESTS=1 to enable them.
 *
 * Each test creates an isolated temp directory with its own config, keys,
 * and data. Tests are sequential since they share no state.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../..");
const CLI = "packages/cli/src/bin.ts";

const tempDirs: string[] = [];
const backgroundProcesses: Bun.Subprocess[] = [];

afterEach(async () => {
  await Promise.all(
    backgroundProcesses.splice(0).map(async (proc) => {
      try {
        proc.kill("SIGTERM");
      } catch {
        /* already exited */
      }
      try {
        await proc.exited;
      } catch {
        /* ignore */
      }
    }),
  );

  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `xmtp-devnet-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

function writeConfig(dir: string): string {
  const configPath = join(dir, "config.toml");
  const dataDir = join(dir, "data");
  const adminSocket = join(dir, "admin.sock");
  const auditLog = join(dir, "audit.jsonl");

  writeFileSync(
    configPath,
    [
      "[signet]",
      'env = "dev"',
      `dataDir = "${dataDir}"`,
      "",
      "[keys]",
      'rootKeyPolicy = "open"',
      'operationalKeyPolicy = "open"',
      "",
      "[ws]",
      'host = "127.0.0.1"',
      "port = 0",
      "",
      "[admin]",
      `socketPath = "${adminSocket}"`,
      "",
      "[logging]",
      `auditLogPath = "${auditLog}"`,
      "",
    ].join("\n"),
  );

  return configPath;
}

async function runCli(
  args: string[],
  timeoutMs = 60_000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  const result = await Promise.race([
    Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]).then(([exitCode, stdout, stderr]) => ({ exitCode, stdout, stderr })),
    Bun.sleep(timeoutMs).then(() => {
      proc.kill("SIGKILL");
      return {
        exitCode: -1,
        stdout: "",
        stderr: `CLI command timed out after ${timeoutMs}ms`,
      };
    }),
  ]);

  return result;
}

function startDaemon(configPath: string): Bun.Subprocess {
  const proc = Bun.spawn(
    ["bun", CLI, "start", "--config", configPath, "--json"],
    {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  backgroundProcesses.push(proc);
  return proc;
}

async function waitForDaemonReady(
  configPath: string,
  daemon: Bun.Subprocess,
  timeoutMs = 60_000,
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    // Check if daemon crashed
    const exited = await Promise.race([
      daemon.exited.then((code) => ({ exited: true as const, code })),
      Bun.sleep(100).then(() => ({ exited: false as const, code: null })),
    ]);

    if (exited.exited) {
      const [stdout, stderr] = await Promise.all([
        new Response(daemon.stdout).text(),
        new Response(daemon.stderr).text(),
      ]);
      throw new Error(
        `Daemon exited early (code ${exited.code})\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      );
    }

    // Try status
    const status = await runCli(
      ["status", "--config", configPath, "--json"],
      5_000,
    );

    if (status.exitCode === 0) {
      try {
        const parsed = JSON.parse(status.stdout) as Record<string, unknown>;
        if (parsed["state"] === "running") {
          return;
        }
      } catch {
        /* not valid JSON yet, keep polling */
      }
    }

    await Bun.sleep(500);
  }

  throw new Error(`Daemon did not become ready within ${timeoutMs}ms`);
}

async function stopDaemon(configPath: string): Promise<void> {
  const result = await runCli(
    ["stop", "--config", configPath, "--json"],
    10_000,
  );
  if (result.exitCode !== 0) {
    // Best-effort stop; daemon may have already exited
    console.warn(`stop exited with ${result.exitCode}: ${result.stderr}`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!process.env["XMTP_NETWORK_TESTS"])(
  "dev network smoke",
  () => {
    test("identity init registers with devnet", async () => {
      const dir = makeTestDir("init");
      const configPath = writeConfig(dir);

      const result = await runCli([
        "identity",
        "init",
        "--env",
        "dev",
        "--label",
        "test-alice",
        "--config",
        configPath,
        "--json",
      ]);

      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(output["initialized"]).toBe(true);
      expect(typeof output["inboxId"]).toBe("string");
      expect((output["inboxId"] as string).length).toBeGreaterThan(0);
      expect(typeof output["address"]).toBe("string");
      expect((output["address"] as string).startsWith("0x")).toBe(true);
      expect(output["env"]).toBe("dev");
      expect(output["label"]).toBe("test-alice");
    });

    test("two identities get distinct inbox IDs", async () => {
      const dir = makeTestDir("dual");
      const configPath = writeConfig(dir);

      const alice = await runCli([
        "identity",
        "init",
        "--env",
        "dev",
        "--label",
        "alice",
        "--config",
        configPath,
        "--json",
      ]);
      expect(alice.exitCode).toBe(0);
      const aliceOutput = JSON.parse(alice.stdout) as Record<string, unknown>;

      const bob = await runCli([
        "identity",
        "init",
        "--env",
        "dev",
        "--label",
        "bob",
        "--config",
        configPath,
        "--json",
      ]);
      expect(bob.exitCode).toBe(0);
      const bobOutput = JSON.parse(bob.stdout) as Record<string, unknown>;

      expect(typeof aliceOutput["inboxId"]).toBe("string");
      expect(typeof bobOutput["inboxId"]).toBe("string");
      expect(aliceOutput["inboxId"]).not.toBe(bobOutput["inboxId"]);
    });

    test("start connects identities to network", async () => {
      const dir = makeTestDir("signet");
      const configPath = writeConfig(dir);

      // Init two identities
      const alice = await runCli([
        "identity",
        "init",
        "--env",
        "dev",
        "--label",
        "alice",
        "--config",
        configPath,
        "--json",
      ]);
      expect(alice.exitCode).toBe(0);

      const bob = await runCli([
        "identity",
        "init",
        "--env",
        "dev",
        "--label",
        "bob",
        "--config",
        configPath,
        "--json",
      ]);
      expect(bob.exitCode).toBe(0);

      // Start daemon
      const daemon = startDaemon(configPath);
      await waitForDaemonReady(configPath, daemon);

      // Check status
      const status = await runCli(["status", "--config", configPath, "--json"]);
      expect(status.exitCode).toBe(0);

      const statusOutput = JSON.parse(status.stdout) as Record<string, unknown>;
      expect(statusOutput["state"]).toBe("running");

      // The signet should report network connectivity when env is dev
      // Accept both "connected" and presence of networkState field
      expect(statusOutput).toHaveProperty("networkState");

      // Stop cleanly
      await stopDaemon(configPath);

      const exitCode = await Promise.race([
        daemon.exited,
        Bun.sleep(10_000).then(() => -1),
      ]);
      expect(exitCode).toBe(0);
    });
  },
  { timeout: 120_000 },
);
