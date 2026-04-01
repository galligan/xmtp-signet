import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import { InternalError } from "@xmtp/signet-schemas";
import type {
  ActionSpec,
  SignetCore,
  CredentialManager,
  SealManager,
} from "@xmtp/signet-contracts";
import { createActionRegistry } from "@xmtp/signet-contracts";
import {
  createKeyActions,
  createWalletActions,
  type KeyManager,
} from "@xmtp/signet-keys";
import type { WsServer } from "@xmtp/signet-ws";
import {
  createCredentialActions,
  createRevealActions,
  createUpdateActions,
  createOperatorActions,
  createPolicyActions,
} from "@xmtp/signet-sessions";
import type { InternalCredentialManager } from "@xmtp/signet-sessions";
import type { AdminServer } from "./admin/server.js";
import type { HttpServer } from "./http/server.js";
import type { CliConfig } from "./config/schema.js";
import type { ResolvedPaths } from "./config/paths.js";
import { resolvePaths } from "./config/paths.js";
import { createPidFile } from "./daemon/pid.js";
import { createAuditLog, type AuditLog } from "./audit/log.js";
import type { DaemonState } from "./daemon/lifecycle.js";
import { createAdminDispatcher } from "./admin/dispatcher.js";
import type { DaemonStatus } from "./daemon/status.js";
import { createSignetActions } from "./actions/signet-actions.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The fully wired signet runtime returned by the composition root. */
export interface SignetRuntime {
  readonly core: SignetCore;
  readonly credentialManager: CredentialManager;
  readonly sealManager: SealManager;
  readonly keyManager: KeyManager;
  readonly wsServer: WsServer;
  readonly adminServer: AdminServer;
  readonly httpServer: HttpServer | null;
  readonly auditLog: AuditLog;
  readonly config: CliConfig;
  readonly paths: ResolvedPaths;

  /** Start all services in dependency order. */
  start(): Promise<Result<void, SignetError>>;

  /** Graceful shutdown in reverse dependency order. */
  shutdown(): Promise<Result<void, SignetError>>;

  /** Snapshot daemon status for CLI/admin callers. */
  status(): Promise<DaemonStatus>;

  /** Current lifecycle state. */
  readonly state: DaemonState;
}

/**
 * Injectable factory functions for all runtime dependencies.
 * Tests provide mocks here; production uses real implementations.
 */
export interface SignetRuntimeDeps {
  createKeyManager: (
    config: unknown,
  ) => Promise<Result<KeyManager, SignetError>>;

  createSignetCore: (
    config: unknown,
    signerFactory: unknown,
    clientFactory: unknown,
  ) => SignetCore;

  createCredentialManager: (
    config: unknown,
    keyManager: KeyManager,
  ) => CredentialManager;
  createSealManager: (deps: unknown) => SealManager;

  createWsServer: (config: unknown, deps: unknown) => WsServer;

  createAdminServer: (config: unknown, deps: unknown) => AdminServer;

  createHttpServer?: (config: unknown, deps: unknown) => HttpServer;

  /** Optional factory for conversation action specs, wired in production by start.ts. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createConversationActions?: () => ActionSpec<any, any, SignetError>[];

  /** Optional factory for inbox action specs, wired in production by start.ts. */
  createInboxActions?: () => ActionSpec<unknown, unknown, SignetError>[];

  /** Optional factory for message action specs, wired in production by start.ts. */
  createMessageActions?: () => ActionSpec<unknown, unknown, SignetError>[];

  /** Optional factory for seal action specs, wired in production by start.ts. */
  createSealActions?: () => ActionSpec<unknown, unknown, SignetError>[];

  /** Optional factory to expose the internal credential manager for update actions. */
  getInternalCredentialManager?: () => InternalCredentialManager;

  /** Optional factory for operator action specs, wired in production by start.ts. */
  createOperatorManager?: () => import("@xmtp/signet-contracts").OperatorManager;

  /** Optional factory for policy action specs, wired in production by start.ts. */
  createPolicyManager?: () => import("@xmtp/signet-contracts").PolicyManager;

