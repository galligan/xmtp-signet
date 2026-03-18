/**
 * Production dependency factory for the signet runtime.
 *
 * Wires real implementations from each package into the
 * SignetRuntimeDeps interface expected by createSignetRuntime.
 */

import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import { InternalError } from "@xmtp/signet-schemas";
import type { SignetCore, CoreState } from "@xmtp/signet-contracts";
import { createKeyManager, type KeyManager } from "@xmtp/signet-keys";
import type { KeyManagerConfig } from "@xmtp/signet-keys";
import {
  SignetCoreImpl,
  SignetCoreConfigSchema,
  createSdkClientFactory,
  createConversationActions,
  type SignetState,
  type SignerProviderFactory,
} from "@xmtp/signet-core";
import { createSignerProvider } from "@xmtp/signet-keys";
import {
  createSessionManager as createSessionManagerImpl,
  createSessionService,
  type InternalSessionManager,
} from "@xmtp/signet-sessions";
import { createSealManager as createSealManagerImpl } from "@xmtp/signet-seals";
import { createSealPublisher } from "@xmtp/signet-seals";
import type { InputResolver } from "@xmtp/signet-seals";
import { createSealStamper as createKeysSealStamper } from "@xmtp/signet-keys";
import {
  createWsServer as createWsServerImpl,
  type WsServer,
  type WsServerDeps,
} from "@xmtp/signet-ws";
import { createAdminServer as createAdminServerImpl } from "./admin/server.js";
import type { AdminServer, AdminServerDeps } from "./admin/server.js";
import {
  createHttpServer as createHttpServerImpl,
  type HttpServer,
  type HttpServerConfig as HttpServerImplConfig,
  type HttpServerDeps,
} from "./http/server.js";
import type { AdminServerConfig } from "./config/schema.js";
import type { SignetRuntimeDeps } from "./runtime.js";
import { createWsRequestHandler } from "./ws/request-handler.js";
import { createLazyCoreUpgrade } from "./ws/core-upgrade.js";
import { createEventProjector } from "./ws/event-projector.js";
import { createPendingActionStore } from "@xmtp/signet-sessions";

/** Map SignetCoreImpl states to the contract's CoreState. */
function mapSignetState(state: SignetState): CoreState {
  switch (state) {
    case "idle":
      return "uninitialized";
    case "local":
      return "ready-local";
    case "starting":
      return "initializing";
    case "running":
      return "ready";
    case "stopping":
      return "shutting-down";
    case "stopped":
      return "stopped";
    case "error":
      return "error";
  }
}

/**
 * Create production SignetRuntimeDeps wired with real implementations.
 *
 * Each factory function receives the exact shape passed by
 * createSignetRuntime -- the `unknown` params are narrowed here
 * to the concrete types each package expects.
 */
