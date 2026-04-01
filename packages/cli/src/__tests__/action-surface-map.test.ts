import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { createActionRegistry } from "@xmtp/signet-contracts";
import type { CredentialManager, SealManager } from "@xmtp/signet-contracts";
import { InternalError } from "@xmtp/signet-schemas";
import { createKeyActions, createWalletActions } from "@xmtp/signet-keys";
import {
  createConversationActions,
  createMessageActions,
} from "@xmtp/signet-core";
import {
  createCredentialActions,
  createRevealActions,
  createUpdateActions,
  createOperatorActions,
  createPolicyActions,
  createOperatorManager,
  createPolicyManager,
} from "@xmtp/signet-sessions";
import {
  generateActionSurfaceMap,
  hashActionSurfaceMap,
} from "../../../contracts/src/action-surface-map.js";
import { createSignetActions } from "../actions/signet-actions.js";
import { createSealActions } from "../actions/seal-actions.js";

function makeCredentialManagerStub(): CredentialManager {
  const notImplemented = async () =>
    Result.err(InternalError.create("not implemented"));

  return {
    issue: notImplemented,
    list: notImplemented,
    lookup: notImplemented,
    lookupByToken: notImplemented,
    revoke: notImplemented,
  } as unknown as CredentialManager;
}

function makeSealManagerStub(): SealManager {
  const notImplemented = async () =>
    Result.err(InternalError.create("not implemented"));

  return {
    issue: notImplemented,
    refresh: notImplemented,
    revoke: notImplemented,
    current: notImplemented,
    list: notImplemented,
    lookup: notImplemented,
    history: notImplemented,
  } as unknown as SealManager;
}

describe("action surface map", () => {
  test("produces a stable hash for the assembled public action surface", () => {
    const registry = createActionRegistry();
    const credentialManager = makeCredentialManagerStub();
    const sealManager = makeSealManagerStub();

    for (const spec of createSignetActions({
      status: async () => ({ state: "running" }) as never,
      shutdown: async () => Result.ok(undefined),
      rotateKeys: async () => Result.ok({ rotated: 0 }),
    })) {
      registry.register(spec);
    }

    for (const spec of createCredentialActions({ credentialManager })) {
      registry.register(spec);
    }

    for (const spec of createRevealActions({
      credentialManager,
      internalManager: {
        getRevealState: () => Result.err(InternalError.create("unused")),
      } as never,
    })) {
      registry.register(spec);
    }

    for (const spec of createUpdateActions({
      credentialManager,
      internalManager: {
        checkMateriality: () => Result.err(InternalError.create("unused")),
        revokeCredential: () => Result.err(InternalError.create("unused")),
        updateCredentialScopes: () =>
          Result.err(InternalError.create("unused")),
      } as never,
    })) {
      registry.register(spec);
    }

    for (const spec of createConversationActions({
      identityStore: {} as never,
      getManagedClient: () => undefined,
      getGroupInfo: async () => Result.err(InternalError.create("unused")),
    })) {
      registry.register(spec);
    }

    for (const spec of createOperatorActions({
      operatorManager: createOperatorManager(),
    })) {
      registry.register(spec);
    }

    for (const spec of createPolicyActions({
      policyManager: createPolicyManager(),
    })) {
      registry.register(spec);
    }

    for (const spec of createMessageActions({
      identityStore: {} as never,
      getManagedClient: () => undefined,
    })) {
      registry.register(spec);
    }

    for (const spec of createSealActions({
      sealManager,
      resolveSealPublicKey: async () => Result.ok(null),
    })) {
      registry.register(spec);
    }

    for (const spec of createWalletActions({
      keyManager: {
        createWallet: async () =>
          Result.err(InternalError.create("not implemented")),
        listWallets: async () =>
          Result.err(InternalError.create("not implemented")),
        getWallet: async () =>
          Result.err(InternalError.create("not implemented")),
        listWalletAccounts: async () =>
          Result.err(InternalError.create("not implemented")),
      } as never,
    })) {
      registry.register(spec);
    }

    for (const spec of createKeyActions({
      operatorManager: createOperatorManager(),
      keyManager: {
        createWallet: async () =>
          Result.err(InternalError.create("not implemented")),
        listWallets: async () =>
          Result.err(InternalError.create("not implemented")),
        getWallet: async () =>
          Result.err(InternalError.create("not implemented")),
        listWalletAccounts: async () =>
          Result.err(InternalError.create("not implemented")),
        createOperationalKey: async () =>
          Result.err(InternalError.create("not implemented")),
        getOperationalKey: () =>
          Result.err(InternalError.create("not implemented")),
        getOperationalKeyByGroupId: () =>
          Result.err(InternalError.create("not implemented")),
        rotateOperationalKey: async () =>
          Result.err(InternalError.create("not implemented")),
        listOperationalKeys: () => [],
        issueCredentialKey: async () =>
          Result.err(InternalError.create("not implemented")),
        revokeCredentialKey: () =>
          Result.err(InternalError.create("not implemented")),
        signWithOperationalKey: async () =>
          Result.err(InternalError.create("not implemented")),
        signWithCredentialKey: async () =>
          Result.err(InternalError.create("not implemented")),
        getOrCreateDbKey: async () =>
          Result.err(InternalError.create("not implemented")),
        getOrCreateXmtpIdentityKey: async () =>
          Result.err(InternalError.create("not implemented")),
        vaultSet: async () =>
          Result.err(InternalError.create("not implemented")),
        vaultGet: async () =>
          Result.err(InternalError.create("not implemented")),
        vaultDelete: async () =>
          Result.err(InternalError.create("not implemented")),
        vaultList: () => [],
        startAutoRotation: () => {},
        stopAutoRotation: () => {},
        close: () => {},
        admin: {
          exists: () => false,
          create: async () =>
            Result.err(InternalError.create("not implemented")),
          get: async () => Result.err(InternalError.create("not implemented")),
          signJwt: async () =>
            Result.err(InternalError.create("not implemented")),
          verifyJwt: async () =>
            Result.err(InternalError.create("not implemented")),
        },
        platform: "software-vault",
        trustTier: "unverified",
        initialize: async () =>
          Result.err(InternalError.create("not implemented")),
      } as never,
    })) {
      registry.register(spec);
    }

    const surfaceMap = generateActionSurfaceMap(registry.list());
    const hash = hashActionSurfaceMap(surfaceMap);

    expect(surfaceMap.entries.length).toBeGreaterThan(0);
    expect(hash).toBe(
      "cf4b6058bc5b752880b54613b599cd825591f7142f79e466b1c8f6423fcd1fca",
    );
  });
});
