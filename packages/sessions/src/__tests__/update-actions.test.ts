import { beforeEach, describe, expect, test } from "bun:test";
import type { PermissionScopeType } from "@xmtp/signet-schemas";
import type { CredentialManager } from "@xmtp/signet-contracts";
import { createCredentialManager } from "../credential-manager.js";
import { createCredentialService } from "../service.js";
import { createUpdateActions } from "../update-actions.js";
import type { UpdateActionDeps } from "../update-actions.js";
import {
  createTestCredentialConfig,
  baseScopes,
  createTestScopes,
} from "./fixtures.js";
import type { InternalCredentialManager } from "../credential-manager.js";

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

  // Create a credential for tests
  const config = createTestCredentialConfig();
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

describe("credential.updateScopes action", () => {
  test("is CLI-only and not exposed over MCP", () => {
    const actions = createUpdateActions(deps);
    const updateScopes = actions.find(
      (action) => action.id === "credential.updateScopes",
    );
    expect(updateScopes).toBeDefined();
    expect(updateScopes?.cli).toBeDefined();
    expect(updateScopes?.mcp).toBeUndefined();
  });

  test("applies non-material scope change immediately", async () => {
    const actions = createUpdateActions(deps);
    const updateScopes = actions.find(
      (a) => a.id === "credential.updateScopes",
    );
    expect(updateScopes).toBeDefined();
    if (!updateScopes) return;

    // Same scopes = no change
    const result = await updateScopes.handler(
      { credentialId, scopes: baseScopes },
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

  test("applies scope narrowing without revoking the credential", async () => {
    const actions = createUpdateActions(deps);
    const updateScopes = actions.find(
      (a) => a.id === "credential.updateScopes",
    );
    expect(updateScopes).toBeDefined();
    if (!updateScopes) return;

    const narrowerScopes = createTestScopes({
      allow: ["read-messages"] as PermissionScopeType[],
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
    expect(internal.value.effectiveScopes.allow).toEqual(["read-messages"]);
    expect(internal.value.revocationReason).toBeNull();
  });

  test("triggers revocation for material scope escalation", async () => {
    const actions = createUpdateActions(deps);
    const updateScopes = actions.find(
      (a) => a.id === "credential.updateScopes",
    );
    expect(updateScopes).toBeDefined();
    if (!updateScopes) return;

    // Escalation: adding "send" is material
    const escalatedScopes = createTestScopes({
      allow: [...baseScopes.allow, "send" as PermissionScopeType],
    });

    const result = await updateScopes.handler(
      { credentialId, scopes: escalatedScopes },
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

    // Verify the credential status changed to revoked
    const internal = manager.getCredentialById(credentialId);
    expect(internal.isOk()).toBe(true);
    if (!internal.isOk()) return;
    expect(internal.value.status).toBe("revoked");
    expect(internal.value.revocationReason).toBe("reauthorization-required");
    expect(internal.value.revokedAt).not.toBeNull();
  });

  test("returns NotFoundError for non-existent credential", async () => {
    const actions = createUpdateActions(deps);
    const updateScopes = actions.find(
      (a) => a.id === "credential.updateScopes",
    );
    expect(updateScopes).toBeDefined();
    if (!updateScopes) return;

    const result = await updateScopes.handler(
      { credentialId: "nonexistent", scopes: baseScopes },
      stubContext(),
    );
    expect(result.isOk()).toBe(false);
    if (result.isOk()) return;
    expect(result.error.category).toBe("not_found");
  });

  test("returns AuthError for revoked credential", async () => {
    const actions = createUpdateActions(deps);
    const updateScopes = actions.find(
      (a) => a.id === "credential.updateScopes",
    );
    expect(updateScopes).toBeDefined();
    if (!updateScopes) return;

    await credentialService.revoke(credentialId, "owner-initiated");

    const result = await updateScopes.handler(
      { credentialId, scopes: baseScopes },
      stubContext(),
    );
    expect(result.isOk()).toBe(false);
    if (result.isOk()) return;
    expect(result.error.category).toBe("auth");
  });
});
