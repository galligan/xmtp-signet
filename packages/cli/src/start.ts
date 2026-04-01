/**
 * Production dependency factory for the signet runtime.
 *
 * Wires real implementations from each package into the
 * SignetRuntimeDeps interface expected by createSignetRuntime.
 */

import { rm } from "node:fs/promises";
import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import { InternalError } from "@xmtp/signet-schemas";
import type {
  SignetCore,
  CoreState,
  CredentialManager,
} from "@xmtp/signet-contracts";
import {
  createKeyManager,
  createSignerProvider,
  createSealStamper,
  type KeyManager,
} from "@xmtp/signet-keys";
import type { KeyManagerConfig } from "@xmtp/signet-keys";
import { Database } from "bun:sqlite";
import {
  SignetCoreImpl,
  SignetCoreConfigSchema,
  createSdkClientFactory,
  createConsentActions,
  createConversationActions,
  createInboxActions as createInboxActionSpecs,
  createMessageActions,
  createSearchActions,
  createSqliteIdMappingStore,
  type InboxActionDeps,
  type SignetState,
  type SignerProviderFactory,
} from "@xmtp/signet-core";
import {
  createCredentialManager as createCredentialManagerImpl,
  createCredentialService,
  createOperatorManager as createOperatorManagerImpl,
  createPolicyManager as createPolicyManagerImpl,
  type InternalCredentialManager,
} from "@xmtp/signet-sessions";
import type { PolicyManager } from "@xmtp/signet-contracts";
import { createSealManager as createSealManagerImpl } from "@xmtp/signet-seals";
import { createSealPublisher } from "@xmtp/signet-seals";
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
import { createSealActions as createSealActionSpecs } from "./actions/seal-actions.js";
import { createWsRequestHandler } from "./ws/request-handler.js";
import { createLazyCoreUpgrade } from "./ws/core-upgrade.js";
import { createEventProjector } from "./ws/event-projector.js";
import { createPendingActionStore } from "@xmtp/signet-sessions";
import { startManagedInviteHostListener } from "./invite-host-listener.js";
import { createSealInputResolver } from "./seal-input-resolver.js";

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
  let credentialManagerRef: CredentialManager | null = null;
  // Late-bound WS server ref for credential invalidation callbacks
  let globalWsServerRef: WsServer | null = null;
  // Late-bound seal manager ref for revocation publishing
  let globalSealManagerRef:
    | import("@xmtp/signet-contracts").SealManager
    | null = null;
  // Late-bound policy manager ref for credential service wiring
  let policyManagerRef: PolicyManager | null = null;
  // Late-bound operator manager ref for seal input resolution
  let operatorManagerRef:
    | import("@xmtp/signet-contracts").OperatorManager
    | null = null;
  // Lazy-initialized ID mapping store for conv_ boundary
  let idMappingStoreRef: import("@xmtp/signet-schemas").IdMappingStore | null =
    null;
  // In-memory invite tag store: groupId -> inviteTag (v1 single-process)
  const inviteTagStore = new Map<string, string>();
  // Track invite host listener unsubscribe for cleanup
  let inviteHostUnsub: (() => void) | null = null;

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

      const service = createCredentialService(
        policyManagerRef
          ? { manager: internal, policyManager: policyManagerRef }
          : { manager: internal },
      );
      credentialManagerRef = service;
      return service;
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

      if (!operatorManagerRef) {
        throw new Error(
          "OperatorManager not initialized before seal input resolver",
        );
      }

      const resolveInput = createSealInputResolver({
        credentialManager: d.credentialManager,
        operatorManager: operatorManagerRef,
        trustTier: keyManagerRef?.trustTier ?? "unverified",
      });

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

    createOperatorManager() {
      const om = createOperatorManagerImpl({
        revokeCredentials(operatorId, reason) {
          if (!internalCredentialManagerRef) {
            return Result.ok(undefined);
          }
          internalCredentialManagerRef.revokeAllCredentials(operatorId, reason);
          return Result.ok(undefined);
        },
      });
      operatorManagerRef = om;
      return om;
    },

    createPolicyManager() {
      const pm = createPolicyManagerImpl();
      policyManagerRef = pm;
      return pm;
    },

    createInboxActions() {
      if (coreImplRef === null) {
        throw new Error("SignetCoreImpl not initialized before inbox actions");
      }

      if (!idMappingStoreRef) {
        const dbPath =
          coreImplRef.config.dataDir === ":memory:"
            ? ":memory:"
            : `${coreImplRef.config.dataDir}/id-mappings.db`;
        idMappingStoreRef = createSqliteIdMappingStore(new Database(dbPath));
      }

      const core = coreImplRef;
      const inboxActionDeps: InboxActionDeps = {
        identityStore: core.identityStore,
        idMappings: idMappingStoreRef,
        registerInbox: (input) => core.registerManagedIdentity(input),
        cleanupInbox: async (identity, execute) => {
          const actions: string[] = [];
          if (core.getManagedClient(identity.id)) {
            actions.push("stop client");
          }

          let dbBase: string | null = null;
          if (core.config.dataDir !== ":memory:") {
            dbBase = `${core.config.dataDir}/db/${core.config.env}/${identity.id}.db3`;
            actions.push("delete db");
          }

          if (!execute) {
            return Result.ok(actions);
          }

          const detached = await core.detachManagedIdentity(identity.id);
          if (Result.isError(detached)) {
            return detached;
          }

          if (dbBase !== null) {
            await rm(dbBase, { force: true });
            await rm(`${dbBase}-shm`, { force: true });
            await rm(`${dbBase}-wal`, { force: true });
          }

          return Result.ok(actions);
        },
      };

      if (operatorManagerRef) {
        return createInboxActionSpecs({
          ...inboxActionDeps,
          operatorManager: operatorManagerRef,
        });
      }

      return createInboxActionSpecs(inboxActionDeps);
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
      const core = coreImplRef;
      const km = keyManagerRef;
      const signerProviderFactory: SignerProviderFactory = (
        identityId: string,
      ) => createSignerProvider(km, identityId);

      // Lazily create the ID mapping store on the same dataDir
      if (!idMappingStoreRef) {
        const dbPath =
          core.config.dataDir === ":memory:"
            ? ":memory:"
            : `${core.config.dataDir}/id-mappings.db`;
        idMappingStoreRef = createSqliteIdMappingStore(new Database(dbPath));
      }

      const actions = createConversationActions({
        identityStore: core.identityStore,
        getManagedClient: (id) => core.getManagedClient(id),
        getManagedClientForGroup: (groupId) =>
          core.getManagedClientForGroup(groupId),
        getGroupInfo: (groupId: string) => core.context.getGroupInfo(groupId),
        clientFactory: createSdkClientFactory(),
        signerProviderFactory,
        config: core.config,
        idMappings: idMappingStoreRef,
        storeInviteTag: (groupId, tag) => inviteTagStore.set(groupId, tag),
        getInviteTag: (groupId) => inviteTagStore.get(groupId),
        cleanupLocalState: async ({ chatId, groupId, execute }) => {
          const actions: string[] = [];
          const matchChatIds = [groupId];
          if (chatId && !matchChatIds.includes(chatId)) {
            matchChatIds.push(chatId);
          }

          // Resolve network ↔ local IDs so credential/seal matching works
          // regardless of whether the caller passed a network groupId or local conv_ ID.
          if (idMappingStoreRef) {
            for (const candidate of [groupId, chatId].filter(
              Boolean,
            ) as string[]) {
              const mapped = idMappingStoreRef.resolve(candidate);
              if (mapped) {
                for (const resolved of [mapped.localId, mapped.networkId]) {
                  if (!matchChatIds.includes(resolved)) {
                    matchChatIds.push(resolved);
                  }
                }
              }
            }
          }

          let matchingCredentialIds: string[] = [];
          if (credentialManagerRef) {
            const credentialsResult = await credentialManagerRef.list();
            if (Result.isError(credentialsResult)) {
              return credentialsResult;
            }

            matchingCredentialIds = credentialsResult.value
              .filter((credential) =>
                credential.config.chatIds.some((id) =>
                  matchChatIds.includes(id),
                ),
              )
              .map((credential) => credential.credentialId);

            for (const credentialId of matchingCredentialIds) {
              actions.push(`revoke credential ${credentialId}`);
            }
          }

          if (globalSealManagerRef) {
            for (const credentialId of matchingCredentialIds) {
              for (const candidateChatId of matchChatIds) {
                const currentSealResult = await globalSealManagerRef.current(
                  credentialId,
                  candidateChatId,
                );
                if (Result.isError(currentSealResult)) {
                  return currentSealResult;
                }
                const sealId = currentSealResult.value?.chain.current.sealId;
                if (sealId) {
                  actions.push(`revoke seal ${sealId}`);
                }
              }
            }
          }

          const mapping =
            (chatId ? idMappingStoreRef?.resolve(chatId) : null) ??
            idMappingStoreRef?.resolve(groupId) ??
            null;
          if (mapping) {
            actions.push(
              `remove mapping ${mapping.localId} <-> ${mapping.networkId}`,
            );
          }

          const boundIdentity = await core.identityStore.getByGroupId(groupId);
          if (boundIdentity) {
            actions.push(`remove identity ${boundIdentity.id}`);
            if (core.config.dataDir !== ":memory:") {
              const dbPath = `${core.config.dataDir}/db/${core.config.env}/${boundIdentity.id}.db3`;
              actions.push(`delete db ${dbPath}`);
            }
          }

          if (!execute) {
            return Result.ok({ executed: false, actions });
          }

          for (const credentialId of matchingCredentialIds) {
            const revokeResult = await credentialManagerRef?.revoke(
              credentialId,
              "owner-initiated",
            );
            if (revokeResult && Result.isError(revokeResult)) {
              return revokeResult;
            }
          }

          if (mapping) {
            idMappingStoreRef?.remove(mapping.localId);
          }

          core.forgetGroup(groupId);

          if (boundIdentity) {
            core.unregisterManagedClient(boundIdentity.id);
            const removeIdentityResult = await core.identityStore.remove(
              boundIdentity.id,
            );
            if (Result.isError(removeIdentityResult)) {
              return removeIdentityResult;
            }

            if (core.config.dataDir !== ":memory:") {
              const dbBase = `${core.config.dataDir}/db/${core.config.env}/${boundIdentity.id}.db3`;
              await rm(dbBase, { force: true });
              await rm(`${dbBase}-shm`, { force: true });
              await rm(`${dbBase}-wal`, { force: true });
            }
          }

          return Result.ok({ executed: true, actions });
        },
      });

      // Start the invite host listener (v1: single identity, in-process).
      // Wired here because all deps are available after conversation actions
      // are created. The listener resolves the matching managed identity at
      // message time so multi-identity invite links work without a restart.
      if (!inviteHostUnsub) {
        const core = coreImplRef;
        const spf = signerProviderFactory;
        inviteHostUnsub = startManagedInviteHostListener({
          subscribe: (handler) => core.on(handler),
          listIdentities: () => core.identityStore.list(),
          getWalletPrivateKeyHex: async (identityId) => {
            const signer = spf(identityId);
            const keyResult = await signer.getXmtpIdentityKey(identityId);
            if (Result.isError(keyResult)) return keyResult;
            return Result.ok(keyResult.value);
          },
          getManagedClient: (identityId) => {
            const managed = core.getManagedClient(identityId);
            if (!managed) return undefined;
            return {
              addMembers: (groupId, inboxIds) =>
                managed.client.addMembers(groupId, inboxIds as string[]),
            };
          },
          getGroupInviteTag: async (groupId) =>
            Result.ok(inviteTagStore.get(groupId)),
        });
      }

      return actions;
    },

    createSealActions() {
      if (globalSealManagerRef === null) {
        throw new Error("SealManager not initialized before seal actions");
      }

      return createSealActionSpecs({
        sealManager: globalSealManagerRef,
        async resolveSealPublicKey(envelope) {
          if (keyManagerRef === null || coreImplRef === null) {
            return Result.ok(null);
          }

          const identity = await coreImplRef.identityStore.getByGroupId(
            envelope.chain.current.chatId,
          );
          if (!identity) {
            return Result.ok(null);
          }

          const operationalKey = keyManagerRef.getOperationalKey(identity.id);
          if (Result.isError(operationalKey)) {
            return Result.ok(null);
          }

          const keyRefCandidates = new Set([
            operationalKey.value.publicKey,
            operationalKey.value.fingerprint,
          ]);

          return Result.ok(
            keyRefCandidates.has(envelope.keyId)
              ? operationalKey.value.publicKey
              : null,
          );
        },
      });
    },

    createMessageActions() {
      if (coreImplRef === null) {
        throw new Error(
          "SignetCoreImpl not initialized before message actions",
        );
      }

      // Lazily create the ID mapping store on the same dataDir
      if (!idMappingStoreRef) {
        const dbPath =
          coreImplRef.config.dataDir === ":memory:"
            ? ":memory:"
            : `${coreImplRef.config.dataDir}/id-mappings.db`;
        idMappingStoreRef = createSqliteIdMappingStore(new Database(dbPath));
      }

      return createMessageActions({
        identityStore: coreImplRef.identityStore,
        getManagedClient: (id) => coreImplRef!.getManagedClient(id),
        idMappings: idMappingStoreRef,
      });
    },

    createConsentActions() {
      if (coreImplRef === null) {
        throw new Error(
          "SignetCoreImpl not initialized before consent actions",
        );
      }

      return createConsentActions({
        identityStore: coreImplRef.identityStore,
        getManagedClient: (id) => coreImplRef!.getManagedClient(id),
        getManagedClientForGroup: (groupId) =>
          coreImplRef!.getManagedClientForGroup(groupId),
      });
    },

    createSearchActions() {
      if (coreImplRef === null) {
        throw new Error("SignetCoreImpl not initialized before search actions");
      }

      // Lazily create the ID mapping store on the same dataDir
      if (!idMappingStoreRef) {
        const dbPath =
          coreImplRef.config.dataDir === ":memory:"
            ? ":memory:"
            : `${coreImplRef.config.dataDir}/id-mappings.db`;
        idMappingStoreRef = createSqliteIdMappingStore(new Database(dbPath));
      }

      const searchDeps: import("@xmtp/signet-core").SearchActionDeps = {
        identityStore: coreImplRef.identityStore,
        getManagedClient: (id) => coreImplRef!.getManagedClient(id),
        idMappings: idMappingStoreRef,
        ...(operatorManagerRef ? { operatorManager: operatorManagerRef } : {}),
        ...(policyManagerRef ? { policyManager: policyManagerRef } : {}),
        ...(credentialManagerRef
          ? { credentialManager: credentialManagerRef }
          : {}),
      };

      return createSearchActions(searchDeps);
    },

    async listIdentities() {
      if (coreImplRef === null) return [];
      return coreImplRef.identityStore.list();
    },
  };
}
