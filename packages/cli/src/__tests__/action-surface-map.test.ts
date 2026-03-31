import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { createActionRegistry } from "@xmtp/signet-contracts";
import type { CredentialManager } from "@xmtp/signet-contracts";
import { InternalError } from "@xmtp/signet-schemas";
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

describe("action surface map", () => {
  test("produces a stable hash for the assembled public action surface", () => {
    const registry = createActionRegistry();
    const credentialManager = makeCredentialManagerStub();

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

    const surfaceMap = generateActionSurfaceMap(registry.list());
    const hash = hashActionSurfaceMap(surfaceMap);

    expect(surfaceMap.entries.length).toBeGreaterThan(0);
    expect(hash).toBe(
      "31cb38ef9d7484bd3d56db001545f93317b435097ca0b6c4259b0e6030bb6f0b",
    );
  });
});
