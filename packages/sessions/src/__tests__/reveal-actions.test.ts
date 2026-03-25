import { beforeEach, describe, expect, test } from "bun:test";
import type { RevealGrant } from "@xmtp/signet-schemas";
import type { CredentialManager } from "@xmtp/signet-contracts";
import { createCredentialManager } from "../credential-manager.js";
import { createCredentialService } from "../service.js";
import { createRevealActions } from "../reveal-actions.js";
import type { RevealActionDeps } from "../reveal-actions.js";
import { createTestCredentialConfig } from "./fixtures.js";
import type { InternalCredentialManager } from "../credential-manager.js";

let manager: InternalCredentialManager;
let credentialService: CredentialManager;
let deps: RevealActionDeps;
let credentialId: string;

beforeEach(async () => {
  manager = createCredentialManager({
    defaultTtlSeconds: 60,
    maxConcurrentPerOperator: 3,
    renewalWindowSeconds: 10,
    heartbeatGracePeriod: 3,
  });

  credentialService = createCredentialService({ manager });

  deps = {
    credentialManager: credentialService,
    internalManager: manager,
  };

  // Create a credential for tests
  const config = createTestCredentialConfig({
    chatIds: ["conv_group1", "conv_group2"],
  });
  const issued = await credentialService.issue(config);
  expect(issued.isOk()).toBe(true);
  if (!issued.isOk()) throw new Error("Failed to create credential");

  credentialId = issued.value.credential.id;
});

describe("reveal.request action", () => {
  test("creates reveal access for a chat in credential scope", async () => {
    const actions = createRevealActions(deps);
    const requestAction = actions.find((a) => a.id === "reveal.request");
    expect(requestAction).toBeDefined();
    if (!requestAction) return;

    const input = {
      credentialId,
      chatId: "conv_group1",
      scope: "message" as const,
      targetId: "msg-123",
      requestedBy: "member-1",
      expiresAt: null,
    };

    const result = await requestAction.handler(input, stubContext());
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const grant = result.value as RevealGrant;
    expect(grant.revealId).toBeDefined();
    expect(typeof grant.revealId).toBe("string");
    expect(grant.grantedAt).toBeDefined();
    expect(grant.grantedBy).toBe("member-1");
    expect(grant.expiresAt).toBeNull();
  });

  test("rejects a chat not in credential chatIds", async () => {
    const actions = createRevealActions(deps);
    const requestAction = actions.find((a) => a.id === "reveal.request");
    expect(requestAction).toBeDefined();
    if (!requestAction) return;

    const input = {
      credentialId,
      chatId: "conv_unknown",
      scope: "message" as const,
      targetId: "msg-123",
      requestedBy: "member-1",
      expiresAt: null,
    };

    const result = await requestAction.handler(input, stubContext());
    expect(result.isOk()).toBe(false);
    if (result.isOk()) return;
    expect(result.error.category).toBe("permission");
  });

  test("stores the access record in the credential reveal state", async () => {
    const actions = createRevealActions(deps);
    const requestAction = actions.find((a) => a.id === "reveal.request");
    expect(requestAction).toBeDefined();
    if (!requestAction) return;

    await requestAction.handler(
      {
        credentialId,
        chatId: "conv_group1",
        scope: "message" as const,
        targetId: "msg-1",
        requestedBy: "member-1",
        expiresAt: null,
      },
      stubContext(),
    );

    // Verify via the store
    const storeResult = manager.getRevealState(credentialId);
    expect(storeResult.isOk()).toBe(true);
    if (!storeResult.isOk()) return;

    const snapshot = storeResult.value.snapshot();
    expect(snapshot.activeReveals).toHaveLength(1);
    expect(snapshot.activeReveals[0]?.grant.grantedBy).toBe("member-1");
    expect(snapshot.activeReveals[0]?.request.groupId).toBe("conv_group1");
  });

  test("rejects when credential does not exist", async () => {
    const actions = createRevealActions(deps);
    const requestAction = actions.find((a) => a.id === "reveal.request");
    expect(requestAction).toBeDefined();
    if (!requestAction) return;

    const result = await requestAction.handler(
      {
        credentialId: "nonexistent",
        chatId: "conv_group1",
        scope: "message" as const,
        targetId: "msg-1",
        requestedBy: "member-1",
        expiresAt: null,
      },
      stubContext(),
    );
    expect(result.isOk()).toBe(false);
  });

  test("rejects when a credential-scoped caller targets another credential", async () => {
    const issued = await credentialService.issue(
      createTestCredentialConfig({
        chatIds: ["conv_group1"],
      }),
    );
    expect(issued.isOk()).toBe(true);
    if (!issued.isOk()) return;

    const actions = createRevealActions(deps);
    const requestAction = actions.find((a) => a.id === "reveal.request");
    expect(requestAction).toBeDefined();
    if (!requestAction) return;

    const result = await requestAction.handler(
      {
        credentialId: issued.value.credential.id,
        chatId: "conv_group1",
        scope: "message" as const,
        targetId: "msg-1",
        requestedBy: "member-1",
        expiresAt: null,
      },
      stubContext({ credentialId }),
    );

    expect(result.isOk()).toBe(false);
    if (result.isOk()) return;
    expect(result.error.category).toBe("permission");
  });
});

