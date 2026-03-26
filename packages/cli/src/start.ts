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
import {
  createKeyManager,
  createSignerProvider,
  createSealStamper,
  type KeyManager,
} from "@xmtp/signet-keys";
import type { KeyManagerConfig } from "@xmtp/signet-keys";
import {
  SignetCoreImpl,
  SignetCoreConfigSchema,
  createSdkClientFactory,
  createConversationActions,
  type SignetState,
  type SignerProviderFactory,
} from "@xmtp/signet-core";
import {
  createCredentialManager as createCredentialManagerImpl,
  createCredentialService,
  type InternalCredentialManager,
} from "@xmtp/signet-sessions";
import { createSealManager as createSealManagerImpl } from "@xmtp/signet-seals";
import { createSealPublisher } from "@xmtp/signet-seals";
import type { InputResolver } from "@xmtp/signet-seals";
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
  let internalCredentialManagerRef: InternalCredentialManager | null = null;
  // Late-bound WS server ref for credential invalidation callbacks
  let globalWsServerRef: WsServer | null = null;
  // Late-bound seal manager ref for revocation publishing
  let globalSealManagerRef:
    | import("@xmtp/signet-contracts").SealManager
    | null = null;

  return {
    async createKeyManager(
      config: unknown,
    ): Promise<Result<KeyManager, SignetError>> {
      const cfg = config as {
        platform: string;
        rootKeyPolicy: KeyManagerConfig["rootKeyPolicy"];
        operationalKeyPolicy: KeyManagerConfig["operationalKeyPolicy"];
        vaultKeyPolicy: KeyManagerConfig["vaultKeyPolicy"];
        biometricGating: KeyManagerConfig["biometricGating"];
        dataDir: string;
      };
      const result = await createKeyManager({
        rootKeyPolicy: cfg.rootKeyPolicy,
        operationalKeyPolicy: cfg.operationalKeyPolicy,
        vaultKeyPolicy: cfg.vaultKeyPolicy,
        biometricGating: cfg.biometricGating,
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

    createCredentialManager(config: unknown, _keyManager: KeyManager) {
      const cfg = config as {
        defaultTtlSeconds: number;
        maxConcurrentPerOperator: number;
      };
      const internal = createCredentialManagerImpl(
        {
          defaultTtlSeconds: cfg.defaultTtlSeconds,
          maxConcurrentPerOperator: cfg.maxConcurrentPerOperator,
        },
        {
          onCredentialMutated(credentialId: string) {
            // Push-invalidate cached credential on live WS connections.
            void globalWsServerRef?.invalidateCredential(credentialId);
          },
          onCredentialRevoked(credential) {
            // Trigger seal revocation publishing when a credential is revoked.
            if (!globalSealManagerRef) return;
            const sealMgr = globalSealManagerRef;

            // Map credential revocation reason to agent revocation reason.
            const reasonMap: Record<
              string,
              import("@xmtp/signet-schemas").AgentRevocationReason
            > = {
              "owner-initiated": "owner-initiated",
              "credential-expired": "credential-expired",
              "heartbeat-timeout": "heartbeat-timeout",
              "policy-violation": "policy-violation",
              "reauthorization-required": "admin-removed",
            };
            const reason =
              reasonMap[credential.revocationReason ?? ""] ?? "owner-initiated";

            // Extract chat IDs from the credential and revoke seals
            const chatIds = credential.chatIds;

            void (async () => {
              for (const chatId of chatIds) {
                try {
                  const sealResult = await sealMgr.current(
                    credential.credentialId,
                    chatId,
                  );
                  if (sealResult.isOk() && sealResult.value !== null) {
                    await sealMgr.revoke(
                      sealResult.value.chain.current.sealId,
                      reason,
                    );
                  }
                } catch {
                  // Best-effort: log failures but don't block revocation
                }
              }
            })();
          },
        },
      );
      internalCredentialManagerRef = internal;

      return createCredentialService({
        manager: internal,
      });
    },

    getInternalCredentialManager() {
      if (!internalCredentialManagerRef) {
        throw new Error("Internal credential manager not initialized");
      }
      return internalCredentialManagerRef;
    },

    createSealManager(deps: unknown) {
      const d = deps as {
        core: SignetCore;
        keyManager: KeyManager;
        credentialManager: import("@xmtp/signet-contracts").CredentialManager;
      };

      // Dynamic stamper: resolves the signing identity from the seal payload's
      // chat binding. Operational keys are keyed by internal identityId, while
      // seals themselves carry operator metadata, so we resolve the XMTP
      // identity associated with the target conversation.
      async function resolveIdentityId(
        groupId: string,
      ): Promise<Result<string, SignetError>> {
        if (!coreImplRef) {
          return Result.err(
            InternalError.create(
              "Core not initialized -- cannot resolve identity",
            ),
          );
        }
        const identity = await coreImplRef.identityStore.getByGroupId(groupId);
        if (!identity) {
          return Result.err(
            InternalError.create(`No identity found for groupId: ${groupId}`),
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
          const idResult = await resolveIdentityId(seal.chatId);
          if (Result.isError(idResult)) return idResult;
          const stamper = createSealStamper(keyManagerRef, idResult.value);
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
          const idResult = await resolveIdentityId(revocation.chatId);
          if (Result.isError(idResult)) return idResult;
          const stamper = createSealStamper(keyManagerRef, idResult.value);
          return stamper.signRevocation(revocation);
        },
      };

      // Real publisher backed by core.sendMessage
      const publisher = createSealPublisher({
        sendMessage: (groupId, contentType, content) =>
          d.core.sendMessage(groupId, contentType, content),
      });

      // InputResolver stub: translating credential policy into SealInput
      // requires aggregating fields from the credential record, config,
      // and key manager that don't have a mapping layer yet.
      const resolveInput: InputResolver = async (_credentialId, _groupId) => {
        return Result.err(
          InternalError.create(
            "InputResolver not yet wired -- credential-to-seal-input mapping pending",
          ),
        );
      };

      const sealManager = createSealManagerImpl({
        signer,
        publisher,
        resolveInput,
      });
      globalSealManagerRef = sealManager;
      return sealManager;
    },

    createWsServer(config: unknown, deps: unknown): WsServer {
      const cfg = config as {
        port: number;
        host: string;
        actionExpirySeconds?: number;
      };
      const d = deps as {
        core: SignetCore;
        credentialManager: import("@xmtp/signet-contracts").CredentialManager;
        sealManager: import("@xmtp/signet-contracts").SealManager;
      };

      const pendingActions = createPendingActionStore();
      const actionExpiryMs = (cfg.actionExpirySeconds ?? 300) * 1000;

      // Late-bound broadcast: the WS server isn't created yet when
      // the request handler is wired, so we capture a mutable ref.
      let wsServerRef: WsServer | null = null;

      // Build the WsServerDeps with tokenLookup and requestHandler
      const ensureCoreReady = createLazyCoreUpgrade(d.core);
      const requestHandlerDeps = {
        ensureCoreReady,
        sendMessage: (groupId: string, contentType: string, content: unknown) =>
          d.core.sendMessage(groupId, contentType, content),
        credentialManager: d.credentialManager,
        sealManager: d.sealManager,
        pendingActions,
        actionExpiryMs,
        onActionExpired: (action: {
          actionId: string;
          credentialId: string;
          actionType: string;
          createdAt: string;
          expiresAt: string;
        }) => {
          // eslint-disable-next-line no-console
          console.info(
            "[audit] action expired: %s (%s) credential=%s created=%s expired=%s",
            action.actionId,
            action.actionType,
            action.credentialId,
            action.createdAt,
            action.expiresAt,
          );
        },
        broadcast: (credentialId: string, event: unknown) => {
          wsServerRef?.broadcast(
            credentialId,
            event as import("@xmtp/signet-schemas").SignetEvent,
          );
        },
        listMessages: async (
          groupId: string,
          options?: {
            limit?: number;
            before?: string;
            after?: string;
            direction?: "ascending" | "descending";
          },
        ) => {
          if (!coreImplRef) {
            return Result.err(
              InternalError.create(
                "Core not initialized -- cannot list messages",
              ),
            );
          }
          return coreImplRef.context.listMessages(groupId, options);
        },
      };
      // Only add internalCredentialManager when available (exactOptionalPropertyTypes)
      if (internalCredentialManagerRef) {
        Object.assign(requestHandlerDeps, {
          internalCredentialManager: internalCredentialManagerRef,
        });
      }
      const requestHandler = createWsRequestHandler(requestHandlerDeps);

      const projector = createEventProjector({
        getRevealState(
          credentialId: string,
        ): import("@xmtp/signet-contracts").RevealStateStore | null {
          if (!internalCredentialManagerRef) return null;
          const result =
            internalCredentialManagerRef.getRevealState(credentialId);
          return Result.isOk(result) ? result.value : null;
        },
      });

      const wsDeps: WsServerDeps = {
        core: d.core,
        sealManager: d.sealManager,
        async credentialLookup(
          credentialId: string,
        ): Promise<
          Result<import("@xmtp/signet-contracts").CredentialRecord, SignetError>
        > {
          return d.credentialManager.lookup(credentialId);
        },
        async tokenLookup(
          token: string,
        ): Promise<
          Result<import("@xmtp/signet-contracts").CredentialRecord, SignetError>
        > {
          return d.credentialManager.lookupByToken(token);
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
