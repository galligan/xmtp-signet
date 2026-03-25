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
import { createCredentialManager } from "../credential-manager.js";
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
  test("runs the end-to-end lifecycle in one self-contained flow", async () => {
    const operators = createOperatorManager();
    const policies = createPolicyManager();
    const credManager = createCredentialManager();
    const credService = createCredentialService({
      manager: credManager,
      policyManager: policies,
    });

    const CONV_DESIGN = "conv_design000";
    const CONV_SUPPORT = "conv_support00";
    const CONV_RESEARCH = "conv_research0";

    const admin = unwrapOk(
      await operators.create({
        label: "lobster-bot",
        role: "admin",
        scopeMode: "shared",
      }),
    );
    expect(admin.config.label).toBe("lobster-bot");
    expect(admin.config.role).toBe("admin");
    expect(admin.status).toBe("active");

    const alice = unwrapOk(
      await operators.create({
        label: "alice-bot",
        role: "operator",
        scopeMode: "per-chat",
      }),
    );
    expect(alice.config.label).toBe("alice-bot");
    expect(alice.config.role).toBe("operator");
    expect(alice.config.scopeMode).toBe("per-chat");

    const policy = unwrapOk(
      await policies.create({
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
      }),
    );
    expect(policy.config.label).toBe("support-agent");
    expect(policy.config.allow).toContain("send");
    expect(policy.config.deny).toContain("invite");

    const issued = unwrapOk(
      await credService.issue({
        operatorId: alice.id,
        chatIds: [CONV_DESIGN, CONV_SUPPORT],
        policyId: policy.id,
        deny: ["react"],
      }),
    );
    expect(issued.token).toBeTruthy();
    expect(issued.credential.status).toBe("active");

    let record = unwrapOk(credManager.getCredentialById(issued.credential.id));
    expect(record.resolvedScopes.has("send")).toBe(true);
    expect(record.resolvedScopes.has("reply")).toBe(true);
    expect(record.resolvedScopes.has("read-messages")).toBe(true);
    expect(record.resolvedScopes.has("react")).toBe(false);
    expect(record.resolvedScopes.has("invite")).toBe(false);
    expect(record.resolvedScopes.has("forward-to-provider")).toBe(false);

    expect(
      validateSendMessage(
        { groupId: CONV_DESIGN },
        record.resolvedScopes,
        record.chatIds,
      ).isOk(),
    ).toBe(true);
    expectErr(
      validateSendMessage(
        { groupId: CONV_RESEARCH },
        record.resolvedScopes,
        record.chatIds,
      ),
    );
    expectErr(
      validateSendReaction(
        { groupId: CONV_SUPPORT },
        record.resolvedScopes,
        record.chatIds,
      ),
    );
    expectErr(validateEgress("forward-to-provider", record.resolvedScopes));
    expectErr(validateEgress("store-excerpts", record.resolvedScopes));

    expect(
      (await credService.revoke(issued.credential.id, "admin-revoked")).isOk(),
    ).toBe(true);

    const reissued = unwrapOk(
      await credService.issue({
        operatorId: alice.id,
        chatIds: [CONV_DESIGN, CONV_SUPPORT, CONV_RESEARCH],
        policyId: policy.id,
        deny: ["react"],
      }),
    );
    record = unwrapOk(credManager.getCredentialById(reissued.credential.id));
    expect(
      validateSendMessage(
        { groupId: CONV_RESEARCH },
        record.resolvedScopes,
        record.chatIds,
      ).isOk(),
    ).toBe(true);

    expect(
      (
        await credService.revoke(reissued.credential.id, "admin-revoked")
      ).isOk(),
    ).toBe(true);
    expect(
      unwrapOk(credManager.getCredentialById(reissued.credential.id)).status,
    ).toBe("revoked");

    const aliceAfterRevoke = unwrapOk(await operators.lookup(alice.id));
    expect(aliceAfterRevoke.status).toBe("active");
    expect(aliceAfterRevoke.config.label).toBe("alice-bot");

    expect((await operators.remove(alice.id)).isOk()).toBe(true);
    expect(unwrapOk(await operators.lookup(alice.id)).status).toBe("removed");
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Scope Guard Round-Trip
// ---------------------------------------------------------------------------

describe("v1 tracer bullet: scope guard round-trip", () => {
  test("keeps scope guard assertions self-contained", async () => {
    const policies = createPolicyManager();
    const credManager = createCredentialManager();
    const credService = createCredentialService({
      manager: credManager,
      policyManager: policies,
    });

    await policies.create({
      label: "guard-test-policy",
      allow: ["send", "reply", "read-messages"],
      deny: ["invite"],
    });

    const issued = unwrapOk(
      await credService.issue({
        operatorId: "op_guardtest01",
        chatIds: ["conv_guardchat0"],
        allow: ["send", "reply", "read-messages"],
        deny: ["invite"],
      }),
    );

    const guard = createScopeGuard(async (credentialId: string) => {
      const record = credManager.getCredentialById(credentialId);
      if (record.isErr()) return record;
      return Result.ok(record.value.effectiveScopes);
    });

    expect(unwrapOk(await guard.check("send", issued.credential.id))).toBe(
      true,
    );
    expect(unwrapOk(await guard.check("invite", issued.credential.id))).toBe(
      false,
    );

    const scopes = unwrapOk(await guard.effectiveScopes(issued.credential.id));
    expect(scopes.allow).toContain("send");
    expect(scopes.deny).toContain("invite");

    const record = unwrapOk(
      credManager.getCredentialById(issued.credential.id),
    );
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
  test("keeps operator isolation assertions self-contained", async () => {
    const operators = createOperatorManager();
    const credManager = createCredentialManager();
    const credService = createCredentialService({ manager: credManager });

    const operatorA = unwrapOk(
      await operators.create({
        label: "agent-alpha",
        role: "operator",
        scopeMode: "per-chat",
      }),
    );
    const operatorB = unwrapOk(
      await operators.create({
        label: "agent-beta",
        role: "operator",
        scopeMode: "shared",
      }),
    );

    expect(
      (
        await credService.issue({
          operatorId: operatorA.id,
          chatIds: ["conv_alphaonly0"],
          allow: ["send", "read-messages"] satisfies PermissionScopeType[],
          deny: [],
        })
      ).isOk(),
    ).toBe(true);
    expect(
      (
        await credService.issue({
          operatorId: operatorB.id,
          chatIds: ["conv_betaonly00"],
          allow: ["send", "reply", "react"] satisfies PermissionScopeType[],
          deny: [],
        })
      ).isOk(),
    ).toBe(true);

    const credsA = credManager.listCredentials(operatorA.id);
    const credsB = credManager.listCredentials(operatorB.id);
    expect(credsA.length).toBe(1);
    expect(credsB.length).toBe(1);

    const recordA = credsA[0];
    const recordB = credsB[0];
    expect(recordA).toBeDefined();
    expect(recordB).toBeDefined();

    expect(recordA!.chatIds).toContain("conv_alphaonly0");
    expect(recordA!.chatIds).not.toContain("conv_betaonly00");
    expect(recordB!.chatIds).toContain("conv_betaonly00");
    expect(recordB!.chatIds).not.toContain("conv_alphaonly0");

    expectErr(checkChatInScope("conv_betaonly00", recordA!.chatIds));
    expect(checkChatInScope("conv_alphaonly0", recordA!.chatIds).isOk()).toBe(
      true,
    );

    const all = credManager.listCredentials();
    const onlyA = credManager.listCredentials(operatorA.id);
    const onlyB = credManager.listCredentials(operatorB.id);
    expect(all.length).toBe(2);
    expect(onlyA.length).toBe(1);
    expect(onlyB.length).toBe(1);
    expect(onlyA[0]!.operatorId).toBe(operatorA.id);
    expect(onlyB[0]!.operatorId).toBe(operatorB.id);
  });
});