describe("reveal.list action", () => {
  test("returns empty snapshot for credential with no reveals", async () => {
    const actions = createRevealActions(deps);
    const listAction = actions.find((a) => a.id === "reveal.list");
    expect(listAction).toBeDefined();
    if (!listAction) return;

    const result = await listAction.handler({ credentialId }, stubContext());
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const snapshot = result.value as { activeReveals: unknown[] };
    expect(snapshot.activeReveals).toHaveLength(0);
  });

  test("returns reveals after granting", async () => {
    const actions = createRevealActions(deps);
    const requestAction = actions.find((a) => a.id === "reveal.request");
    const listAction = actions.find((a) => a.id === "reveal.list");
    expect(requestAction).toBeDefined();
    expect(listAction).toBeDefined();
    if (!requestAction || !listAction) return;

    await requestAction.handler(
      {
        credentialId,
        chatId: "conv_group1",
        scope: "message" as const,
        targetId: "msg-1",
        requestedBy: "member-1",
        expiresAt: null,
      },
      stubContext(),
    );
    await requestAction.handler(
      {
        credentialId,
        chatId: "conv_group2",
        scope: "thread" as const,
        targetId: "thread-1",
        requestedBy: "member-2",
        expiresAt: null,
      },
      stubContext(),
    );

    const result = await listAction.handler({ credentialId }, stubContext());
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const snapshot = result.value as { activeReveals: unknown[] };
    expect(snapshot.activeReveals).toHaveLength(2);
  });

  test("rejects when credential does not exist", async () => {
    const actions = createRevealActions(deps);
    const listAction = actions.find((a) => a.id === "reveal.list");
    expect(listAction).toBeDefined();
    if (!listAction) return;

    const result = await listAction.handler(
      { credentialId: "nonexistent" },
      stubContext(),
    );
    expect(result.isOk()).toBe(false);
  });

  test("rejects when a credential-scoped caller lists another credential's reveals", async () => {
    const issued = await credentialService.issue(
      createTestCredentialConfig({
        chatIds: ["conv_group1"],
      }),
    );
    expect(issued.isOk()).toBe(true);
    if (!issued.isOk()) return;

    const actions = createRevealActions(deps);
    const listAction = actions.find((a) => a.id === "reveal.list");
    expect(listAction).toBeDefined();
    if (!listAction) return;

    const result = await listAction.handler(
      { credentialId: issued.value.credential.id },
      stubContext({ credentialId }),
    );

    expect(result.isOk()).toBe(false);
    if (result.isOk()) return;
    expect(result.error.category).toBe("permission");
  });
});

function stubContext(overrides: Partial<{ credentialId: string }> = {}) {
  return {
    requestId: "test-req",
    signal: new AbortController().signal,
    ...overrides,
  };
}
