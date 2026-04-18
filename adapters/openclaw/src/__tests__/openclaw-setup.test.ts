import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Result } from "better-result";
import type { AdminClient, CliConfig, ResolvedPaths } from "@xmtp/signet-cli";
import type {
  OperatorRecordType,
  PolicyRecordType,
} from "@xmtp/signet-schemas";
import { runOpenClawSetup } from "../setup/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      rm(dir, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

function stubConfig(dataDir: string): CliConfig {
  return {
    onboarding: {
      scheme: "convos",
    },
    signet: {
      env: "dev",
      identityMode: "per-group",
      dataDir,
    },
    defaults: {
      profileName: undefined,
    },
    keys: {
      rootKeyPolicy: "biometric",
      operationalKeyPolicy: "open",
      vaultKeyPolicy: "open",
    },
    biometricGating: {
      rootKeyCreation: false,
      operationalKeyRotation: false,
      scopeExpansion: false,
      egressExpansion: false,
      agentCreation: false,
      adminReadElevation: false,
    },
    ws: {
      port: 8393,
      host: "127.0.0.1",
    },
    http: {
      enabled: false,
      port: 8081,
      host: "127.0.0.1",
    },
    admin: {
      authMode: "admin-key",
      socketPath: join(dataDir, "admin.sock"),
    },
    credentials: {
      defaultTtlSeconds: 3600,
      maxConcurrentPerOperator: 3,
      actionExpirySeconds: 300,
    },
    logging: {
      level: "info",
      auditLogPath: undefined,
    },
    agent: {
      adapters: {},
    },
  };
}

function stubPaths(dataDir: string): ResolvedPaths {
  return {
    configFile: join(dataDir, "config.toml"),
    dataDir,
    pidFile: join(dataDir, "signet.pid"),
    adminSocket: join(dataDir, "admin.sock"),
    auditLog: join(dataDir, "audit.jsonl"),
    identityKeyFile: join(dataDir, "vault.db"),
  };
}

function createAdminHarness() {
  const operators: OperatorRecordType[] = [];
  const policies: PolicyRecordType[] = [];

  const client: AdminClient = {
    async connect() {
      return Result.ok(undefined);
    },
    async request<T>(method: string, params?: Record<string, unknown>) {
      switch (method) {
        case "signet.status":
          return Result.ok({
            state: "running",
            coreState: "ready",
            pid: 123,
            uptime: 10,
            activeCredentials: 0,
            activeConnections: 1,
            onboardingScheme: "convos",
            xmtpEnv: "dev",
            identityMode: "per-group",
            wsPort: 8393,
            version: "0.1.0",
            identityCount: 1,
            networkState: "connected",
            connectedInboxIds: [],
          } as T);
        case "operator.list":
          return Result.ok([...operators] as T);
        case "operator.create": {
          const next: OperatorRecordType = {
            id: `op_${String(operators.length + 1).padStart(16, "0")}`,
            config: params as unknown as OperatorRecordType["config"],
            createdAt: new Date().toISOString(),
            createdBy: "owner",
            status: "active",
          };
          operators.push(next);
          return Result.ok(next as T);
        }
        case "policy.list":
          return Result.ok([...policies] as T);
        case "policy.create": {
          const next: PolicyRecordType = {
            id: `policy_${String(policies.length + 1).padStart(16, "0")}`,
            config: params as unknown as PolicyRecordType["config"],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          policies.push(next);
          return Result.ok(next as T);
        }
        default:
          throw new Error(`Unhandled method ${method}`);
      }
    },
    async close() {},
  };

  return {
    client,
    operators,
    policies,
  };
}

describe("runOpenClawSetup", () => {
  test("provisions operator and policy templates plus adapter artifacts", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "openclaw-setup-"));
    tempDirs.push(dataDir);
    const harness = createAdminHarness();

    const result = await runOpenClawSetup(
      {
        configPath: join(dataDir, "config.toml"),
      },
      {
        async withAdminClient(_options, run) {
          return run(harness.client, {
            config: stubConfig(dataDir),
            paths: stubPaths(dataDir),
          });
        },
      },
    );

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.status).toBe("ok");
    expect(result.value.created).toContain("operator:openclaw-main");
    expect(result.value.created).toContain("policy:openclaw-readonly");
    expect(result.value.created).toContain("artifact:adapter.toml");

    const adapterToml = await readFile(
      join(dataDir, "adapters", "openclaw", "adapter.toml"),
      "utf-8",
    );
    expect(adapterToml).toContain('name = "openclaw"');
    expect(adapterToml).toContain("port = 8393");
  });

  test("reuses existing resources and artifacts on a second non-force run", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "openclaw-setup-"));
    tempDirs.push(dataDir);
    const harness = createAdminHarness();
    const deps = {
      async withAdminClient(_options: { configPath: string }, run: any) {
        return run(harness.client, {
          config: stubConfig(dataDir),
          paths: stubPaths(dataDir),
        });
      },
    };

    const first = await runOpenClawSetup(
      { configPath: join(dataDir, "config.toml") },
      deps,
    );
    expect(first.isOk()).toBe(true);

    const second = await runOpenClawSetup(
      { configPath: join(dataDir, "config.toml") },
      deps,
    );
    expect(second.isOk()).toBe(true);
    if (!second.isOk()) return;

    expect(second.value.reused).toContain("operator:openclaw-main");
    expect(second.value.reused).toContain("policy:openclaw-readonly");
    expect(second.value.reused).toContain("artifact:adapter.toml");
  });
});
