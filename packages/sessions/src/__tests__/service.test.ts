import { beforeEach, describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { createCredentialService } from "../service.js";
import { createCredentialManager } from "../credential-manager.js";
import type { InternalCredentialManager } from "../credential-manager.js";
import type { PolicyManager } from "@xmtp/signet-contracts";
import {
  NotFoundError,
  type PermissionScopeType,
  type PolicyConfigType,
  type PolicyRecordType,
} from "@xmtp/signet-schemas";
import { createTestCredentialConfig } from "./fixtures.js";

function createTestPolicyManager(): PolicyManager {
  const policies = new Map<string, PolicyRecordType>();
  let counter = 1;

  function nextPolicyId(): string {
    return `policy_${counter.toString(16).padStart(8, "0")}`;
  }

  return {
    async create(config: PolicyConfigType) {
      const now = new Date().toISOString();
      const record: PolicyRecordType = {
        id: nextPolicyId(),
        config: {
          label: config.label,
          allow: [...config.allow],
          deny: [...config.deny],
        },
        createdAt: now,
        updatedAt: now,
      };
      policies.set(record.id, record);
      counter += 1;
      return Result.ok(record);
    },

    async list() {
      return Result.ok([...policies.values()]);
    },

    async lookup(policyId: string) {
      const record = policies.get(policyId);
      if (record === undefined) {
        return Result.err(NotFoundError.create("policy", policyId));
      }
      return Result.ok(record);
    },

    async update(policyId: string, changes: Partial<PolicyConfigType>) {
      const record = policies.get(policyId);
      if (record === undefined) {
        return Result.err(NotFoundError.create("policy", policyId));
      }

      const updated: PolicyRecordType = {
        ...record,
        config: {
          label: changes.label ?? record.config.label,
          allow: changes.allow ?? record.config.allow,
          deny: changes.deny ?? record.config.deny,
        },
        updatedAt: new Date().toISOString(),
      };
      policies.set(policyId, updated);
      return Result.ok(updated);
    },

    async remove(policyId: string) {
      if (!policies.has(policyId)) {
        return Result.err(NotFoundError.create("policy", policyId));
      }
      policies.delete(policyId);
      return Result.ok(undefined);
    },
  };
}

describe("createCredentialService", () => {
  let manager: InternalCredentialManager;
  let service: ReturnType<typeof createCredentialService>;

  beforeEach(() => {
    manager = createCredentialManager({
      defaultTtlSeconds: 60,
      maxConcurrentPerOperator: 3,
      renewalWindowSeconds: 10,
      heartbeatGracePeriod: 3,
    });
    service = createCredentialService({ manager });
  });

  test("issues bearer credentials with credential metadata", async () => {
    const result = await service.issue(createTestCredentialConfig());
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.token).toHaveLength(43);
    expect(result.value.credential.id).toMatch(/^cred_[0-9a-f]{16}$/);
    expect(result.value.credential.config.operatorId).toBe("op_test1234");
    expect(result.value.credential.issuedBy).toBe("owner");
  });

  test("preserves explicit credential issuer provenance", async () => {
    const result = await service.issue(createTestCredentialConfig(), {
      issuedBy: "op_admin1234",
    });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.credential.issuedBy).toBe("op_admin1234");
  });

  test("preserves explicit credential issuer provenance", async () => {
    const result = await service.issue(createTestCredentialConfig(), {
      issuedBy: "admin",
    });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.credential.issuedBy).toBe("admin");
  });

  test("reuses an existing matching active credential", async () => {
    const config = createTestCredentialConfig();
    const first = await service.issue(config);
    const second = await service.issue(config);

    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    if (!first.isOk() || !second.isOk()) return;

    expect(second.value.token).toBe(first.value.token);
    expect(second.value.credential.id).toBe(first.value.credential.id);
  });

  test("lists public credential records without exposing bearer tokens", async () => {
    const issuedCred = await service.issue(createTestCredentialConfig());
    expect(issuedCred.isOk()).toBe(true);
    if (!issuedCred.isOk()) return;

    const listed = await service.list("op_test1234");
    expect(listed.isOk()).toBe(true);
    if (!listed.isOk()) return;

    expect(listed.value).toHaveLength(1);
    expect(listed.value[0]?.id).toBe(issuedCred.value.credential.id);
    expect(listed.value[0]?.credentialId).toBe(issuedCred.value.credential.id);
    expect(listed.value[0]?.effectiveScopes.allow).toContain("read-messages");
    expect(listed.value[0]?.isExpired).toBe(false);
    expect("token" in listed.value[0]!).toBe(false);
  });

  test("revokes a credential", async () => {
    const issuedCred = await service.issue(createTestCredentialConfig());
    expect(issuedCred.isOk()).toBe(true);
    if (!issuedCred.isOk()) return;

    const revokeResult = await service.revoke(
      issuedCred.value.credential.id,
      "owner-initiated",
    );
    expect(revokeResult.isOk()).toBe(true);

    // Lookup should still return but with revoked status
    const lookup = await service.lookup(issuedCred.value.credential.id);
    expect(lookup.isOk()).toBe(true);
    if (!lookup.isOk()) return;
    expect(lookup.value.status).toBe("revoked");
  });

  test("looks up credential by token", async () => {
    const issuedCred = await service.issue(createTestCredentialConfig());
    expect(issuedCred.isOk()).toBe(true);
    if (!issuedCred.isOk()) return;

    const lookup = await service.lookupByToken(issuedCred.value.token);
    expect(lookup.isOk()).toBe(true);
    if (!lookup.isOk()) return;
    expect(lookup.value.id).toBe(issuedCred.value.credential.id);
    expect(lookup.value.credentialId).toBe(issuedCred.value.credential.id);
    expect(lookup.value.operatorId).toBe("op_test1234");
    expect(lookup.value.effectiveScopes.allow).toContain("read-messages");
  });

  test("updates credential scopes when the change does not escalate access", async () => {
    const issuedCred = await service.issue(createTestCredentialConfig());
    expect(issuedCred.isOk()).toBe(true);
    if (!issuedCred.isOk()) return;

    const updated = await service.update(issuedCred.value.credential.id, {
      allow: ["read-messages"] as PermissionScopeType[],
      deny: ["list-conversations"] as PermissionScopeType[],
    });
    expect(updated.isOk()).toBe(true);
    if (!updated.isOk()) return;
    expect(updated.value.status).toBe("active");
    expect(updated.value.config.allow).toEqual(["read-messages"]);
    expect(updated.value.config.deny).toEqual(["list-conversations"]);
  });

  test("applies scope narrowing in place", async () => {
    const issuedCred = await service.issue(createTestCredentialConfig());
    expect(issuedCred.isOk()).toBe(true);
    if (!issuedCred.isOk()) return;

    const updated = await service.update(issuedCred.value.credential.id, {
      allow: ["read-messages"] as PermissionScopeType[],
    });
    expect(updated.isOk()).toBe(true);
    if (!updated.isOk()) return;

    expect(updated.value.status).toBe("active");
    expect(updated.value.config.allow).toEqual(["read-messages"]);
    expect(updated.value.effectiveScopes.allow).toEqual(["read-messages"]);
  });

  test("revokes credential when update requires reauthorization", async () => {
    const issuedCred = await service.issue(createTestCredentialConfig());
    expect(issuedCred.isOk()).toBe(true);
    if (!issuedCred.isOk()) return;

    const updated = await service.update(issuedCred.value.credential.id, {
      allow: ["read-messages", "send"] as PermissionScopeType[],
    });
    expect(updated.isOk()).toBe(true);
    if (!updated.isOk()) return;

    expect(updated.value.status).toBe("revoked");

    const lookup = await service.lookup(issuedCred.value.credential.id);
    expect(lookup.isOk()).toBe(true);
    if (!lookup.isOk()) return;
    expect(lookup.value.status).toBe("revoked");
  });

  test("rejects unsupported credential updates", async () => {
    const issuedCred = await service.issue(createTestCredentialConfig());
    expect(issuedCred.isOk()).toBe(true);
    if (!issuedCred.isOk()) return;

    const updated = await service.update(issuedCred.value.credential.id, {
      chatIds: ["conv_other999"],
    });
    expect(updated.isErr()).toBe(true);
    if (!updated.isErr()) return;
    expect(updated.error.category).toBe("validation");
  });

  test("renews a credential and returns token metadata", async () => {
    const shortTtl = createCredentialManager({
      defaultTtlSeconds: 5,
      maxConcurrentPerOperator: 3,
      renewalWindowSeconds: 7200,
      heartbeatGracePeriod: 3,
    });
    const shortService = createCredentialService({ manager: shortTtl });

    const issuedCred = await shortService.issue(createTestCredentialConfig());
    expect(issuedCred.isOk()).toBe(true);
    if (!issuedCred.isOk()) return;

    const renewed = await shortService.renew(issuedCred.value.credential.id);
    expect(renewed.isOk()).toBe(true);
    if (!renewed.isOk()) return;

    expect(renewed.value.credentialId).toBe(issuedCred.value.credential.id);
    expect(renewed.value.operatorId).toBe("op_test1234");
    expect(renewed.value.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(renewed.value.issuedAt).toBeDefined();
    expect(renewed.value.expiresAt).toBeDefined();
  });
});

