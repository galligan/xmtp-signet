import { Result } from "better-result";
import type { BrokerError } from "@xmtp-broker/schemas";
import { InternalError } from "@xmtp-broker/schemas";
import type {
  ActionSpec,
  BrokerCore,
  SessionManager,
  AttestationManager,
} from "@xmtp-broker/contracts";
import { createActionRegistry } from "@xmtp-broker/contracts";
import type { KeyManager } from "@xmtp-broker/keys";
import type { WsServer } from "@xmtp-broker/ws";
import { createSessionActions } from "@xmtp-broker/sessions";
import type { AdminServer } from "./admin/server.js";
import type { CliConfig } from "./config/schema.js";
import type { ResolvedPaths } from "./config/paths.js";
import { resolvePaths } from "./config/paths.js";
import { createPidFile } from "./daemon/pid.js";
import { createAuditLog, type AuditLog } from "./audit/log.js";
import type { DaemonState } from "./daemon/lifecycle.js";
import { createAdminDispatcher } from "./admin/dispatcher.js";
import type { DaemonStatus } from "./daemon/status.js";
import { createBrokerActions } from "./actions/broker-actions.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The fully wired broker runtime returned by the composition root. */
export interface BrokerRuntime {
  readonly core: BrokerCore;
  readonly sessionManager: SessionManager;
  readonly attestationManager: AttestationManager;
  readonly keyManager: KeyManager;
  readonly wsServer: WsServer;
  readonly adminServer: AdminServer;
  readonly auditLog: AuditLog;
  readonly config: CliConfig;
  readonly paths: ResolvedPaths;

  /** Start all services in dependency order. */
  start(): Promise<Result<void, BrokerError>>;

  /** Graceful shutdown in reverse dependency order. */
  shutdown(): Promise<Result<void, BrokerError>>;

  /** Snapshot daemon status for CLI/admin callers. */
  status(): Promise<DaemonStatus>;

  /** Current lifecycle state. */
  readonly state: DaemonState;
}

/**
 * Injectable factory functions for all runtime dependencies.
 * Tests provide mocks here; production uses real implementations.
 */
export interface BrokerRuntimeDeps {
  createKeyManager: (
    config: unknown,
  ) => Promise<Result<KeyManager, BrokerError>>;

  createBrokerCore: (
    config: unknown,
    signerFactory: unknown,
    clientFactory: unknown,
  ) => BrokerCore;

  createSessionManager: (
    config: unknown,
    keyManager: KeyManager,
  ) => SessionManager;
  createAttestationManager: (deps: unknown) => AttestationManager;

  createWsServer: (config: unknown, deps: unknown) => WsServer;

  createAdminServer: (config: unknown, deps: unknown) => AdminServer;

