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
} from "@xmtp/signet-sessions";
import { createSealManager as createSealManagerImpl } from "@xmtp/signet-seals";
import type { InputResolver } from "@xmtp/signet-seals";
import {
  createWsServer as createWsServerImpl,
  type WsServer,
  type WsServerDeps,
} from "@xmtp/signet-ws";
import { createAdminServer as createAdminServerImpl } from "./admin/server.js";
import type { AdminServer, AdminServerDeps } from "./admin/server.js";
import type { AdminServerConfig } from "./config/schema.js";
import type { SignetRuntimeDeps } from "./runtime.js";
import { createWsRequestHandler } from "./ws/request-handler.js";
import { createLazyCoreUpgrade } from "./ws/core-upgrade.js";
import { createEventProjector } from "./ws/event-projector.js";

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

      return createSessionService({
        manager: internal,
        keyManager,
      });
    },

    createSealManager(_deps: unknown) {
      // The runtime passes {} for deps. The real seal manager needs
      // signer, publisher, and resolveInput. For the initial startup
      // these are stubs -- seal operations happen later when sessions
      // are created and groups are joined.
      const stubSigner: import("@xmtp/signet-contracts").SealStamper = {
        async sign(_seal) {
          return Result.err(
            InternalError.create("SealStamper not wired -- no sessions active"),
          );
        },
        async signRevocation(_revocation) {
          return Result.err(
            InternalError.create("SealStamper not wired -- no sessions active"),
          );
        },
      };

      const stubPublisher: import("@xmtp/signet-contracts").SealPublisher = {
        async publish(_groupId, _signed) {
          return Result.err(
            InternalError.create(
              "SealPublisher not wired -- no sessions active",
            ),
          );
        },
        async publishRevocation(_groupId, _signed) {
          return Result.err(
            InternalError.create(
              "SealPublisher not wired -- no sessions active",
            ),
          );
        },
      };

      const stubResolver: InputResolver = async (_sessionId, _groupId) => {
        return Result.err(
          InternalError.create("InputResolver not wired -- no sessions active"),
        );
      };

      return createSealManagerImpl({
        signer: stubSigner,
        publisher: stubPublisher,
        resolveInput: stubResolver,
      });
    },

    createWsServer(config: unknown, deps: unknown): WsServer {
      const cfg = config as { port: number; host: string };
      const d = deps as {
        core: SignetCore;
        sessionManager: import("@xmtp/signet-contracts").SessionManager;
        sealManager: import("@xmtp/signet-contracts").SealManager;
      };

      // Build the WsServerDeps with tokenLookup and requestHandler
      const ensureCoreReady = createLazyCoreUpgrade(d.core);
      const requestHandler = createWsRequestHandler({
        ensureCoreReady,
        sendMessage: (groupId, contentType, content) =>
          d.core.sendMessage(groupId, contentType, content),
        sessionManager: d.sessionManager,
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

      return createWsServerImpl(cfg, wsDeps);
    },

    createAdminServer(config: unknown, deps: unknown): AdminServer {
      const cfg = config as AdminServerConfig;
      const d = deps as AdminServerDeps;
      return createAdminServerImpl(cfg, d);
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
