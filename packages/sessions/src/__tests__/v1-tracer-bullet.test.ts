/**
 * V1 End-to-End Tracer Bullet.
 *
 * Exercises the full v1 lifecycle without a real XMTP network:
 * operators, policies, credentials, scope resolution, grant
 * validation, scope guard, and multi-operator isolation.
 *
 * All in-memory -- no daemon, no network, no filesystem.
 */

import { describe, test, expect } from "bun:test";
import { Result } from "better-result";
import type { PermissionScopeType } from "@xmtp/signet-schemas";
import { resolveScopeSet } from "@xmtp/signet-schemas";
import {
  createScopeGuard,
  checkChatInScope,
  validateSendMessage,
  validateSendReaction,
  validateEgress,
} from "@xmtp/signet-policy";

import { createOperatorManager } from "../operator-manager.js";
import { createPolicyManager } from "../policy-manager.js";
import { createCredentialManager } from "../session-manager.js";
import { createCredentialService } from "../service.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Assert a Result is Ok and return its value. */
function unwrapOk<T>(result: Result<T, unknown>): T {
  expect(result.isOk()).toBe(true);
  if (!result.isOk()) throw new Error("Expected Ok");
  return result.value;
}

/** Assert a Result is Err. */
function expectErr(result: Result<unknown, unknown>): void {
  expect(result.isErr()).toBe(true);
}

// ---------------------------------------------------------------------------
// Scenario 1: The Full Lifecycle
// ---------------------------------------------------------------------------

