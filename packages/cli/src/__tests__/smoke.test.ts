import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";

const repoRoot = resolve(import.meta.dir, "../../../..");
const tempDirs: string[] = [];
const backgroundProcesses: Bun.Subprocess[] = [];

afterEach(async () => {
  await Promise.all(
    backgroundProcesses.splice(0).map(async (process) => {
      try {
        process.kill("SIGTERM");
      } catch {}
      try {
        await process.exited;
      } catch {}
    }),
  );

  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      rm(dir, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

function randomPort(): number {
  return 35000 + Math.floor(Math.random() * 10000);
}

async function makeWorkspace(): Promise<{
  dir: string;
  configPath: string;
  wsPort: number;
  adminSocket: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "xmtp-broker-smoke-"));
  tempDirs.push(dir);

  const wsPort = randomPort();
  const dataDir = join(dir, "data");
  const adminSocket = join(dir, "admin.sock");
  const auditLog = join(dir, "audit.jsonl");
  const configPath = join(dir, "broker.toml");

  await writeFile(
    configPath,
    [
      "[broker]",
      `env = "local"`,
      `dataDir = "${dataDir}"`,
      "",
      "[keys]",
      `rootKeyPolicy = "open"`,
      `operationalKeyPolicy = "open"`,
      "",
      "[ws]",
      `host = "127.0.0.1"`,
      `port = ${wsPort}`,
      "",
      "[admin]",
      `socketPath = "${adminSocket}"`,
      "",
      "[logging]",
      `auditLogPath = "${auditLog}"`,
      "",
    ].join("\n"),
  );

  return { dir, configPath, wsPort, adminSocket };
}

async function runCli(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const process = Bun.spawn(["bun", "packages/cli/src/bin.ts", ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);

  return { exitCode, stdout, stderr };
}

function startDaemon(args: string[]): Bun.Subprocess {
  const process = Bun.spawn(["bun", "packages/cli/src/bin.ts", ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  backgroundProcesses.push(process);
  return process;
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await Bun.sleep(50);
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

async function waitForHealthyStart(
  process: Bun.Subprocess,
  adminSocket: string,
): Promise<void> {
  await waitFor(async () => existsSync(adminSocket));

  const state = await Promise.race([
    process.exited.then((exitCode) => ({ exited: true as const, exitCode })),
    Bun.sleep(250).then(() => ({ exited: false as const, exitCode: null })),
  ]);

  if (state.exited) {
    const [stdout, stderr] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    throw new Error(
      `Daemon exited early (${state.exitCode})\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
}

async function waitForOpen(ws: WebSocket, timeoutMs = 5000): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for WebSocket open")),
      timeoutMs,
    );
    const onOpen = () => {
      clearTimeout(timer);
      ws.removeEventListener("open", onOpen);
      resolve();
    };
    ws.addEventListener("open", onOpen);
  });
}

async function nextMessage(ws: WebSocket, timeoutMs = 5000): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for WebSocket message")),
      timeoutMs,
    );
    const onMessage = (event: MessageEvent) => {
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      resolve(JSON.parse(String(event.data)));
    };
    ws.addEventListener("message", onMessage);
  });
}

describe("Phase 2B smoke tests", () => {
  test("broker start boots from an empty directory without creating admin credentials", async () => {
    const workspace = await makeWorkspace();
    const daemon = startDaemon([
      "broker",
      "start",
      "--config",
      workspace.configPath,
      "--json",
    ]);

    await waitForHealthyStart(daemon, workspace.adminSocket);

    const tokenResult = await runCli([
      "admin",
      "token",
      "--config",
      workspace.configPath,
      "--json",
    ]);

    expect(tokenResult.exitCode).not.toBe(0);
    expect(tokenResult.stderr).toContain("No admin key found");

    daemon.kill("SIGTERM");
    expect(await daemon.exited).toBe(0);
  });

  test("credentialed daemon flow issues a session, authenticates over WS, routes deny/allow requests, binds heartbeat to the authenticated session, and stops cleanly", async () => {
    const workspace = await makeWorkspace();
    const viewPath = join(workspace.dir, "view.json");
    const grantPath = join(workspace.dir, "grant.json");

    await writeFile(
      viewPath,
      JSON.stringify({
        mode: "full",
        threadScopes: [{ groupId: "group-1", threadId: null }],
        contentTypes: ["xmtp.org/text:1.0"],
      }),
    );
    await writeFile(
      grantPath,
      JSON.stringify({
        messaging: {
          send: true,
          reply: false,
          react: false,
          draftOnly: false,
        },
        groupManagement: {
          addMembers: false,
          removeMembers: false,
          updateMetadata: false,
          inviteUsers: false,
        },
        tools: { scopes: [] },
        egress: {
          storeExcerpts: false,
          useForMemory: false,
          forwardToProviders: false,
          quoteRevealed: false,
          summarize: false,
        },
      }),
    );

    const initResult = await runCli([
      "identity",
      "init",
      "--config",
      workspace.configPath,
      "--json",
    ]);
    expect(initResult.exitCode).toBe(0);

    const daemon = startDaemon([
      "broker",
      "start",
      "--config",
      workspace.configPath,
      "--json",
    ]);
    await waitForHealthyStart(daemon, workspace.adminSocket);

    const statusResult = await runCli([
      "broker",
      "status",
      "--config",
      workspace.configPath,
      "--json",
    ]);
    expect(statusResult.exitCode).toBe(0);
    expect(JSON.parse(statusResult.stdout)).toMatchObject({
      state: "running",
    });

    const issueResult = await runCli([
      "session",
      "issue",
      "--config",
      workspace.configPath,
      "--agent",
      "agent-test",
      "--view",
      `@${viewPath}`,
      "--grant",
      `@${grantPath}`,
      "--json",
    ]);
    expect(issueResult.exitCode).toBe(0);

    const issuedSession = JSON.parse(issueResult.stdout) as {
      token: string;
      session: { sessionId: string };
    };
    expect(issuedSession.token).toBeTruthy();

    const ws = new WebSocket(`ws://127.0.0.1:${workspace.wsPort}/v1/agent`);
    await waitForOpen(ws);
    ws.send(
      JSON.stringify({
        type: "auth",
        token: issuedSession.token,
        lastSeenSeq: null,
      }),
    );

    const authenticated = (await nextMessage(ws)) as Record<string, unknown>;
    expect(authenticated["type"]).toBe("authenticated");

    ws.send(
      JSON.stringify({
        type: "send_message",
        requestId: "req-deny",
        groupId: "group-1",
        contentType: "xmtp.org/reaction:1.0",
        content: { emoji: ":+1:" },
      }),
    );

    const denied = (await nextMessage(ws)) as Record<string, unknown>;
    expect(denied["ok"]).toBe(false);
    expect((denied["error"] as Record<string, unknown>)["category"]).toBe(
      "permission",
    );

    ws.send(
      JSON.stringify({
        type: "send_message",
        requestId: "req-allow",
        groupId: "group-1",
        contentType: "xmtp.org/text:1.0",
        content: { text: "hello from smoke" },
      }),
    );

    const allowed = (await nextMessage(ws)) as Record<string, unknown>;
    expect(allowed["requestId"]).toBe("req-allow");
    if (allowed["ok"] === true) {
      expect(allowed["data"]).toBeTruthy();
    } else {
      expect(["not_found", "internal"]).toContain(
        (allowed["error"] as Record<string, unknown>)["category"],
      );
    }

    ws.send(
      JSON.stringify({
        type: "heartbeat",
        requestId: "req-heartbeat-spoofed",
        sessionId: "spoofed-session",
      }),
    );

    const spoofedHeartbeat = (await nextMessage(ws)) as Record<string, unknown>;
    expect(spoofedHeartbeat["ok"]).toBe(false);
    expect(
      (spoofedHeartbeat["error"] as Record<string, unknown>)["category"],
    ).toBe("auth");

    ws.send(
      JSON.stringify({
        type: "heartbeat",
        requestId: "req-heartbeat",
        sessionId: issuedSession.session.sessionId,
      }),
    );

    const heartbeat = (await nextMessage(ws)) as Record<string, unknown>;
    expect(heartbeat["ok"]).toBe(true);

    ws.close();

    const stopResult = await runCli([
      "broker",
      "stop",
      "--config",
      workspace.configPath,
      "--json",
    ]);
    expect(stopResult.exitCode).toBe(0);
    expect(JSON.parse(stopResult.stdout)).toEqual({ stopped: true });
    expect(await daemon.exited).toBe(0);
  }, 20_000);
});