describe("createCredentialService with policy resolution", () => {
  let manager: InternalCredentialManager;
  let policyManager: PolicyManager;
  let service: ReturnType<typeof createCredentialService>;

  beforeEach(() => {
    manager = createCredentialManager({
      defaultTtlSeconds: 60,
      maxConcurrentPerOperator: 3,
      renewalWindowSeconds: 10,
      heartbeatGracePeriod: 3,
    });
    policyManager = createTestPolicyManager();
    service = createCredentialService({ manager, policyManager });
  });

  test("resolves scopes from policy when policyId is provided", async () => {
    const policyResult = await policyManager.create({
      label: "Test Policy",
      allow: ["send", "react"] as PermissionScopeType[],
      deny: ["leave"] as PermissionScopeType[],
    });
    expect(policyResult.isOk()).toBe(true);
    if (!policyResult.isOk()) return;

    const config = createTestCredentialConfig({
      policyId: policyResult.value.id,
      allow: ["reply"] as PermissionScopeType[],
      deny: [] as PermissionScopeType[],
    });

    const result = await service.issue(config);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // Policy allow ["send","react"] merged with inline allow ["reply"]
    expect(result.value.credential.config.allow).toContain("send");
    expect(result.value.credential.config.allow).toContain("react");
    expect(result.value.credential.config.allow).toContain("reply");
    // Policy deny ["leave"] merged with inline deny []
    expect(result.value.credential.config.deny).toContain("leave");
  });

  test("uses inline scopes only when no policyId", async () => {
    const config = createTestCredentialConfig({
      allow: ["send"] as PermissionScopeType[],
      deny: ["leave"] as PermissionScopeType[],
    });

    const result = await service.issue(config);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.credential.config.allow).toEqual(["send"]);
    expect(result.value.credential.config.deny).toEqual(["leave"]);
  });

  test("returns error when policyId references nonexistent policy", async () => {
    const config = createTestCredentialConfig({
      policyId: "policy_nonexistent",
    });

    const result = await service.issue(config);
    expect(result.isOk()).toBe(false);
    if (result.isOk()) return;

    expect(result.error.category).toBe("not_found");
  });

  test("recomputes scopes on update when policyId changes", async () => {
    const policy1 = await policyManager.create({
      label: "Policy 1",
      allow: ["send"] as PermissionScopeType[],
      deny: [] as PermissionScopeType[],
    });
    expect(policy1.isOk()).toBe(true);
    if (!policy1.isOk()) return;

    const policy2 = await policyManager.create({
      label: "Policy 2",
      allow: [] as PermissionScopeType[],
      deny: ["send"] as PermissionScopeType[],
    });
    expect(policy2.isOk()).toBe(true);
    if (!policy2.isOk()) return;

    // Issue with policy1
    const config = createTestCredentialConfig({
      policyId: policy1.value.id,
      allow: [] as PermissionScopeType[],
      deny: [] as PermissionScopeType[],
    });
    const issued = await service.issue(config);
    expect(issued.isOk()).toBe(true);
    if (!issued.isOk()) return;

    // Update to policy2
    const updated = await service.update(issued.value.credential.id, {
      policyId: policy2.value.id,
    });
    expect(updated.isOk()).toBe(true);
    if (!updated.isOk()) return;

    expect(updated.value.status).toBe("active");
    expect(updated.value.config.allow).toEqual([]);
    expect(updated.value.config.deny).toContain("send");
  });
});
