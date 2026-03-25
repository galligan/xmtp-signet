/**
 * Identity runtime integration tests.
 *
 * Exercises the full operator -> policy -> credential -> scope guard flow
 * by wiring together all four managers: OperatorManager, PolicyManager,
 * CredentialManager (internal), CredentialService, and ScopeGuard.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { Result } from "better-result";
import type {
  OperatorRecordType,
  PolicyRecordType,
  PermissionScopeType,
  ScopeSetType,
  SignetError,
} from "@xmtp/signet-schemas";
import { resolveScopeSet } from "@xmtp/signet-schemas";
import type {
  CredentialManager,
  OperatorManager,
  PolicyManager,
  ScopeGuard,
} from "@xmtp/signet-contracts";
import { createOperatorManager } from "../operator-manager.js";
import { createPolicyManager } from "../policy-manager.js";
import { createCredentialManager } from "../credential-manager.js";
import { createCredentialService } from "../service.js";
import { createScopeGuard } from "@xmtp/signet-policy";
import type { InternalCredentialManager } from "../credential-manager.js";

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let operators: OperatorManager;
let policies: PolicyManager;
let internalCreds: InternalCredentialManager;
let credentials: CredentialManager;
let scopeGuard: ScopeGuard;

beforeEach(() => {
  operators = createOperatorManager();
  policies = createPolicyManager();
  internalCreds = createCredentialManager({
    defaultTtlSeconds: 3600,
    maxConcurrentPerOperator: 5,
    renewalWindowSeconds: 300,
    heartbeatGracePeriod: 3,
  });
  credentials = createCredentialService({
    manager: internalCreds,
    policyManager: policies,
  });

  // Wire scope guard to the internal credential manager
  scopeGuard = createScopeGuard(
    async (
      credentialId: string,
    ): Promise<Result<ScopeSetType, SignetError>> => {
      const record = internalCreds.getCredentialById(credentialId);
      if (record.isErr()) {
        return record;
      }
      return Result.ok(record.value.effectiveScopes);
    },
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createOperator(label: string): Promise<OperatorRecordType> {
  const result = await operators.create({
    label,
    role: "operator",
    scopeMode: "per-chat",
  });
  expect(result.isOk()).toBe(true);
  if (!result.isOk()) throw new Error("Failed to create operator");
  return result.value;
}

async function createPolicy(
  label: string,
  allow: PermissionScopeType[],
  deny: PermissionScopeType[] = [],
): Promise<PolicyRecordType> {
  const result = await policies.create({ label, allow, deny });
  expect(result.isOk()).toBe(true);
  if (!result.isOk()) throw new Error("Failed to create policy");
  return result.value;
}

// ---------------------------------------------------------------------------
// 1. Full lifecycle
// ---------------------------------------------------------------------------

describe("full lifecycle", () => {
  test("operator -> policy -> credential -> scope check -> revoke", async () => {
    // Create operator
    const op = await createOperator("alice-bot");

    // Create read-only policy
    const policy = await createPolicy(
      "read-only",
      ["read-messages", "list-conversations"],
      ["send"],
    );

    // Issue credential with policy + chatIds
    const issued = await credentials.issue({
      operatorId: op.id,
      chatIds: ["conv_chat1"],
      policyId: policy.id,
    });
    expect(issued.isOk()).toBe(true);
    if (!issued.isOk()) throw new Error("Failed to issue credential");

    const credId = issued.value.credential.id;

    // Verify effective scopes via scope guard
    const sendCheck = await scopeGuard.check("send", credId);
    expect(sendCheck.isOk()).toBe(true);
    if (sendCheck.isOk()) {
      expect(sendCheck.value).toBe(false); // send is in deny
    }

    const readCheck = await scopeGuard.check("read-messages", credId);
    expect(readCheck.isOk()).toBe(true);
    if (readCheck.isOk()) {
      expect(readCheck.value).toBe(true);
    }

    const listCheck = await scopeGuard.check("list-conversations", credId);
    expect(listCheck.isOk()).toBe(true);
    if (listCheck.isOk()) {
      expect(listCheck.value).toBe(true);
    }

    // Revoke credential
    const revoked = await credentials.revoke(credId, "admin-action");
    expect(revoked.isOk()).toBe(true);

    // Verify status is revoked
    const lookupResult = internalCreds.getCredentialById(credId);
    expect(lookupResult.isOk()).toBe(true);
    if (lookupResult.isOk()) {
      expect(lookupResult.value.status).toBe("revoked");
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Inline override merging (deny wins)
// ---------------------------------------------------------------------------

describe("inline override merging", () => {
  test("inline deny overrides policy allow", async () => {
    const op = await createOperator("override-bot");

    // Policy allows send + react
    const policy = await createPolicy("send-react", ["send", "react"], []);

    // Issue credential with inline deny on "send"
    const issued = await credentials.issue({
      operatorId: op.id,
      chatIds: ["conv_chat1"],
      policyId: policy.id,
      deny: ["send"],
    });
    expect(issued.isOk()).toBe(true);
    if (!issued.isOk()) throw new Error("Failed to issue credential");

    const credId = issued.value.credential.id;

    // react should be allowed (from policy, not denied)
    const reactCheck = await scopeGuard.check("react", credId);
    expect(reactCheck.isOk()).toBe(true);
    if (reactCheck.isOk()) {
      expect(reactCheck.value).toBe(true);
    }

    // send should be denied (inline deny wins over policy allow)
    const sendCheck = await scopeGuard.check("send", credId);
    expect(sendCheck.isOk()).toBe(true);
    if (sendCheck.isOk()) {
      expect(sendCheck.value).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Scope guard integration
// ---------------------------------------------------------------------------

describe("scope guard integration", () => {
  test("check returns correct results for allowed and disallowed scopes", async () => {
    const op = await createOperator("guard-bot");

    const issued = await credentials.issue({
      operatorId: op.id,
      chatIds: ["conv_chat1"],
      allow: ["send", "react", "read-messages"],
      deny: [],
    });
    expect(issued.isOk()).toBe(true);
    if (!issued.isOk()) throw new Error("Failed to issue credential");

    const credId = issued.value.credential.id;

    // Allowed scopes
    const sendResult = await scopeGuard.check("send", credId);
    expect(sendResult.isOk()).toBe(true);
    if (sendResult.isOk()) expect(sendResult.value).toBe(true);

    // Not in allow list
    const inviteResult = await scopeGuard.check("invite", credId);
    expect(inviteResult.isOk()).toBe(true);
    if (inviteResult.isOk()) expect(inviteResult.value).toBe(false);

    const addMemberResult = await scopeGuard.check("add-member", credId);
    expect(addMemberResult.isOk()).toBe(true);
    if (addMemberResult.isOk()) expect(addMemberResult.value).toBe(false);
  });

  test("effectiveScopes returns the credential scope set", async () => {
    const op = await createOperator("eff-bot");

    const issued = await credentials.issue({
      operatorId: op.id,
      chatIds: ["conv_chat1"],
      allow: ["send", "react"],
      deny: ["react"],
    });
    expect(issued.isOk()).toBe(true);
    if (!issued.isOk()) throw new Error("Failed to issue credential");

    const credId = issued.value.credential.id;

    const scopesResult = await scopeGuard.effectiveScopes(credId);
    expect(scopesResult.isOk()).toBe(true);
    if (!scopesResult.isOk()) return;

    const resolved = resolveScopeSet(scopesResult.value);
    expect(resolved.has("send")).toBe(true);
    expect(resolved.has("react")).toBe(false); // denied
  });

  test("check returns error for unknown credential", async () => {
    const result = await scopeGuard.check("send", "cred_nonexistent");
    expect(result.isErr()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Multi-operator isolation
// ---------------------------------------------------------------------------

describe("multi-operator isolation", () => {
  test("operators only see their own credentials", async () => {
    const opA = await createOperator("bot-a");
    const opB = await createOperator("bot-b");

    // Issue credential for operator A
    const issuedA = await credentials.issue({
      operatorId: opA.id,
      chatIds: ["conv_chat1"],
      allow: ["send"],
      deny: [],
    });
    expect(issuedA.isOk()).toBe(true);

    // Issue credential for operator B
    const issuedB = await credentials.issue({
      operatorId: opB.id,
      chatIds: ["conv_chat2"],
      allow: ["read-messages"],
      deny: [],
    });
    expect(issuedB.isOk()).toBe(true);

    // List credentials for A
    const listA = await credentials.list(opA.id);
    expect(listA.isOk()).toBe(true);
    if (listA.isOk()) {
      expect(listA.value).toHaveLength(1);
      expect(listA.value[0]?.config.operatorId).toBe(opA.id);
    }

    // List credentials for B
    const listB = await credentials.list(opB.id);
    expect(listB.isOk()).toBe(true);
    if (listB.isOk()) {
      expect(listB.value).toHaveLength(1);
      expect(listB.value[0]?.config.operatorId).toBe(opB.id);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Credential renewal
// ---------------------------------------------------------------------------

describe("credential renewal", () => {
  test("renew extends expiry within renewal window", async () => {
    // Use short TTL and wide renewal window so we are immediately eligible
    const shortCreds = createCredentialManager({
      defaultTtlSeconds: 10,
      maxConcurrentPerOperator: 5,
      renewalWindowSeconds: 60, // wider than TTL -> always in window
      heartbeatGracePeriod: 3,
    });
    const shortService = createCredentialService({
      manager: shortCreds,
      policyManager: policies,
    });

    const op = await createOperator("renew-bot");

    const issued = await shortService.issue({
      operatorId: op.id,
      chatIds: ["conv_chat1"],
      allow: ["send"],
      deny: [],
    });
    expect(issued.isOk()).toBe(true);
    if (!issued.isOk()) throw new Error("Failed to issue credential");

    const credId = issued.value.credential.id;
    const originalExpiry = issued.value.credential.expiresAt;

    // Renew
    await Bun.sleep(5);
    const renewed = await shortService.renew(credId);
    expect(renewed.isOk()).toBe(true);
    if (renewed.isOk()) {
      // New expiry should be later than original
      expect(new Date(renewed.value.expiresAt).getTime()).toBeGreaterThan(
        new Date(originalExpiry).getTime(),
      );
    }

    // Credential still accessible after renewal
    const lookup = shortCreds.getCredentialById(credId);
    expect(lookup.isOk()).toBe(true);
    if (lookup.isOk()) {
      expect(lookup.value.status).toBe("active");
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Policy update propagation via re-issuance
// ---------------------------------------------------------------------------

describe("policy update propagation", () => {
  test("re-issuing with updated policy reflects new scopes", async () => {
    const op = await createOperator("policy-update-bot");

    // Create initial policy
    const policy = await createPolicy("narrow", ["read-messages"], []);

    // Issue credential with policy
    const issued1 = await credentials.issue({
      operatorId: op.id,
      chatIds: ["conv_chat1"],
      policyId: policy.id,
    });
    expect(issued1.isOk()).toBe(true);
    if (!issued1.isOk()) throw new Error("Failed to issue first credential");

    const credId1 = issued1.value.credential.id;

    // Verify initial scope: only read-messages
    const readCheck1 = await scopeGuard.check("read-messages", credId1);
    expect(readCheck1.isOk()).toBe(true);
    if (readCheck1.isOk()) expect(readCheck1.value).toBe(true);

    const sendCheck1 = await scopeGuard.check("send", credId1);
    expect(sendCheck1.isOk()).toBe(true);
    if (sendCheck1.isOk()) expect(sendCheck1.value).toBe(false);

    // Update the policy to add send
    const updateResult = await policies.update(policy.id, {
      allow: ["read-messages", "send"],
    });
    expect(updateResult.isOk()).toBe(true);

    // Revoke old credential
    await credentials.revoke(credId1, "admin-action");

    // Re-issue with updated policy
    const issued2 = await credentials.issue({
      operatorId: op.id,
      chatIds: ["conv_chat1"],
      policyId: policy.id,
    });
    expect(issued2.isOk()).toBe(true);
    if (!issued2.isOk()) throw new Error("Failed to issue second credential");

    const credId2 = issued2.value.credential.id;

    // New credential should reflect updated policy
    const sendCheck2 = await scopeGuard.check("send", credId2);
    expect(sendCheck2.isOk()).toBe(true);
    if (sendCheck2.isOk()) expect(sendCheck2.value).toBe(true);

    const readCheck2 = await scopeGuard.check("read-messages", credId2);
    expect(readCheck2.isOk()).toBe(true);
    if (readCheck2.isOk()) expect(readCheck2.value).toBe(true);
  });

  test("credential update with wider policy requires reauthorization", async () => {
    const op = await createOperator("cred-update-bot");

    // Two policies
    const narrow = await createPolicy("narrow", ["read-messages"], []);
    const wide = await createPolicy(
      "wide",
      ["read-messages", "send", "react"],
      [],
    );

    // Issue with narrow policy
    const issued = await credentials.issue({
      operatorId: op.id,
      chatIds: ["conv_chat1"],
      policyId: narrow.id,
    });
    expect(issued.isOk()).toBe(true);
    if (!issued.isOk()) throw new Error("Failed to issue credential");

    const credId = issued.value.credential.id;

    // send not allowed initially
    const sendBefore = await scopeGuard.check("send", credId);
    expect(sendBefore.isOk()).toBe(true);
    if (sendBefore.isOk()) expect(sendBefore.value).toBe(false);

    // Update credential to use wide policy
    const updated = await credentials.update(credId, {
      policyId: wide.id,
    });
    expect(updated.isOk()).toBe(true);
    if (!updated.isOk()) return;
    expect(updated.value.status).toBe("revoked");

    // The original credential keeps its prior scopes until reauthorized.
    const sendAfter = await scopeGuard.check("send", credId);
    expect(sendAfter.isOk()).toBe(true);
    if (sendAfter.isOk()) expect(sendAfter.value).toBe(false);
  });
});
