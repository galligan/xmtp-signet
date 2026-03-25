/**
 * Test runtime that wires the v1 credential/seal stack with mock XMTP.
 *
 * Provides a fully composed signet runtime for integration tests
 * without any network dependencies.
 */

import { Result } from "better-result";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  PermissionError,
  type CredentialConfigType,
  type SealEnvelopeType,
  type SignetError,
} from "@xmtp/signet-schemas";
import type {
  CredentialManager,
  SignedRevocationEnvelope,
} from "@xmtp/signet-contracts";
import { SignetCoreImpl } from "@xmtp/signet-core";
import type { XmtpDecodedMessage, XmtpGroupEvent } from "@xmtp/signet-core";
import {
  createCredentialManager,
  createCredentialService,
  type CredentialManagerConfig,
  type InternalCredentialManager,
} from "@xmtp/signet-sessions";
import {
  createKeyManager,
  createSealStamper,
  createSignerProvider,
} from "@xmtp/signet-keys";
import type { KeyManager } from "@xmtp/signet-keys";
import { createSealManager, type SealManagerDeps } from "@xmtp/signet-seals";
import type { SealManagerImpl } from "@xmtp/signet-seals";
import {
  createWsServer,
  type RequestHandler,
  type WsServer,
  type WsServerConfig,
} from "@xmtp/signet-ws";
import {
  createMockXmtpClientFactory,
  type MockXmtpClientFactory,
} from "./mock-xmtp-factory.js";

/** In-memory seal publisher that records publications. */
function createTestPublisher(): {
  readonly published: ReadonlyArray<{
    groupId: string;
    seal: SealEnvelopeType;
  }>;
  readonly revokedPublished: ReadonlyArray<{
    groupId: string;
    revocation: SignedRevocationEnvelope;
  }>;
  publish(
    groupId: string,
    seal: SealEnvelopeType,
  ): Promise<Result<void, SignetError>>;
  publishRevocation(
    groupId: string,
    revocation: SignedRevocationEnvelope,
  ): Promise<Result<void, SignetError>>;
} {
  const published: Array<{
    groupId: string;
    seal: SealEnvelopeType;
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
    async publish(groupId, seal) {
      published.push({ groupId, seal });
      return Result.ok(undefined);
    },
    async publishRevocation(groupId, revocation) {
      revokedPublished.push({ groupId, revocation });
      return Result.ok(undefined);
    },
  };
}

/** Fully composed test runtime for integration tests. */
export interface TestRuntime {
  readonly keyManager: KeyManager;
  readonly signet: SignetCoreImpl;
  readonly credentialManager: InternalCredentialManager;
  readonly credentialService: CredentialManager;
  readonly sealManager: SealManagerImpl;
  readonly publisher: ReturnType<typeof createTestPublisher>;
  readonly wsServer: WsServer;
  readonly wsPort: number;
  readonly dataDir: string;
  readonly factory: MockXmtpClientFactory;
  /** The XMTP identity ID created in the signet store. */
  readonly identityId: string;
  /** The default operator ID used for test credentials. */
  readonly operatorId: string;
  /** The default test group ID. */
  readonly groupId: string;
}

/** Options for constructing the test runtime. */
export interface TestRuntimeOptions {
  readonly wsConfig?: Partial<WsServerConfig>;
  readonly credentialManagerConfig?: Partial<CredentialManagerConfig>;
  readonly groupId?: string;
  /** Skip starting signet and WS server (for unit-level tests). */
  readonly skipStart?: boolean;
}

