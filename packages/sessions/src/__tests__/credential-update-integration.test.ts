import { beforeEach, describe, expect, test } from "bun:test";
import type { PermissionScopeType } from "@xmtp/signet-schemas";
import type { CredentialManager } from "@xmtp/signet-contracts";
import { createCredentialManager } from "../credential-manager.js";
import { createCredentialService } from "../service.js";
import { createUpdateActions } from "../update-actions.js";
import type { UpdateActionDeps } from "../update-actions.js";
import type { InternalCredentialManager } from "../credential-manager.js";
import { createTestCredentialConfig, createTestScopes } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Integration: credential scope update with materiality enforcement
// ---------------------------------------------------------------------------

let manager: InternalCredentialManager;
let credentialService: CredentialManager;
let deps: UpdateActionDeps;
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

  // Issue a credential with wide scope
  const config = createTestCredentialConfig({
    allow: [
      "read-messages",
      "list-conversations",
      "send",
      "reply",
    ] as PermissionScopeType[],
    chatIds: ["conv_group1", "conv_group2"],
  });
  const issued = await credentialService.issue(config);
  expect(issued.isOk()).toBe(true);
  if (!issued.isOk()) throw new Error("Failed to create credential");

  credentialId = issued.value.credential.id;
});

function stubContext() {
  return {
    requestId: "test-req",
    signal: new AbortController().signal,
  };
}

describe("credential update integration", () => {
  test("scope narrowing applies immediately without revoking", async () => {
    const actions = createUpdateActions(deps);
    const updateScopes = actions.find(
      (a) => a.id === "credential.updateScopes",
    );
    expect(updateScopes).toBeDefined();
    if (!updateScopes) return;

    const narrowerScopes = createTestScopes({
      allow: ["read-messages", "list-conversations"] as PermissionScopeType[],
    });

    const result = await updateScopes.handler(
      { credentialId, scopes: narrowerScopes },
      stubContext(),
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const output = result.value as {
      updated: boolean;
      material: boolean;
      reason: string | null;
    };
    expect(output.updated).toBe(true);
    expect(output.material).toBe(true);
    expect(output.reason).toContain("removed:");

    const internal = manager.getCredentialById(credentialId);
    expect(internal.isOk()).toBe(true);
    if (!internal.isOk()) return;
    expect(internal.value.status).toBe("active");
    expect(internal.value.effectiveScopes.allow).toEqual([
      "read-messages",
      "list-conversations",
    ]);
    expect(internal.value.revocationReason).toBeNull();
  });

  test("identical scopes apply as non-material update", async () => {
    const actions = createUpdateActions(deps);
    const updateScopes = actions.find(
      (a) => a.id === "credential.updateScopes",
    );
    expect(updateScopes).toBeDefined();
    if (!updateScopes) return;

    const sameScopes = createTestScopes({
      allow: [
        "read-messages",
        "list-conversations",
        "send",
        "reply",
      ] as PermissionScopeType[],
    });

    const result = await updateScopes.handler(
      { credentialId, scopes: sameScopes },
      stubContext(),
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const output = result.value as {
      updated: boolean;
      material: boolean;
    };
    expect(output.updated).toBe(true);
    expect(output.material).toBe(false);
  });

  test("material scope escalation triggers revocation", async () => {
    const actions = createUpdateActions(deps);
    const updateScopes = actions.find(
      (a) => a.id === "credential.updateScopes",
    );
    expect(updateScopes).toBeDefined();
    if (!updateScopes) return;

    // Escalate: add "react" scope
    const escalated = createTestScopes({
      allow: [
        "read-messages",
        "list-conversations",
        "send",
        "reply",
        "react",
      ] as PermissionScopeType[],
    });

    const result = await updateScopes.handler(
      { credentialId, scopes: escalated },
      stubContext(),
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const output = result.value as {
      updated: boolean;
      material: boolean;
      reason: string | null;
    };
    expect(output.updated).toBe(false);
    expect(output.material).toBe(true);
    expect(output.reason).toBeTypeOf("string");

    // Credential should now be revoked
    const internal = manager.getCredentialById(credentialId);
    expect(internal.isOk()).toBe(true);
    if (!internal.isOk()) return;
    expect(internal.value.status).toBe("revoked");
    expect(internal.value.revocationReason).toBe("reauthorization-required");
    expect(internal.value.revokedAt).not.toBeNull();
  });
});
