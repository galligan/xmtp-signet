/**
 * Security boundary tests for the v1 access model.
 *
 * Proves that role isolation, credential scoping, deny-wins semantics,
 * policy composition, and scope guard error handling all hold using
 * real implementations -- no mocks.
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
import type {
  CredentialManager,
  OperatorManager,
  PolicyManager,
  ScopeGuard,
} from "@xmtp/signet-contracts";
import { validateSendMessage } from "@xmtp/signet-policy";
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
    maxConcurrentPerOperator: 10,
    renewalWindowSeconds: 300,
    heartbeatGracePeriod: 3,
  });
  credentials = createCredentialService({
    manager: internalCreds,
    policyManager: policies,
  });

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

async function createOperator(
  label: string,
  role: "operator" | "admin" = "operator",
): Promise<OperatorRecordType> {
  const result = await operators.create({
    label,
    role,
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
// 1. Role Isolation
// ---------------------------------------------------------------------------

describe("role isolation", () => {
  test("operator record has correct role assignment", async () => {
    const op = await createOperator("bot-1", "operator");
    expect(op.config.role).toBe("operator");
  });

  test("superadmin creation is rejected with PermissionError", async () => {
    const result = await operators.create({
      label: "evil-bot",
      role: "superadmin",
      scopeMode: "per-chat",
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("PermissionError");
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Credential Scope Tests
// ---------------------------------------------------------------------------

describe("credential scope isolation", () => {
  test("credential scoped to one chat cannot access another", async () => {
    const op = await createOperator("scoped-bot");

    const issued = await credentials.issue({
      operatorId: op.id,
      chatIds: ["conv_1"],
      allow: ["send", "read-messages"],
      deny: [],
    });
    expect(issued.isOk()).toBe(true);
    if (!issued.isOk()) throw new Error("Failed to issue credential");

    const credId = issued.value.credential.id;
    const record = internalCreds.getCredentialById(credId);
    expect(record.isOk()).toBe(true);
    if (!record.isOk()) return;

    const inScope = validateSendMessage(
      { groupId: "conv_1" },
      record.value.resolvedScopes,
      record.value.chatIds,
    );
    expect(inScope.isOk()).toBe(true);

    const outOfScope = validateSendMessage(
      { groupId: "conv_2" },
      record.value.resolvedScopes,
      record.value.chatIds,
    );
    expect(outOfScope.isErr()).toBe(true);
    if (outOfScope.isErr()) {
      expect(outOfScope.error._tag).toBe("PermissionError");
    }
  });

  test("deny overrides allow (deny-wins semantics)", async () => {
    const op = await createOperator("deny-wins-bot");

    const issued = await credentials.issue({
      operatorId: op.id,
      chatIds: ["conv_1"],
      allow: ["send", "react"],
      deny: ["send"],
    });
    expect(issued.isOk()).toBe(true);
    if (!issued.isOk()) throw new Error("Failed to issue credential");

    const credId = issued.value.credential.id;

    // send is in both allow and deny -> deny wins -> false
    const sendCheck = await scopeGuard.check("send", credId);
    expect(sendCheck.isOk()).toBe(true);
    if (sendCheck.isOk()) expect(sendCheck.value).toBe(false);

    // react is only in allow -> true
    const reactCheck = await scopeGuard.check("react", credId);
    expect(reactCheck.isOk()).toBe(true);
    if (reactCheck.isOk()) expect(reactCheck.value).toBe(true);
  });

  test("credential expiry blocks access", async () => {
    // Use a very short TTL so the credential expires quickly
    const shortCreds = createCredentialManager({
      defaultTtlSeconds: 1,
      maxConcurrentPerOperator: 10,
      renewalWindowSeconds: 0,
      heartbeatGracePeriod: 0,
    });
    const shortService = createCredentialService({
      manager: shortCreds,
      policyManager: policies,
    });

    const op = await createOperator("expiry-bot");

    const issued = await shortService.issue({
      operatorId: op.id,
      chatIds: ["conv_1"],
      allow: ["send"],
      deny: [],
      ttlSeconds: 1,
    });
    expect(issued.isOk()).toBe(true);
    if (!issued.isOk()) throw new Error("Failed to issue credential");

    const credId = issued.value.credential.id;

    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Sweep expired credentials
    shortCreds.sweepExpired();

    // After sweep, the credential should be expired
    const record = shortCreds.getCredentialById(credId);
    expect(record.isOk()).toBe(true);
    if (record.isOk()) {
      expect(record.value.status).toBe("expired");
    }
  });

  test("per-chat scope isolation across credentials for same operator", async () => {
    const op = await createOperator("multi-chat-bot");

    // Issue credential for chat_a only
    const issuedA = await credentials.issue({
      operatorId: op.id,
      chatIds: ["chat_a"],
      allow: ["send"],
      deny: [],
    });
    expect(issuedA.isOk()).toBe(true);
    if (!issuedA.isOk()) throw new Error("Failed to issue credential A");

    // Issue credential for chat_b only
    const issuedB = await credentials.issue({
      operatorId: op.id,
      chatIds: ["chat_b"],
      allow: ["send"],
      deny: [],
    });
    expect(issuedB.isOk()).toBe(true);
    if (!issuedB.isOk()) throw new Error("Failed to issue credential B");

    // Verify each credential is scoped to its own chat
    const recordA = internalCreds.getCredentialById(
      issuedA.value.credential.id,
    );
    expect(recordA.isOk()).toBe(true);
    if (recordA.isOk()) {
      expect(recordA.value.chatIds).toContain("chat_a");
      expect(recordA.value.chatIds).not.toContain("chat_b");
    }

    const recordB = internalCreds.getCredentialById(
      issuedB.value.credential.id,
    );
    expect(recordB.isOk()).toBe(true);
    if (recordB.isOk()) {
      expect(recordB.value.chatIds).toContain("chat_b");
      expect(recordB.value.chatIds).not.toContain("chat_a");
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Policy Composition
// ---------------------------------------------------------------------------

describe("policy composition", () => {
  test("policy + inline deny merge correctly", async () => {
    const op = await createOperator("policy-deny-bot");

    // Policy allows send, react, reply
    const policy = await createPolicy("broad", ["send", "react", "reply"], []);

    // Issue credential with policy + inline deny on reply
    const issued = await credentials.issue({
      operatorId: op.id,
      chatIds: ["conv_1"],
      policyId: policy.id,
      deny: ["reply"],
    });
    expect(issued.isOk()).toBe(true);
    if (!issued.isOk()) throw new Error("Failed to issue credential");

    const credId = issued.value.credential.id;

    // send = allowed (from policy, not denied)
    const sendCheck = await scopeGuard.check("send", credId);
    expect(sendCheck.isOk()).toBe(true);
    if (sendCheck.isOk()) expect(sendCheck.value).toBe(true);

    // react = allowed (from policy, not denied)
    const reactCheck = await scopeGuard.check("react", credId);
    expect(reactCheck.isOk()).toBe(true);
    if (reactCheck.isOk()) expect(reactCheck.value).toBe(true);

    // reply = denied (inline deny overrides policy allow)
    const replyCheck = await scopeGuard.check("reply", credId);
    expect(replyCheck.isOk()).toBe(true);
    if (replyCheck.isOk()) expect(replyCheck.value).toBe(false);
  });

  test("empty policy with inline scopes uses inline only", async () => {
    const op = await createOperator("inline-only-bot");

    // Issue credential with no policyId, only inline allow
    const issued = await credentials.issue({
      operatorId: op.id,
      chatIds: ["conv_1"],
      allow: ["read-messages"],
      deny: [],
    });
    expect(issued.isOk()).toBe(true);
    if (!issued.isOk()) throw new Error("Failed to issue credential");

    const credId = issued.value.credential.id;

    // read-messages = allowed (inline)
    const readCheck = await scopeGuard.check("read-messages", credId);
    expect(readCheck.isOk()).toBe(true);
    if (readCheck.isOk()) expect(readCheck.value).toBe(true);

    // send = not allowed (not in inline allow)
    const sendCheck = await scopeGuard.check("send", credId);
    expect(sendCheck.isOk()).toBe(true);
    if (sendCheck.isOk()) expect(sendCheck.value).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Scope Guard Error Handling
// ---------------------------------------------------------------------------

describe("scope guard error handling", () => {
  test("unknown credential returns error", async () => {
    const result = await scopeGuard.check("send", "cred_nonexistent_12345");
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("NotFoundError");
    }
  });
});
