/**
 * Test runtime that wires all Phase 1 packages with mock XMTP.
 *
 * Provides a fully composed broker runtime for integration tests
 * without any network dependencies.
 */

import { Result } from "better-result";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { BrokerError } from "@xmtp-broker/schemas";
import type {
  AttestationPublisher,
  SignedAttestation,
  SignedRevocationEnvelope,
} from "@xmtp-broker/contracts";
import { BrokerCoreImpl } from "@xmtp-broker/core";
import type { XmtpDecodedMessage, XmtpGroupEvent } from "@xmtp-broker/core";
import { createSessionManager } from "@xmtp-broker/sessions";
import type {
  InternalSessionManager,
  SessionManagerConfig,
} from "@xmtp-broker/sessions";
import { createKeyManager } from "@xmtp-broker/keys";
import type { KeyManager } from "@xmtp-broker/keys";
import { createSignerProvider } from "@xmtp-broker/keys";
import { createAttestationSigner } from "@xmtp-broker/keys";
import {
  createAttestationManager,
  type AttestationManagerDeps,
} from "@xmtp-broker/attestations";
import type { AttestationManagerImpl } from "@xmtp-broker/attestations";
import { createWsServer } from "@xmtp-broker/ws";
import type { WsServer, WsServerConfig } from "@xmtp-broker/ws";
import {
  createMockXmtpClientFactory,
  type MockXmtpClientFactory,
} from "./mock-xmtp-factory.js";

/** In-memory attestation publisher that records publications. */
function createTestPublisher(): AttestationPublisher & {
  readonly published: ReadonlyArray<{
    groupId: string;
    attestation: SignedAttestation;
  }>;
  readonly revokedPublished: ReadonlyArray<{
    groupId: string;
    revocation: SignedRevocationEnvelope;
  }>;
} {
  const published: Array<{
    groupId: string;
    attestation: SignedAttestation;
  }> = [];
  const revokedPublished: Array<{
    groupId: string;
    revocation: SignedRevocationEnvelope;
  }> = [];

  return {
    get published() {
      return published;
    },
    get revokedPublished() {
      return revokedPublished;
    },
    async publish(groupId, attestation) {
      published.push({ groupId, attestation });
      return Result.ok(undefined);
    },
    async publishRevocation(groupId, revocation) {
      revokedPublished.push({ groupId, revocation });
      return Result.ok(undefined);
    },
  };
}

export interface TestRuntime {
  readonly keyManager: KeyManager;
  readonly broker: BrokerCoreImpl;
  readonly sessionManager: InternalSessionManager;
  readonly attestationManager: AttestationManagerImpl;
  readonly publisher: ReturnType<typeof createTestPublisher>;
  readonly wsServer: WsServer;
  readonly wsPort: number;
  readonly dataDir: string;
  readonly factory: MockXmtpClientFactory;
  /** The identity ID created in the store. */
  readonly identityId: string;
  /** The test group ID. */
  readonly groupId: string;
}

export interface TestRuntimeOptions {
  readonly wsConfig?: Partial<WsServerConfig>;
  readonly sessionConfig?: Partial<SessionManagerConfig>;
  readonly groupId?: string;
  /** Skip starting broker and WS server (for unit-level tests). */
  readonly skipStart?: boolean;
}