  /** Optional callback to list registered identities with their inbox IDs. */
  listIdentities?: () => Promise<readonly { inboxId: string | null }[]>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Composition root: wire all signet packages into a running runtime.
 *
 * The `deps` parameter enables full dependency injection for testing.
 * In production, pass the real factory functions from each package.
 */
export async function createSignetRuntime(
  config: CliConfig,
  deps: SignetRuntimeDeps,
): Promise<Result<SignetRuntime, SignetError>> {
  const paths = resolvePaths(config);
  let currentState: DaemonState = "created";
  let boundWsPort: number = config.ws.port;

  // -- Step 1: Create KeyManager --
  const keyManagerResult = await deps.createKeyManager({
    platform: "software-vault",
    rootKeyPolicy: config.keys.rootKeyPolicy,
    operationalKeyPolicy: config.keys.operationalKeyPolicy,
    vaultKeyPolicy: config.keys.vaultKeyPolicy,
    biometricGating: config.biometricGating,
    dataDir: paths.dataDir,
  });

  if (Result.isError(keyManagerResult)) {
    return keyManagerResult;
  }

  const keyManager = keyManagerResult.value;

  // -- Step 2: Create remaining services --
  const core = deps.createSignetCore(
    {
      env: config.signet.env,
      identityMode: config.signet.identityMode,
      dataDir: paths.dataDir,
    },
    null, // signerFactory -- wired by production code
    null, // clientFactory -- wired by production code
  );

  // Create operator and policy managers BEFORE credential manager so their
  // refs are available when createCredentialService captures policyManagerRef.
  const operatorManager = deps.createOperatorManager?.() ?? null;
  const policyManager = deps.createPolicyManager?.() ?? null;

  const credentialManager = deps.createCredentialManager(
    {
      defaultTtlSeconds: config.credentials.defaultTtlSeconds,
      maxConcurrentPerOperator: config.credentials.maxConcurrentPerOperator,
    },
    keyManager,
  );

  const sealManager = deps.createSealManager({
    core,
    keyManager,
    credentialManager,
  });

  const wsServer = deps.createWsServer(
    {
      port: config.ws.port,
      host: config.ws.host,
      actionExpirySeconds: config.credentials.actionExpirySeconds,
    },
    {
      core,
      credentialManager,
      sealManager,
    },
  );

  const auditLog = createAuditLog(paths.auditLog);

  // Admin handlers are admin-auth only and don't use the signer.
  // Provide a stub that returns InternalError if ever called.
  const adminSignerStub: import("@xmtp/signet-contracts").SignerProvider = {
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

  let runtimeRef: SignetRuntime | undefined;

  for (const spec of createCredentialActions({ credentialManager })) {
    registry.register(spec);
  }

  if (deps.getInternalCredentialManager) {
    const internalManager = deps.getInternalCredentialManager();

    for (const spec of createRevealActions({
      credentialManager,
      internalManager,
    })) {
      registry.register(spec);
    }

    for (const spec of createUpdateActions({
      credentialManager,
      internalManager,
    })) {
      registry.register(spec);
    }
  }

  for (const spec of createSignetActions({
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
    rotateKeys: async () => {
      const keys = keyManager.listOperationalKeys();
      let rotated = 0;
      const errors: string[] = [];
      for (const key of keys) {
        const result = await keyManager.rotateOperationalKey(key.identityId);
        if (result.isOk()) {
          rotated++;
        } else {
          errors.push(`${key.identityId}: ${result.error.message}`);
        }
      }
      if (errors.length > 0 && rotated === 0) {
        return Result.err(
          InternalError.create(`All rotations failed: ${errors.join("; ")}`),
        );
      }
      return Result.ok({ rotated, failed: errors.length, errors });
    },
    verifyKeys: async () => {
      const adminResult = await keyManager.admin.get();
      const adminEntry = Result.isOk(adminResult)
        ? {
            status: "ok" as const,
            publicKey: adminResult.value.publicKey,
            fingerprint: adminResult.value.fingerprint,
          }
        : { status: "missing" as const, error: adminResult.error.message };

      const operationalKeys = keyManager.listOperationalKeys().map((key) => ({
        keyId: key.keyId,
        identityId: key.identityId,
        status: "ok" as const,
        fingerprint: key.fingerprint,
      }));

      return Result.ok({
        platform: keyManager.platform,
        trustTier: keyManager.trustTier,
        rootKey:
          adminEntry.status === "ok"
            ? { status: "ok" as const, publicKey: adminEntry.publicKey }
            : { status: "missing" as const },
        adminKey: adminEntry,
        operationalKeys,
      });
    },
    exportState: async () => {
      if (runtimeRef === undefined) {
        return Result.err(InternalError.create("Runtime not ready"));
      }
      const statusSnapshot = await runtimeRef.status();

      const operatorsResult = operatorManager
        ? await operatorManager.list()
        : Result.ok([] as readonly unknown[]);
      const policiesResult = policyManager
        ? await policyManager.list()
        : Result.ok([] as readonly unknown[]);
      const credentialsResult = await credentialManager.list();
      const identitySnapshot = deps.listIdentities
        ? await deps.listIdentities()
        : [];

      const errors: string[] = [];
      if (Result.isError(operatorsResult)) errors.push("operators");
      if (Result.isError(policiesResult)) errors.push("policies");
      if (Result.isError(credentialsResult)) errors.push("credentials");

      const snapshot: {
        status: typeof statusSnapshot;
        operators: readonly unknown[];
        policies: readonly unknown[];
        credentials: readonly unknown[];
        identities: typeof identitySnapshot;
        errors?: readonly string[];
      } = {
        status: statusSnapshot,
        operators: Result.isOk(operatorsResult) ? operatorsResult.value : [],
        policies: Result.isOk(policiesResult) ? policiesResult.value : [],
        credentials: Result.isOk(credentialsResult)
          ? credentialsResult.value
          : [],
        identities: identitySnapshot,
      };

      if (errors.length > 0) {
        snapshot.errors = errors;
      }

      return Result.ok(snapshot);
    },
    auditLog,
  })) {
    registry.register(spec);
  }

  for (const spec of createWalletActions({ keyManager })) {
    registry.register(spec);
  }

  if (operatorManager) {
    if (deps.createInboxActions) {
      for (const spec of deps.createInboxActions()) {
        registry.register(spec);
      }
    }

    for (const spec of createKeyActions({ keyManager, operatorManager })) {
      registry.register(spec);
    }

    for (const spec of createOperatorActions({ operatorManager })) {
      registry.register(spec);
    }
  }

  if (policyManager) {
    for (const spec of createPolicyActions({ policyManager })) {
      registry.register(spec);
    }
  }

  if (deps.createConversationActions) {
    for (const spec of deps.createConversationActions()) {
      registry.register(spec);
    }
  }

  if (deps.createMessageActions) {
    for (const spec of deps.createMessageActions()) {
      registry.register(spec);
    }
  }

  if (deps.createSealActions) {
    for (const spec of deps.createSealActions()) {
      registry.register(spec);
    }
  }

  const dispatcher = createAdminDispatcher(registry);

  const adminServer = deps.createAdminServer(
    {
      socketPath: paths.adminSocket,
      authMode: config.admin.authMode,
    },
    {
      keyManager,
      dispatcher,
      signetId: "signet",
      signerProvider: adminSignerStub,
    },
  );

  // -- Optional HTTP server (disabled by default) --
  let httpServer: HttpServer | null = null;
  if (config.http.enabled && deps.createHttpServer) {
    httpServer = deps.createHttpServer(
      { port: config.http.port, host: config.http.host },
      {
        dispatcher,
        registry,
        credentialManager,
        signetId: "signet",
        signerProvider: adminSignerStub,
        verifyAdminJwt: async (token: string) => {
          return keyManager.admin.verifyJwt(token);
        },
        status: async () => {
          if (runtimeRef === undefined) {
            return { state: "starting" };
          }
          return runtimeRef.status();
        },
      },
    );
  }

  // -- Build runtime object --
  const runtime: SignetRuntime = {
    core,
    credentialManager,
    sealManager,
    keyManager,
    wsServer,
    adminServer,
    httpServer,
    auditLog,
    config,
    paths,

    get state(): DaemonState {
      return currentState;
    },

    async status(): Promise<DaemonStatus> {
      const identitySnapshot = deps.listIdentities
        ? await deps.listIdentities()
        : [];
      const credentialsResult = await credentialManager.list();
      const daemonStatusState: DaemonStatus["state"] =
        currentState === "running" || currentState === "draining"
          ? currentState
          : "stopped";

      return {
        state: daemonStatusState,
        coreState: core.state,
        pid: process.pid,
        uptime: process.uptime(),
        activeCredentials: Result.isOk(credentialsResult)
          ? credentialsResult.value.length
          : 0,
        activeConnections: wsServer.connectionCount,
        xmtpEnv: config.signet.env,
        identityMode: config.signet.identityMode,
        wsPort: boundWsPort,
        version: "0.1.0",
        identityCount: identitySnapshot.length,
        networkState: core.state === "ready" ? "connected" : "disconnected",
        connectedInboxIds: identitySnapshot
          .map((i) => i.inboxId)
          .filter((id): id is string => id !== null),
      };
    },

    async start(): Promise<Result<void, SignetError>> {
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

        // 2. Initialize signet core locally
        const coreLocalResult = await core.initializeLocal();
        if (Result.isError(coreLocalResult)) {
          currentState = "error";
          return coreLocalResult;
        }

        // 2b. Attempt network startup if env is not "local"
        if (config.signet.env !== "local") {
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
        boundWsPort = wsResult.value.port;

        // 4. Start admin server
        const adminResult = await adminServer.start();
        if (Result.isError(adminResult)) {
          currentState = "error";
          await wsServer.stop();
          await core.shutdown();
          return adminResult;
        }

        // 4b. Start HTTP server (if enabled)
        if (httpServer !== null) {
          const httpResult = await httpServer.start();
          if (Result.isError(httpResult)) {
            currentState = "error";
            await adminServer.stop();
            await wsServer.stop();
            await core.shutdown();
            return httpResult;
          }
        }

        // 5. Write PID file
        const pidResult = await pidFile.write(process.pid);
        if (Result.isError(pidResult)) {
          currentState = "error";
          if (httpServer !== null) await httpServer.stop();
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
          if (httpServer !== null) await httpServer.stop();
          await adminServer.stop();
          await wsServer.stop();
          await core.shutdown();
          return Result.err(
            InternalError.create(
              `Audit log write failed during startup: ${auditError instanceof Error ? auditError.message : String(auditError)}`,
            ),
          );
        }

        // 7. Start key auto-rotation (no-op if interval is 0)
        keyManager.startAutoRotation();

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

    async shutdown(): Promise<Result<void, SignetError>> {
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

        // 0. Stop key auto-rotation
        keyManager.stopAutoRotation();

        // 0b. Stop HTTP server (if running)
        if (httpServer !== null) {
          const httpStopResult = await httpServer.stop();
          if (Result.isError(httpStopResult)) {
            errors.push(`http: ${httpStopResult.error.message}`);
          }
        }

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

        // 3. Stop signet core
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