describe("v1 tracer bullet: the full lifecycle", () => {
  const operators = createOperatorManager();
  const policies = createPolicyManager();
  const credManager = createCredentialManager();
  const credService = createCredentialService({
    manager: credManager,
    policyManager: policies,
  });

  // Stable conversation IDs for the scenario
  const CONV_DESIGN = "conv_design000";
  const CONV_SUPPORT = "conv_support00";
  const CONV_RESEARCH = "conv_research0";

  // Mutable state threaded across ordered tests
  let adminId: string;
  let aliceId: string;
  let policyId: string;
  let credentialId: string;

  // Step 1: Owner creates admin operator "lobster-bot"
  test("owner creates admin operator", async () => {
    const result = await operators.create({
      label: "lobster-bot",
      role: "admin",
      scopeMode: "shared",
    });
    const admin = unwrapOk(result);
    expect(admin.config.label).toBe("lobster-bot");
    expect(admin.config.role).toBe("admin");
    expect(admin.status).toBe("active");
    adminId = admin.id;
  });

  // Step 2: Admin creates operator "alice-bot"
  test("admin creates operator alice-bot", async () => {
    const result = await operators.create({
      label: "alice-bot",
      role: "operator",
      scopeMode: "per-chat",
    });
    const alice = unwrapOk(result);
    expect(alice.config.label).toBe("alice-bot");
    expect(alice.config.role).toBe("operator");
    expect(alice.config.scopeMode).toBe("per-chat");
    aliceId = alice.id;
  });

  // Step 3: Admin creates policy "support-agent"
  test("admin creates policy with allow/deny", async () => {
    const result = await policies.create({
      label: "support-agent",
      allow: [
        "send",
        "reply",
        "react",
        "read-messages",
        "read-receipt",
        "list-members",
      ],
      deny: ["invite", "create-group", "forward-to-provider"],
    });
    const policy = unwrapOk(result);
    expect(policy.config.label).toBe("support-agent");
    expect(policy.config.allow).toContain("send");
    expect(policy.config.deny).toContain("invite");
    policyId = policy.id;
  });

  // Step 4: Admin issues credential for alice-bot with policy + inline deny
  test("credential issued with policy + inline deny override", async () => {
    const result = await credService.issue({
      operatorId: aliceId,
      chatIds: [CONV_DESIGN, CONV_SUPPORT],
      policyId,
      deny: ["react"], // inline deny: alice can't react
    });
    const issued = unwrapOk(result);
    expect(issued.token).toBeTruthy();
    expect(issued.credential.status).toBe("active");
    credentialId = issued.credential.id;
  });

  // Step 5: Verify effective scopes (deny-wins semantics)
  test("effective scopes reflect deny-wins resolution", () => {
    const record = unwrapOk(credManager.getCredentialById(credentialId));
    const resolved = record.resolvedScopes;

    // Allowed by policy, not denied
    expect(resolved.has("send")).toBe(true);
    expect(resolved.has("reply")).toBe(true);
    expect(resolved.has("read-messages")).toBe(true);

    // Denied by inline deny (overrides policy allow)
    expect(resolved.has("react")).toBe(false);

    // Denied by policy deny
    expect(resolved.has("invite")).toBe(false);
    expect(resolved.has("forward-to-provider")).toBe(false);
  });

  // Step 6: Validate actions against credential
  test("validateSendMessage allows in-scope chat", () => {
    const record = unwrapOk(credManager.getCredentialById(credentialId));
    const result = validateSendMessage(
      { groupId: CONV_DESIGN },
      record.resolvedScopes,
      record.chatIds,
    );
    expect(result.isOk()).toBe(true);
  });

  test("validateSendMessage denies out-of-scope chat", () => {
    const record = unwrapOk(credManager.getCredentialById(credentialId));
    const result = validateSendMessage(
      { groupId: CONV_RESEARCH },
      record.resolvedScopes,
      record.chatIds,
    );
    expectErr(result);
  });

  test("validateSendReaction denied by inline deny", () => {
    const record = unwrapOk(credManager.getCredentialById(credentialId));
    const result = validateSendReaction(
      { groupId: CONV_SUPPORT },
      record.resolvedScopes,
      record.chatIds,
    );
    expectErr(result);
  });

  test("validateEgress denies forward-to-provider (policy deny)", () => {
    const record = unwrapOk(credManager.getCredentialById(credentialId));
    const result = validateEgress("forward-to-provider", record.resolvedScopes);
    expectErr(result);
  });

  test("validateEgress denies store-excerpts (not in allow)", () => {
    const record = unwrapOk(credManager.getCredentialById(credentialId));
    const result = validateEgress("store-excerpts", record.resolvedScopes);
    expectErr(result);
  });

  // Step 7: Admin updates credential scopes to add conv_research
  test("credential update adds new chatId via scope update", async () => {
    // The credential service update operates on scopes, not chatIds directly.
    // We re-issue a credential for the expanded chat set to simulate step 7.
    // First revoke the old one, then issue a new one.
    const revokeResult = await credService.revoke(
      credentialId,
      "admin-revoked",
    );
    expect(revokeResult.isOk()).toBe(true);

    const result = await credService.issue({
      operatorId: aliceId,
      chatIds: [CONV_DESIGN, CONV_SUPPORT, CONV_RESEARCH],
      policyId,
      deny: ["react"],
    });
    const issued = unwrapOk(result);
    credentialId = issued.credential.id;
  });

  // Step 8: Verify conv_research now accessible
  test("conv_research now accessible after re-issue", () => {
    const record = unwrapOk(credManager.getCredentialById(credentialId));
    const result = validateSendMessage(
      { groupId: CONV_RESEARCH },
      record.resolvedScopes,
      record.chatIds,
    );
    expect(result.isOk()).toBe(true);
  });

  // Step 9: Admin revokes credential
  test("admin revokes credential", async () => {
    const result = await credService.revoke(credentialId, "admin-revoked");
    expect(result.isOk()).toBe(true);
  });

  // Step 10: Verify credential status is "revoked"
  test("credential status is revoked", () => {
    const record = unwrapOk(credManager.getCredentialById(credentialId));
    expect(record.status).toBe("revoked");
  });

  // Step 11: Verify operator list still shows alice-bot (active)
  test("alice-bot still active after credential revocation", async () => {
    const result = await operators.lookup(aliceId);
    const alice = unwrapOk(result);
    expect(alice.status).toBe("active");
    expect(alice.config.label).toBe("alice-bot");
  });

  // Step 12: Admin removes alice-bot
  test("admin removes alice-bot", async () => {
    const result = await operators.remove(aliceId);
    expect(result.isOk()).toBe(true);
  });

  // Step 13: Verify alice-bot status is "removed"
  test("alice-bot status is removed", async () => {
    const result = await operators.lookup(aliceId);
    const alice = unwrapOk(result);
    expect(alice.status).toBe("removed");
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Scope Guard Round-Trip
// ---------------------------------------------------------------------------

describe("v1 tracer bullet: scope guard round-trip", () => {
  const policies = createPolicyManager();
  const credManager = createCredentialManager();
  const credService = createCredentialService({
    manager: credManager,
    policyManager: policies,
  });

  let credentialId: string;

  test("issue credential with specific scopes", async () => {
    await policies.create({
      label: "guard-test-policy",
      allow: ["send", "reply", "read-messages"],
      deny: ["invite"],
    });

    const result = await credService.issue({
      operatorId: "op_guardtest01",
      chatIds: ["conv_guardchat0"],
      allow: ["send", "reply", "read-messages"],
      deny: ["invite"],
    });
    const issued = unwrapOk(result);
    credentialId = issued.credential.id;
  });

  test("scope guard check allowed scope returns true", async () => {
    const guard = createScopeGuard(async (cid: string) => {
      const record = credManager.getCredentialById(cid);
      if (record.isErr()) return record;
      return Result.ok(record.value.effectiveScopes);
    });

    const result = await guard.check("send", credentialId);
    const allowed = unwrapOk(result);
    expect(allowed).toBe(true);
  });

  test("scope guard check denied scope returns false", async () => {
    const guard = createScopeGuard(async (cid: string) => {
      const record = credManager.getCredentialById(cid);
      if (record.isErr()) return record;
      return Result.ok(record.value.effectiveScopes);
    });

    const result = await guard.check("invite", credentialId);
    const allowed = unwrapOk(result);
    expect(allowed).toBe(false);
  });

  test("scope guard effectiveScopes returns scope set", async () => {
    const guard = createScopeGuard(async (cid: string) => {
      const record = credManager.getCredentialById(cid);
      if (record.isErr()) return record;
      return Result.ok(record.value.effectiveScopes);
    });

    const result = await guard.effectiveScopes(credentialId);
    const scopes = unwrapOk(result);
    expect(scopes.allow).toContain("send");
    expect(scopes.deny).toContain("invite");
  });

  test("resolveScopeSet produces correct effective set", () => {
    const record = unwrapOk(credManager.getCredentialById(credentialId));
    const resolved = resolveScopeSet(record.effectiveScopes);
    expect(resolved.has("send")).toBe(true);
    expect(resolved.has("reply")).toBe(true);
    expect(resolved.has("read-messages")).toBe(true);
    expect(resolved.has("invite")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Multi-Operator Isolation
// ---------------------------------------------------------------------------

describe("v1 tracer bullet: multi-operator isolation", () => {
  const operators = createOperatorManager();
  const credManager = createCredentialManager();
  const credService = createCredentialService({ manager: credManager });

  let operatorAId: string;
  let operatorBId: string;

  test("create operator A (per-chat) and operator B (shared)", async () => {
    const resultA = await operators.create({
      label: "agent-alpha",
      role: "operator",
      scopeMode: "per-chat",
    });
    const resultB = await operators.create({
      label: "agent-beta",
      role: "operator",
      scopeMode: "shared",
    });
    operatorAId = unwrapOk(resultA).id;
    operatorBId = unwrapOk(resultB).id;
  });

  test("issue credentials for different chats", async () => {
    const resultA = await credService.issue({
      operatorId: operatorAId,
      chatIds: ["conv_alphaonly0"],
      allow: ["send", "read-messages"] satisfies PermissionScopeType[],
      deny: [],
    });
    const resultB = await credService.issue({
      operatorId: operatorBId,
      chatIds: ["conv_betaonly00"],
      allow: ["send", "reply", "react"] satisfies PermissionScopeType[],
      deny: [],
    });
    expect(resultA.isOk()).toBe(true);
    expect(resultB.isOk()).toBe(true);
  });

  test("each operator's credentials are isolated", () => {
    const credsA = credManager.listCredentials(operatorAId);
    const credsB = credManager.listCredentials(operatorBId);

    expect(credsA.length).toBe(1);
    expect(credsB.length).toBe(1);

    // A's credential only covers alpha chat
    const recordA = credsA[0];
    expect(recordA).toBeDefined();
    expect(recordA!.chatIds).toContain("conv_alphaonly0");
    expect(recordA!.chatIds).not.toContain("conv_betaonly00");

    // B's credential only covers beta chat
    const recordB = credsB[0];
    expect(recordB).toBeDefined();
    expect(recordB!.chatIds).toContain("conv_betaonly00");
    expect(recordB!.chatIds).not.toContain("conv_alphaonly0");
  });

  test("cross-operator chat access is denied", () => {
    const credsA = credManager.listCredentials(operatorAId);
    const recordA = credsA[0];
    expect(recordA).toBeDefined();

    // Operator A tries to access beta's chat
    const result = checkChatInScope("conv_betaonly00", recordA!.chatIds);
    expectErr(result);
  });

  test("operator A can access their own chat", () => {
    const credsA = credManager.listCredentials(operatorAId);
    const recordA = credsA[0];
    expect(recordA).toBeDefined();

    const result = checkChatInScope("conv_alphaonly0", recordA!.chatIds);
    expect(result.isOk()).toBe(true);
  });

  test("list by operatorId returns only that operator's credentials", () => {
    const all = credManager.listCredentials();
    const onlyA = credManager.listCredentials(operatorAId);
    const onlyB = credManager.listCredentials(operatorBId);

    expect(all.length).toBe(2);
    expect(onlyA.length).toBe(1);
    expect(onlyB.length).toBe(1);

    expect(onlyA[0]!.operatorId).toBe(operatorAId);
    expect(onlyB[0]!.operatorId).toBe(operatorBId);
  });
});