/** Create a fully wired in-memory signet runtime for integration tests. */
export async function createTestRuntime(options?: TestRuntimeOptions): Promise<{
  runtime: TestRuntime;
  streams: {
    emitMessage: (msg: XmtpDecodedMessage) => void;
    emitGroupEvent: (event: XmtpGroupEvent) => void;
  };
  cleanup: () => Promise<void>;
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "xmtp-signet-test-"));
  const groupId = options?.groupId ?? "conv_1234abcdfeedbabe";

  // 1. Key manager
  const kmResult = await createKeyManager({ dataDir });
  if (Result.isError(kmResult)) {
    throw new Error(`Failed to create key manager: ${kmResult.error.message}`);
  }
  const keyManager = kmResult.value;

  const rootResult = await keyManager.initialize();
  if (Result.isError(rootResult)) {
    throw new Error(
      `Failed to initialize root key: ${rootResult.error.message}`,
    );
  }

  // 2. Mock XMTP factory and signet core
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

  const signerProviderFactory = (id: string) =>
    createSignerProvider(keyManager, id);

  const signet = new SignetCoreImpl(
    {
      dataDir,
      env: "dev",
      identityMode: "per-group",
      heartbeatIntervalMs: 60_000,
      livenessIntervalMs: 120_000,
      syncTimeoutMs: 5_000,
      appVersion: "test/0.1.0",
    },
    signerProviderFactory,
    factory,
  );

  const identityResult = await signet.identityStore.create(groupId);
  if (identityResult.isErr()) {
    throw new Error(
      `Failed to create identity: ${identityResult.error.message}`,
    );
  }
  const identityId = identityResult.value.id;

  const opKeyResult = await keyManager.createOperationalKey(
    identityId,
    groupId,
  );
  if (Result.isError(opKeyResult)) {
    throw new Error(
      `Failed to create operational key: ${opKeyResult.error.message}`,
    );
  }

  // 3. Use a stable operator ID for test credentials.
  const operatorId = "op_deadbeeffeedbabe";

  // 4. Credential manager and public service
  const credentialManager = createCredentialManager({
    defaultTtlSeconds: 300,
    maxConcurrentPerOperator: 3,
    heartbeatGracePeriod: 5,
    ...options?.credentialManagerConfig,
  });
  const credentialService = createCredentialService({
    manager: credentialManager,
  });

  // 5. Seal manager
  const sealStamper = createSealStamper(keyManager, identityId);
  const publisher = createTestPublisher();

  const sealManagerDeps: SealManagerDeps = {
    signer: sealStamper,
    publisher,
    resolveInput: async (credentialId, chatId) => {
      const credential = credentialManager.getCredentialById(credentialId);
      if (!credential.isOk()) {
        return Result.err(credential.error);
      }

      return Result.ok({
        credentialId: credential.value.credentialId,
        operatorId: credential.value.operatorId,
        chatId,
        scopeMode: "shared",
        permissions: credential.value.effectiveScopes,
      });
    },
  };
  const sealManager = createSealManager(sealManagerDeps);

  // 6. WS token and credential lookup
  const tokenLookup = async (token: string) =>
    credentialService.lookupByToken(token);
  const credentialLookup = async (credentialId: string) =>
    credentialService.lookup(credentialId);

  // 7. Request handler
  const requestHandler: RequestHandler = async (request, credential) => {
    if (request.type === "heartbeat") {
      if (request.credentialId !== credential.credentialId) {
        return Result.err(
          PermissionError.create("Heartbeat credential mismatch", {
            requestCredentialId: request.credentialId,
            credentialId: credential.credentialId,
          }),
        );
      }

      const hbResult = credentialManager.recordHeartbeat(request.credentialId);
      if (!hbResult.isOk()) {
        return Result.err(hbResult.error);
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
          return signet.state === "running"
            ? ("ready" as const)
            : ("uninitialized" as const);
        },
        async initializeLocal() {
          return Result.ok(undefined);
        },
        async initialize() {
          return signet.start();
        },
        async shutdown() {
          return signet.stop();
        },
        async sendMessage(groupId, contentType, content) {
          return signet.context.sendMessage(groupId, contentType, content);
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
      credentialLookup,
      sealManager,
      tokenLookup,
      requestHandler,
    },
  );

  let wsPort = 0;

  if (!options?.skipStart) {
    const startResult = await signet.start();
    if (startResult.isErr()) {
      throw new Error(`Failed to start signet: ${startResult.error.message}`);
    }

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
    signet,
    credentialManager,
    credentialService,
    sealManager,
    publisher,
    wsServer,
    wsPort,
    dataDir,
    factory,
    identityId,
    operatorId,
    groupId,
  };

  return {
    runtime,
    streams,
    cleanup: async () => {
      await wsServer.stop().catch(() => {});
      await signet.stop().catch(() => {});
      keyManager.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** Build a default credential config for tests. */
export function createTestCredentialConfig(
  runtime: Pick<TestRuntime, "operatorId" | "groupId">,
  overrides?: Partial<CredentialConfigType>,
): CredentialConfigType {
  return {
    operatorId: runtime.operatorId,
    chatIds: [runtime.groupId],
    allow: ["send", "reply", "react", "read-messages"],
    deny: [],
    ...overrides,
  };
}

/** Issue a credential with default permissions and return the token. */
export async function issueTestCredential(
  runtime: TestRuntime,
  overrides?: Partial<CredentialConfigType>,
): Promise<{ token: string; credentialId: string }> {
  const result = await runtime.credentialService.issue(
    createTestCredentialConfig(runtime, overrides),
  );

  if (Result.isError(result)) {
    throw new Error(`Failed to issue credential: ${result.error.message}`);
  }

  return {
    token: result.value.token,
    credentialId: result.value.credential.id,
  };
}
