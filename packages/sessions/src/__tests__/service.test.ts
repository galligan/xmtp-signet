import { beforeEach, describe, expect, test } from "bun:test";
import { createCredentialService } from "../service.js";
import { createCredentialManager } from "../session-manager.js";
import type { InternalCredentialManager } from "../session-manager.js";
import { createTestCredentialConfig } from "./fixtures.js";

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
});