  /** Optional factory for conversation action specs, wired in production by start.ts. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createConversationActions?: () => ActionSpec<any, any, BrokerError>[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Composition root: wire all broker packages into a running runtime.
 *
 * The `deps` parameter enables full dependency injection for testing.
 * In production, pass the real factory functions from each package.
 */
export async function createBrokerRuntime(
  config: CliConfig,
  deps: BrokerRuntimeDeps,
): Promise<Result<BrokerRuntime, BrokerError>> {
  const paths = resolvePaths(config);
  let currentState: DaemonState = "created";

  // -- Step 1: Create KeyManager --
  const keyManagerResult = await deps.createKeyManager({
    platform: "software-vault",
    rootKeyPolicy: config.keys.rootKeyPolicy,
    operationalKeyPolicy: config.keys.operationalKeyPolicy,
    dataDir: paths.dataDir,
  });

  if (Result.isError(keyManagerResult)) {
    return keyManagerResult;
  }

  const keyManager = keyManagerResult.value;

  // -- Step 2: Create remaining services --
  const core = deps.createBrokerCore(
    {
      env: config.broker.env,
      identityMode: config.broker.identityMode,
      dataDir: paths.dataDir,
    },
    null, // signerFactory -- wired by production code
    null, // clientFactory -- wired by production code
  );

  const sessionManager = deps.createSessionManager(
    {
      defaultTtlSeconds: config.sessions.defaultTtlSeconds,
      maxConcurrentPerAgent: config.sessions.maxConcurrentPerAgent,
    },
    keyManager,
  );

  const attestationManager = deps.createAttestationManager({});

  const wsServer = deps.createWsServer(
    { port: config.ws.port, host: config.ws.host },
    {
      core,
      sessionManager,
      attestationManager,
    },
  );

  const auditLog = createAuditLog(paths.auditLog);

  // Admin handlers are admin-auth only and don't use the signer.
  // Provide a stub that returns InternalError if ever called.
  const adminSignerStub: import("@xmtp-broker/contracts").SignerProvider = {
    async sign() {
      return Result.err(
        InternalError.create("SignerProvider not available in admin context"),
      );
    },
    async getPublicKey() {
      return Result.err(
        InternalError.create("SignerProvider not available in admin context"),
      );
    },
    async getFingerprint() {
      return Result.err(
        InternalError.create("SignerProvider not available in admin context"),
      );
    },
    async getDbEncryptionKey() {
      return Result.err(
        InternalError.create("SignerProvider not available in admin context"),
      );
    },
    async getXmtpIdentityKey() {
      return Result.err(
        InternalError.create("SignerProvider not available in admin context"),
      );
    },
  };

  const pidFile = createPidFile(paths.pidFile);
  const registry = createActionRegistry();

  let runtimeRef: BrokerRuntime | undefined;

  for (const spec of createSessionActions({ sessionManager })) {
    registry.register(spec);
  }

  for (const spec of createBrokerActions({
    status: async () => {
      if (runtimeRef === undefined) {
        throw new Error("Runtime not ready");
      }
      return runtimeRef.status();
    },
    shutdown: async () => {
      if (runtimeRef === undefined) {
        return Result.err(InternalError.create("Runtime not ready"));
      }
      return runtimeRef.shutdown();
    },
  })) {
    registry.register(spec);
  }

  if (deps.createConversationActions) {
    for (const spec of deps.createConversationActions()) {
      registry.register(spec);
    }
  }

  const adminServer = deps.createAdminServer(
    {
      socketPath: paths.adminSocket,
      authMode: config.admin.authMode,
    },
    {
      keyManager,
      dispatcher: createAdminDispatcher(registry),
      brokerId: "broker",
      signerProvider: adminSignerStub,
    },
  );

  // -- Build runtime object --
  const runtime: BrokerRuntime = {
    core,
    sessionManager,
    attestationManager,
    keyManager,
    wsServer,
    adminServer,
    auditLog,
    config,
    paths,

    get state(): DaemonState {
      return currentState;
    },

    async status(): Promise<DaemonStatus> {
      const sessionsResult = await sessionManager.list();
      const daemonStatusState: DaemonStatus["state"] =
        currentState === "running" || currentState === "draining"
          ? currentState
          : "stopped";

      return {
        state: daemonStatusState,
        coreState: core.state,
        pid: process.pid,
        uptime: process.uptime(),
        activeSessions: Result.isOk(sessionsResult)
          ? sessionsResult.value.length
          : 0,
        activeConnections: wsServer.connectionCount,
        xmtpEnv: config.broker.env,
        identityMode: config.broker.identityMode,
        wsPort: config.ws.port,
        version: "0.1.0",
        identityCount: 0,
        networkState: core.state === "ready" ? "connected" : "disconnected",
        connectedInboxIds: [],
      };
    },

    async start(): Promise<Result<void, BrokerError>> {
      if (currentState !== "created") {
        return Result.err(
          InternalError.create(
            `Cannot start runtime in state "${currentState}"`,
          ),
        );
      }

      currentState = "starting";

      try {
        // 1. Initialize key manager
        const initResult = await keyManager.initialize();
        if (Result.isError(initResult)) {
          currentState = "error";
          return initResult;
        }

        // 2. Initialize broker core locally
        const coreLocalResult = await core.initializeLocal();
        if (Result.isError(coreLocalResult)) {
          currentState = "error";
          return coreLocalResult;
        }

        // 2b. Attempt network startup if env is not "local"
        if (config.broker.env !== "local") {
          const coreNetworkResult = await core.initialize();
          if (Result.isError(coreNetworkResult)) {
            // Graceful degradation: log and continue in local mode
            await auditLog.append({
              timestamp: new Date().toISOString(),
              action: "core.network-start-failed",
              actor: "system",
              success: false,
              detail: {
                error: coreNetworkResult.error.message,
                fallback: "local",
              },
            });
            // Don't return error -- daemon is still useful in local state
          }
        }

        // 3. Start WebSocket server
        const wsResult = await wsServer.start();
        if (Result.isError(wsResult)) {
          currentState = "error";
          await core.shutdown();
          return wsResult;
        }

        // 4. Start admin server
        const adminResult = await adminServer.start();
        if (Result.isError(adminResult)) {
          currentState = "error";
          await wsServer.stop();
          await core.shutdown();
          return adminResult;
        }

        // 5. Write PID file
        const pidResult = await pidFile.write(process.pid);
        if (Result.isError(pidResult)) {
          currentState = "error";
          await adminServer.stop();
          await wsServer.stop();
          await core.shutdown();
          return pidResult;
        }

        // 6. Log startup event
        try {
          await auditLog.append({
            timestamp: new Date().toISOString(),
            action: "daemon.start",
            actor: "system",
            success: true,
            detail: { pid: process.pid, coreState: core.state },
          });
        } catch (auditError: unknown) {
          // Audit log failure after servers started — roll back
          currentState = "error";
          await pidFile.cleanup();
          await adminServer.stop();
          await wsServer.stop();
          await core.shutdown();
          return Result.err(
            InternalError.create(
              `Audit log write failed during startup: ${auditError instanceof Error ? auditError.message : String(auditError)}`,
            ),
          );
        }

        currentState = "running";

        return Result.ok(undefined);
      } catch (error: unknown) {
        currentState = "error";
        return Result.err(
          InternalError.create(
            `Runtime startup failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    },

    async shutdown(): Promise<Result<void, BrokerError>> {
      if (currentState !== "running") {
        return Result.err(
          InternalError.create(
            `Cannot shutdown runtime in state "${currentState}"`,
          ),
        );
      }

      currentState = "draining";

      try {
        const errors: string[] = [];

        // Reverse order of startup

        // 1. Stop admin server
        const adminStopResult = await adminServer.stop();
        if (Result.isError(adminStopResult)) {
          errors.push(`admin: ${adminStopResult.error.message}`);
        }

        // 2. Stop WebSocket server (drain connections)
        const wsStopResult = await wsServer.stop();
        if (Result.isError(wsStopResult)) {
          errors.push(`ws: ${wsStopResult.error.message}`);
        }

        // 3. Stop broker core
        const coreStopResult = await core.shutdown();
        if (Result.isError(coreStopResult)) {
          errors.push(`core: ${coreStopResult.error.message}`);
        }

        // 4. Clean up PID file
        await pidFile.cleanup();

        // 5. Log shutdown event
        await auditLog.append({
          timestamp: new Date().toISOString(),
          action: "daemon.stop",
          actor: "system",
          success: errors.length === 0,
          ...(errors.length > 0 ? { detail: { errors } } : {}),
        });

        if (errors.length > 0) {
          currentState = "error";
          return Result.err(
            InternalError.create(
              `Shutdown completed with errors: ${errors.join("; ")}`,
            ),
          );
        }

        currentState = "stopped";
        return Result.ok(undefined);
      } catch (error: unknown) {
        currentState = "error";
        return Result.err(
          InternalError.create(
            `Runtime shutdown failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    },
  };

  runtimeRef = runtime;

  return Result.ok(runtime);
}
