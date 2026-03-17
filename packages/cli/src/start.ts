/**
 * Production dependency factory for the broker runtime.
 *
 * Wires real implementations from each package into the
 * BrokerRuntimeDeps interface expected by createBrokerRuntime.
 */

import { Result } from "better-result";
import type { BrokerError } from "@xmtp-broker/schemas";
import { InternalError } from "@xmtp-broker/schemas";
import type { BrokerCore, CoreState } from "@xmtp-broker/contracts";
import { createKeyManager, type KeyManager } from "@xmtp-broker/keys";
import type { KeyManagerConfig } from "@xmtp-broker/keys";
import {
  BrokerCoreImpl,
  BrokerCoreConfigSchema,
  createSdkClientFactory,
  createConversationActions,
  type BrokerState,
  type SignerProviderFactory,
} from "@xmtp-broker/core";
import { createSignerProvider } from "@xmtp-broker/keys";
import {
  createSessionManager as createSessionManagerImpl,
  createSessionService,
} from "@xmtp-broker/sessions";
import { createAttestationManager as createAttestationManagerImpl } from "@xmtp-broker/attestations";
import type { InputResolver } from "@xmtp-broker/attestations";
import {
  createWsServer as createWsServerImpl,
  type WsServer,
  type WsServerDeps,
} from "@xmtp-broker/ws";
import { createAdminServer as createAdminServerImpl } from "./admin/server.js";
import type { AdminServer, AdminServerDeps } from "./admin/server.js";
import type { AdminServerConfig } from "./config/schema.js";
import type { BrokerRuntimeDeps } from "./runtime.js";
import { createWsRequestHandler } from "./ws/request-handler.js";
import { createLazyCoreUpgrade } from "./ws/core-upgrade.js";

/** Map BrokerCoreImpl states to the contract's CoreState. */
function mapBrokerState(state: BrokerState): CoreState {
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
 * Create production BrokerRuntimeDeps wired with real implementations.
 *
 * Each factory function receives the exact shape passed by
 * createBrokerRuntime -- the `unknown` params are narrowed here
 * to the concrete types each package expects.
 */
export function createProductionDeps(): BrokerRuntimeDeps {
  // Hold references so downstream factories can access shared instances
  let keyManagerRef: KeyManager | null = null;
  let coreImplRef: BrokerCoreImpl | null = null;

  return {
    async createKeyManager(
      config: unknown,
    ): Promise<Result<KeyManager, BrokerError>> {
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

    createBrokerCore(
      config: unknown,
      _signerFactory: unknown,
      _clientFactory: unknown,
    ): BrokerCore {
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
            "KeyManager not initialized before BrokerCore creation",
          );
        }
        return createSignerProvider(keyManagerRef, identityId);
      };

      const clientFactory = createSdkClientFactory();

      // Parse through schema so defaults (heartbeatIntervalMs, etc.) are applied
      const coreConfig = BrokerCoreConfigSchema.parse({
        dataDir: cfg.dataDir,
        env: cfg.env,
        identityMode: cfg.identityMode,
      });

      const impl = new BrokerCoreImpl(
        coreConfig,
        signerProviderFactory,
        clientFactory,
      );
      coreImplRef = impl;

      // Adapt BrokerCoreImpl (start/stop) to BrokerCore contract
      // (initialize/shutdown) with state name mapping
      return {
        get state(): CoreState {
          return mapBrokerState(impl.state);
        },
        async initializeLocal(): Promise<Result<void, BrokerError>> {
          return impl.startLocal();
        },
        async initialize(): Promise<Result<void, BrokerError>> {
          return impl.start();
        },
        async shutdown(): Promise<Result<void, BrokerError>> {
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
            import("@xmtp-broker/contracts").GroupInfo,
            BrokerError
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

    createAttestationManager(_deps: unknown) {
      // The runtime passes {} for deps. The real attestation manager
      // needs signer, publisher, and resolveInput. For the initial
      // startup these are stubs -- attestation operations happen
      // later when sessions are created and groups are joined.
      const stubSigner: import("@xmtp-broker/contracts").AttestationSigner = {
        async sign(_attestation) {
          return Result.err(
            InternalError.create(
              "AttestationSigner not wired -- no sessions active",
            ),
          );
        },
        async signRevocation(_revocation) {
          return Result.err(
            InternalError.create(
              "AttestationSigner not wired -- no sessions active",
            ),
          );
        },
      };

      const stubPublisher: import("@xmtp-broker/contracts").AttestationPublisher =
        {
          async publish(_groupId, _signed) {
            return Result.err(
              InternalError.create(
                "AttestationPublisher not wired -- no sessions active",
              ),
            );
          },
          async publishRevocation(_groupId, _signed) {
            return Result.err(
              InternalError.create(
                "AttestationPublisher not wired -- no sessions active",
              ),
            );
          },
        };

      const stubResolver: InputResolver = async (_sessionId, _groupId) => {
        return Result.err(
          InternalError.create("InputResolver not wired -- no sessions active"),
        );
      };

      return createAttestationManagerImpl({
        signer: stubSigner,
        publisher: stubPublisher,
        resolveInput: stubResolver,
      });
    },

    createWsServer(config: unknown, deps: unknown): WsServer {
      const cfg = config as { port: number; host: string };
      const d = deps as {
        core: BrokerCore;
        sessionManager: import("@xmtp-broker/contracts").SessionManager;
        attestationManager: import("@xmtp-broker/contracts").AttestationManager;
      };

      // Build the WsServerDeps with tokenLookup and requestHandler
      const ensureCoreReady = createLazyCoreUpgrade(d.core);
      const requestHandler = createWsRequestHandler({
        ensureCoreReady,
        sendMessage: (groupId, contentType, content) =>
          d.core.sendMessage(groupId, contentType, content),
        sessionManager: d.sessionManager,
      });

      const wsDeps: WsServerDeps = {
        core: d.core,
        sessionManager: d.sessionManager,
        attestationManager: d.attestationManager,
        async tokenLookup(token: string) {
          return d.sessionManager.lookupByToken(token);
        },
        requestHandler,
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
          "BrokerCoreImpl not initialized before conversation actions",
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
  };
}