export async function createTestRuntime(options?: TestRuntimeOptions): Promise<{
  runtime: TestRuntime;
  streams: {
    emitMessage: (msg: XmtpDecodedMessage) => void;
    emitGroupEvent: (event: XmtpGroupEvent) => void;
  };
  cleanup: () => Promise<void>;
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "xmtp-broker-test-"));
  const groupId = options?.groupId ?? "test-group";

  // 1. Key manager
  const kmResult = await createKeyManager({ dataDir });
  if (Result.isError(kmResult)) {
    throw new Error(`Failed to create key manager: ${kmResult.error.message}`);
  }
  const keyManager = kmResult.value;

  // Initialize root key
  const rootResult = await keyManager.initialize();
  if (Result.isError(rootResult)) {
    throw new Error(
      `Failed to initialize root key: ${rootResult.error.message}`,
    );
  }

  // 2. Create broker with in-memory identity store
  // We need the identity store to create an identity and get back its ID
  // before creating the operational key.

  // 2a. Mock XMTP factory - we need this before creating broker
  const { factory, streams } = createMockXmtpClientFactory({
    groups: [
      {
        groupId,
        name: "Test Group",
        description: "Integration test group",
        memberInboxIds: [],
        createdAt: new Date().toISOString(),
      },
    ],
  });

  // 2b. Signer provider factory for BrokerCore
  const signerProviderFactory = (id: string) =>
    createSignerProvider(keyManager, id);

  // 2c. Broker core
  const broker = new BrokerCoreImpl(
    {
      dataDir,
      env: "dev",
      identityMode: "per-group",
      heartbeatIntervalMs: 60_000, // long to avoid noise in tests
      syncTimeoutMs: 5_000,
      appVersion: "test/0.1.0",
    },
    signerProviderFactory,
    factory,
  );

  // 2d. Create identity in the store, get back its generated ID
  const identityResult = await broker.identityStore.create(groupId);
  if (identityResult.isErr()) {
    throw new Error(
      `Failed to create identity: ${identityResult.error.message}`,
    );
  }
  const identityId = identityResult.value.id;

  // 3. Create operational key for this identity
  const opKeyResult = await keyManager.createOperationalKey(
    identityId,
    groupId,
  );
  if (Result.isError(opKeyResult)) {
    throw new Error(
      `Failed to create operational key: ${opKeyResult.error.message}`,
    );
  }

  // 4. Session manager
  const sessionManager = createSessionManager({
    defaultTtlSeconds: 300,
    heartbeatGracePeriod: 5,
    ...options?.sessionConfig,
  });

  // 5. Attestation manager
  const attestationSigner = createAttestationSigner(keyManager, identityId);
  const publisher = createTestPublisher();

  const attestationDeps: AttestationManagerDeps = {
    signer: attestationSigner,
    publisher,
    resolveInput: async (sessionId, gId) => {
      const session = sessionManager.getSessionById(sessionId);
      if (!session.isOk()) {
        return Result.err(session.error as BrokerError);
      }
      const s = session.value;
      return Result.ok({
        agentInboxId: s.agentInboxId,
        ownerInboxId: "owner-inbox",
        groupId: gId,
        threadScope: null,
        view: s.view,
        grant: s.grant,
        inferenceMode: "local",
        inferenceProviders: [],
        contentEgressScope: "none",
        retentionAtProvider: "none",
        hostingMode: "self-hosted",
        trustTier: keyManager.trustTier,
        buildProvenanceRef: null,
        verifierStatementRef: null,
        sessionKeyFingerprint: s.sessionKeyFingerprint,
        policyHash: s.policyHash,
        heartbeatInterval: s.heartbeatInterval,
        revocationRules: {
          maxTtlSeconds: 86400,
          requireHeartbeat: true,
          ownerCanRevoke: true,
          adminCanRemove: true,
        },
        issuer: `inbox_${identityId}`,
      });
    },
  };
  const attestationManager = createAttestationManager(attestationDeps);

  // 6. Token lookup for WS
  const tokenLookup = async (token: string) => {
    const result = sessionManager.getSessionByToken(token);
    if (!result.isOk()) {
      return Result.err(result.error as BrokerError);
    }
    const s = result.value;
    return Result.ok({
      sessionId: s.sessionId,
      agentInboxId: s.agentInboxId,
      sessionKeyFingerprint: s.sessionKeyFingerprint,
      view: s.view,
      grant: s.grant,
      state: s.state,
      issuedAt: s.issuedAt,
      expiresAt: s.expiresAt,
      lastHeartbeat: s.lastHeartbeat,
    });
  };

  // 7. Request handler
  const requestHandler = async (
    request: { type: string; requestId: string; [k: string]: unknown },
    _session: unknown,
  ) => {
    if (request.type === "heartbeat") {
      const hbResult = sessionManager.recordHeartbeat(
        request["sessionId"] as string,
      );
      if (!hbResult.isOk()) {
        return Result.err(hbResult.error as BrokerError);
      }
      return Result.ok({ acknowledged: true });
    }
    if (request.type === "send_message") {
      return Result.ok({ messageId: `msg_${crypto.randomUUID()}` });
    }
    return Result.ok({ acknowledged: true });
  };

  // 8. WS server
  const wsServer = createWsServer(
    {
      port: 0,
      authTimeoutMs: 2_000,
      heartbeatIntervalMs: 60_000,
      ...options?.wsConfig,
    },
    {
      core: {
        get state() {
          return broker.state === "running"
            ? ("ready" as const)
            : ("uninitialized" as const);
        },
        async initializeLocal() {
          return Result.ok(undefined);
        },
        async initialize() {
          return broker.start();
        },
        async shutdown() {
          return broker.stop();
        },
        async sendMessage(groupId, contentType, content) {
          return broker.context.sendMessage(groupId, contentType, content);
        },
        async getGroupInfo(gId) {
          return Result.ok({
            groupId: gId,
            identityKeyFingerprint: "test-fingerprint",
            memberInboxIds: [] as readonly string[],
            createdAt: new Date().toISOString(),
          });
        },
      },
      sessionManager: {
        async issue(config) {
          const skResult = await keyManager.issueSessionKey(
            "session-placeholder",
            300,
          );
          if (!skResult.isOk()) {
            return Result.err(skResult.error as BrokerError);
          }
          const fp = skResult.value.fingerprint;
          const result = await sessionManager.createSession(config, fp);
          if (!result.isOk()) {
            return Result.err(result.error as BrokerError);
          }
          return Result.ok({
            token: result.value.token,
            session: {
              sessionId: result.value.sessionId,
              agentInboxId: result.value.agentInboxId,
              sessionKeyFingerprint: result.value.sessionKeyFingerprint,
              issuedAt: result.value.issuedAt,
              expiresAt: result.value.expiresAt,
            },
          });
        },
        async list(agentInboxId) {
          const sessions = sessionManager.listSessions(agentInboxId);
          return Result.ok(
            sessions.map((session) => ({
              sessionId: session.sessionId,
              agentInboxId: session.agentInboxId,
              sessionKeyFingerprint: session.sessionKeyFingerprint,
              view: session.view,
              grant: session.grant,
              state: session.state,
              issuedAt: session.issuedAt,
              expiresAt: session.expiresAt,
              lastHeartbeat: session.lastHeartbeat,
            })),
          );
        },
        async lookup(sessionId) {
          const result = sessionManager.getSessionById(sessionId);
          if (!result.isOk()) {
            return Result.err(result.error as BrokerError);
          }
          const s = result.value;
          return Result.ok({
            sessionId: s.sessionId,
            agentInboxId: s.agentInboxId,
            sessionKeyFingerprint: s.sessionKeyFingerprint,
            view: s.view,
            grant: s.grant,
            state: s.state,
            issuedAt: s.issuedAt,
            expiresAt: s.expiresAt,
            lastHeartbeat: s.lastHeartbeat,
          });
        },
        async lookupByToken(token) {
          const result = sessionManager.getSessionByToken(token);
          if (!result.isOk()) {
            return Result.err(result.error as BrokerError);
          }
          const s = result.value;
          return Result.ok({
            sessionId: s.sessionId,
            agentInboxId: s.agentInboxId,
            sessionKeyFingerprint: s.sessionKeyFingerprint,
            view: s.view,
            grant: s.grant,
            state: s.state,
            issuedAt: s.issuedAt,
            expiresAt: s.expiresAt,
            lastHeartbeat: s.lastHeartbeat,
          });
        },
        async revoke(sessionId, reason) {
          const result = sessionManager.revokeSession(sessionId, reason);
          if (!result.isOk()) {
            return Result.err(result.error as BrokerError);
          }
          return Result.ok(undefined);
        },
        async heartbeat(sessionId) {
          const result = sessionManager.recordHeartbeat(sessionId);
          if (!result.isOk()) {
            return Result.err(result.error as BrokerError);
          }
          return Result.ok(undefined);
        },
        async isActive(sessionId) {
          const result = sessionManager.getSessionById(sessionId);
          if (!result.isOk()) {
            return Result.err(result.error as BrokerError);
          }
          return Result.ok(result.value.state === "active");
        },
      },
      attestationManager,
      tokenLookup,
      requestHandler,
    },
  );

  let wsPort = 0;

  if (!options?.skipStart) {
    // Start broker
    const startResult = await broker.start();
    if (startResult.isErr()) {
      throw new Error(`Failed to start broker: ${startResult.error.message}`);
    }

    // Start WS server
    const wsStartResult = await wsServer.start();
    if (wsStartResult.isErr()) {
      throw new Error(
        `Failed to start WS server: ${wsStartResult.error.message}`,
      );
    }
    wsPort = wsStartResult.value.port;
  }

  const runtime: TestRuntime = {
    keyManager,
    broker,
    sessionManager,
    attestationManager,
    publisher,
    wsServer,
    wsPort,
    dataDir,
    factory,
    identityId,
    groupId,
  };

  return {
    runtime,
    streams,
    cleanup: async () => {
      await wsServer.stop().catch(() => {});
      await broker.stop().catch(() => {});
      keyManager.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** Create default view and grant configs for tests. */
export function createTestViewAndGrant() {
  const view = {
    mode: "full" as const,
    threadScopes: [{ groupId: "test-group", threadId: null }],
    contentTypes: [
      "xmtp.org/text:1.0",
      "xmtp.org/reaction:1.0",
      "xmtp.org/reply:1.0",
    ],
  };

  const grant = {
    messaging: {
      send: true,
      reply: true,
      react: true,
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
  };

  return { view, grant };
}

/** Issue a session with default view/grant and return the token. */
export async function issueTestSession(
  runtime: TestRuntime,
  overrides?: {
    agentInboxId?: string;
    view?: Record<string, unknown>;
    grant?: Record<string, unknown>;
    ttlSeconds?: number;
  },
): Promise<{ token: string; sessionId: string }> {
  const { view, grant } = createTestViewAndGrant();
  const agentInboxId = overrides?.agentInboxId ?? `inbox_${runtime.identityId}`;

  const skResult = await runtime.keyManager.issueSessionKey(
    "session-test",
    overrides?.ttlSeconds ?? 300,
  );
  if (!skResult.isOk()) {
    throw new Error(
      `Failed to issue session key: ${skResult.error.message}`,
    );
  }
  const fp = skResult.value.fingerprint;

  const result = await runtime.sessionManager.createSession(
    {
      agentInboxId,
      view: (overrides?.view as typeof view) ?? view,
      grant: (overrides?.grant as typeof grant) ?? grant,
      ttlSeconds: overrides?.ttlSeconds ?? 300,
    },
    fp,
  );

  if (!result.isOk()) {
    throw new Error(`Failed to create session: ${result.error.message}`);
  }

  return { token: result.value.token, sessionId: result.value.sessionId };
}