export function createProductionDeps(): SignetRuntimeDeps {
  // Hold references so downstream factories can access shared instances
  let keyManagerRef: KeyManager | null = null;
  let coreImplRef: SignetCoreImpl | null = null;
  let internalSessionManagerRef: InternalSessionManager | null = null;

  return {
    async createKeyManager(
      config: unknown,
    ): Promise<Result<KeyManager, SignetError>> {
      const cfg = config as {
        platform: string;
        rootKeyPolicy: KeyManagerConfig["rootKeyPolicy"];
        operationalKeyPolicy: KeyManagerConfig["operationalKeyPolicy"];
        dataDir: string;
      };
      const result = await createKeyManager({
        rootKeyPolicy: cfg.rootKeyPolicy,
        operationalKeyPolicy: cfg.operationalKeyPolicy,
        dataDir: cfg.dataDir,
      });
      if (Result.isOk(result)) {
        keyManagerRef = result.value;
      }
      return result;
    },

    createSignetCore(
      config: unknown,
      _signerFactory: unknown,
      _clientFactory: unknown,
    ): SignetCore {
      const cfg = config as {
        env: "local" | "dev" | "production";
        identityMode: "per-group" | "shared";
        dataDir: string;
      };

      // Build the real signer provider factory backed by the key manager
      const signerProviderFactory: SignerProviderFactory = (
        identityId: string,
      ) => {
        if (keyManagerRef === null) {
          throw new Error(
            "KeyManager not initialized before SignetCore creation",
          );
        }
        return createSignerProvider(keyManagerRef, identityId);
      };

      const clientFactory = createSdkClientFactory();

      // Parse through schema so defaults (heartbeatIntervalMs, etc.) are applied
      const coreConfig = SignetCoreConfigSchema.parse({
        dataDir: cfg.dataDir,
        env: cfg.env,
        identityMode: cfg.identityMode,
      });

      const impl = new SignetCoreImpl(
        coreConfig,
        signerProviderFactory,
        clientFactory,
      );
      coreImplRef = impl;

      // Adapt SignetCoreImpl (start/stop) to SignetCore contract
      // (initialize/shutdown) with state name mapping
      return {
        get state(): CoreState {
          return mapSignetState(impl.state);
        },
        async initializeLocal(): Promise<Result<void, SignetError>> {
          return impl.startLocal();
        },
        async initialize(): Promise<Result<void, SignetError>> {
          return impl.start();
        },
        async shutdown(): Promise<Result<void, SignetError>> {
          return impl.stop();
        },
        async sendMessage(
          groupId: string,
          contentType: string,
          content: unknown,
        ) {
          return impl.context.sendMessage(groupId, contentType, content);
        },
        async getGroupInfo(groupId: string) {
          // XmtpGroupInfo is structurally close to GroupInfo but not
          // identical. This adapter is sufficient for the startup path;
          // a proper mapping layer will be added when harness requests
          // exercise this code path.
          const result = await impl.context.getGroupInfo(groupId);
          return result as Result<
            import("@xmtp/signet-contracts").GroupInfo,
            SignetError
          >;
        },
      };
    },

    createSessionManager(config: unknown, keyManager: KeyManager) {
      const cfg = config as {
        defaultTtlSeconds: number;
        maxConcurrentPerAgent: number;
      };
      const internal = createSessionManagerImpl({
        defaultTtlSeconds: cfg.defaultTtlSeconds,
        maxConcurrentPerAgent: cfg.maxConcurrentPerAgent,
      });
      internalSessionManagerRef = internal;

      return createSessionService({
        manager: internal,
        keyManager,
      });
    },

    getInternalSessionManager() {
      if (!internalSessionManagerRef) {
        throw new Error("Internal session manager not initialized");
      }
      return internalSessionManagerRef;
    },

    createSealManager(deps: unknown) {
      const d = deps as {
        core: SignetCore;
        keyManager: KeyManager;
        sessionManager: import("@xmtp/signet-contracts").SessionManager;
      };

      // Dynamic stamper: resolves the signing identity from the seal
      // payload. The key manager stores operational keys under the internal
      // identityId, not the XMTP inboxId, so we resolve via the identity store.
      async function resolveIdentityId(
        inboxId: string,
      ): Promise<Result<string, SignetError>> {
        if (!coreImplRef) {
          return Result.err(
            InternalError.create("Core not initialized -- cannot resolve identity"),
          );
        }
        const identity =
          await coreImplRef.identityStore.getByInboxId(inboxId);
        if (!identity) {
          return Result.err(
            InternalError.create(
              `No identity found for inboxId: ${inboxId}`,
            ),
          );
        }
        return Result.ok(identity.id);
      }

      const signer: import("@xmtp/signet-contracts").SealStamper = {
        async sign(seal) {
          if (keyManagerRef === null) {
            return Result.err(
              InternalError.create(
                "KeyManager not initialized -- cannot sign seal",
              ),
            );
          }
          const idResult = await resolveIdentityId(seal.agentInboxId);
          if (Result.isError(idResult)) return idResult;
          const stamper = createKeysSealStamper(
            keyManagerRef,
            idResult.value,
          );
          return stamper.sign(seal);
        },
        async signRevocation(revocation) {
          if (keyManagerRef === null) {
            return Result.err(
              InternalError.create(
                "KeyManager not initialized -- cannot sign revocation",
              ),
            );
          }
          const idResult = await resolveIdentityId(revocation.agentInboxId);
          if (Result.isError(idResult)) return idResult;
          const stamper = createKeysSealStamper(
            keyManagerRef,
            idResult.value,
          );
          return stamper.signRevocation(revocation);
        },
      };

      // Real publisher backed by core.sendMessage
      const publisher = createSealPublisher({
        sendMessage: (groupId, contentType, content) =>
          d.core.sendMessage(groupId, contentType, content),
      });

      // InputResolver stub: translating session policy into SealInput
      // requires aggregating fields from the session record, config,
      // and key manager that don't have a mapping layer yet. This will
      // be wired when the full seal issuance flow is exercised.
      const resolveInput: InputResolver = async (_sessionId, _groupId) => {
        return Result.err(
          InternalError.create(
            "InputResolver not yet wired -- session-to-seal-input mapping pending",
          ),
        );
      };

      return createSealManagerImpl({
        signer,
        publisher,
        resolveInput,
      });
    },

    createWsServer(config: unknown, deps: unknown): WsServer {
      const cfg = config as { port: number; host: string };
      const d = deps as {
        core: SignetCore;
        sessionManager: import("@xmtp/signet-contracts").SessionManager;
        sealManager: import("@xmtp/signet-contracts").SealManager;
      };

      const pendingActions = createPendingActionStore();

      // Late-bound broadcast: the WS server isn't created yet when
      // the request handler is wired, so we capture a mutable ref.
      let wsServerRef: WsServer | null = null;

      // Build the WsServerDeps with tokenLookup and requestHandler
      const ensureCoreReady = createLazyCoreUpgrade(d.core);
      const requestHandler = createWsRequestHandler({
        ensureCoreReady,
        sendMessage: (groupId, contentType, content) =>
          d.core.sendMessage(groupId, contentType, content),
        sessionManager: d.sessionManager,
        pendingActions,
        broadcast: (sessionId: string, event: unknown) => {
          wsServerRef?.broadcast(sessionId, event as import("@xmtp/signet-schemas").SignetEvent);
        },
      });

      const projector = createEventProjector({
        getRevealState(sessionId: string) {
          const result = d.sessionManager.getRevealState(sessionId);
          return Result.isOk(result) ? result.value : null;
        },
      });

      const wsDeps: WsServerDeps = {
        core: d.core,
        sessionManager: d.sessionManager,
        sealManager: d.sealManager,
        async tokenLookup(token: string) {
          return d.sessionManager.lookupByToken(token);
        },
        requestHandler,
        projectEvent: projector,
      };

      const server = createWsServerImpl(cfg, wsDeps);
      wsServerRef = server;
      globalWsServerRef = server;
      return server;
    },

    createAdminServer(config: unknown, deps: unknown): AdminServer {
      const cfg = config as AdminServerConfig;
      const d = deps as AdminServerDeps;
      return createAdminServerImpl(cfg, d);
    },

    createHttpServer(config: unknown, deps: unknown): HttpServer {
      const cfg = config as HttpServerImplConfig;
      const d = deps as HttpServerDeps;
      return createHttpServerImpl(cfg, d);
    },

    createConversationActions() {
      if (coreImplRef === null) {
        throw new Error(
          "SignetCoreImpl not initialized before conversation actions",
        );
      }
      if (keyManagerRef === null) {
        throw new Error(
          "KeyManager not initialized before conversation actions",
        );
      }
      const km = keyManagerRef;
      const signerProviderFactory: SignerProviderFactory = (
        identityId: string,
      ) => createSignerProvider(km, identityId);

      return createConversationActions({
        identityStore: coreImplRef.identityStore,
        getManagedClient: (id) => coreImplRef!.getManagedClient(id),
        getGroupInfo: (groupId: string) =>
          coreImplRef!.context.getGroupInfo(groupId),
        clientFactory: createSdkClientFactory(),
        signerProviderFactory,
        config: coreImplRef.config,
      });
    },

    async listIdentities() {
      if (coreImplRef === null) return [];
      return coreImplRef.identityStore.list();
    },
  };
}
