/**
 * Credential lifecycle integration tests.
 *
 * Validates credential issuance, lookup, heartbeat, expiry,
 * revocation, and materiality checks through the real credential manager.
 */

import { describe, test, expect } from "bun:test";
import { createCredentialManager } from "@xmtp/signet-sessions";
import type { CredentialConfigType } from "@xmtp/signet-schemas";

function makeCredentialConfig(
  overrides?: Partial<CredentialConfigType>,
): CredentialConfigType {
  return {
    operatorId: "op_1234abcdfeedbabe",
    chatIds: ["conv_1234abcdfeedbabe"],
    allow: ["send", "read-messages"],
    deny: [],
    ttlSeconds: 60,
    ...overrides,
  };
}

describe("credential-lifecycle", () => {
  test("issue credential returns token, scopes, and expiry metadata", async () => {
    const manager = createCredentialManager({ defaultTtlSeconds: 60 });

    const result = await manager.issueCredential(makeCredentialConfig(), {
      credentialId: "cred_1234abcdfeedbabe",
    });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const credential = result.value;
    expect(credential.credentialId).toBe("cred_1234abcdfeedbabe");
    expect(credential.token).toBeTruthy();
    expect(credential.operatorId).toBe("op_1234abcdfeedbabe");
    expect(credential.chatIds).toEqual(["conv_1234abcdfeedbabe"]);
    expect(credential.effectiveScopes.allow).toContain("send");
    expect(credential.status).toBe("active");

    const expiresAt = new Date(credential.expiresAt).getTime();
    const now = Date.now();
    expect(expiresAt - now).toBeGreaterThan(55_000);
    expect(expiresAt - now).toBeLessThan(65_000);
  });

  test("lookup credential by ID returns the matching record", async () => {
    const manager = createCredentialManager();

    const created = await manager.issueCredential(makeCredentialConfig(), {
      credentialId: "cred_1234abcdfeedbabe",
    });
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;

    const lookup = manager.getCredentialById(created.value.credentialId);
    expect(lookup.isOk()).toBe(true);
    if (!lookup.isOk()) return;

    expect(lookup.value.operatorId).toBe("op_1234abcdfeedbabe");
    expect(lookup.value.credentialId).toBe(created.value.credentialId);
  });

  test("lookup credential by token returns the matching record", async () => {
    const manager = createCredentialManager();

    const created = await manager.issueCredential(makeCredentialConfig());
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;

    const lookup = manager.getCredentialByToken(created.value.token);
    expect(lookup.isOk()).toBe(true);
    if (!lookup.isOk()) return;

    expect(lookup.value.credentialId).toBe(created.value.credentialId);
  });

  test("heartbeat keeps credential alive", async () => {
    const manager = createCredentialManager();

    const created = await manager.issueCredential(makeCredentialConfig(), {
      credentialId: "cred_1234abcdfeedbabe",
    });
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;

    const firstHeartbeat = created.value.lastHeartbeat;
    await new Promise((resolve) => setTimeout(resolve, 10));

    const heartbeat = manager.recordHeartbeat("cred_1234abcdfeedbabe");
    expect(heartbeat.isOk()).toBe(true);

    const after = manager.getCredentialById("cred_1234abcdfeedbabe");
    expect(after.isOk()).toBe(true);
    if (!after.isOk()) return;
    expect(after.value.lastHeartbeat).not.toBe(firstHeartbeat);
  });

  test("expired credential returns CredentialExpiredError on token lookup", async () => {
    const manager = createCredentialManager({ defaultTtlSeconds: 1 });

    const created = await manager.issueCredential(
      makeCredentialConfig({ ttlSeconds: 1 }),
      { credentialId: "cred_1234abcdfeedbabe" },
    );
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const lookup = manager.getCredentialByToken(created.value.token);
    expect(lookup.isErr()).toBe(true);
    if (!lookup.isErr()) return;
    expect(lookup.error._tag).toBe("CredentialExpiredError");
  });

  test("revoke credential causes immediate invalidation", async () => {
    const manager = createCredentialManager();

    const created = await manager.issueCredential(makeCredentialConfig(), {
      credentialId: "cred_1234abcdfeedbabe",
    });
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;

    const revoke = manager.revokeCredential("cred_1234abcdfeedbabe", "owner-initiated");
    expect(revoke.isOk()).toBe(true);
    if (!revoke.isOk()) return;
    expect(revoke.value.status).toBe("revoked");

    const tokenLookup = manager.getCredentialByToken(created.value.token);
    expect(tokenLookup.isErr()).toBe(true);

    const heartbeat = manager.recordHeartbeat("cred_1234abcdfeedbabe");
    expect(heartbeat.isErr()).toBe(true);
  });

  test("materiality check detects scope escalation", async () => {
    const manager = createCredentialManager();

    const created = await manager.issueCredential(
      makeCredentialConfig({
        allow: ["read-messages"],
        deny: [],
      }),
      { credentialId: "cred_1234abcdfeedbabe" },
    );
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;

    const check = manager.checkMateriality("cred_1234abcdfeedbabe", {
      allow: ["read-messages", "send"],
      deny: [],
    });
    expect(check.isOk()).toBe(true);
    if (!check.isOk()) return;
    expect(check.value.isMaterial).toBe(true);
    expect(check.value.reason).toContain("added: send");

    const noChange = manager.checkMateriality("cred_1234abcdfeedbabe", {
      allow: ["read-messages"],
      deny: [],
    });
    expect(noChange.isOk()).toBe(true);
    if (!noChange.isOk()) return;
    expect(noChange.value.isMaterial).toBe(false);
  });
});
