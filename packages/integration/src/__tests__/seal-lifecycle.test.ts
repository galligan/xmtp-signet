/**
 * Seal lifecycle integration tests.
 *
 * Validates seal issuance, chaining, refresh, revocation,
 * and querying through the real keys + credentials + seals packages.
 */

import { describe, test, expect, afterEach } from "bun:test";
import {
  createTestRuntime,
  issueTestCredential,
} from "../fixtures/test-runtime.js";

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanup) {
    await cleanup();
    cleanup = null;
  }
});

describe("seal-lifecycle", () => {
  test("issue seal signs and publishes a credential-scoped envelope", async () => {
    const result = await createTestRuntime({ skipStart: true });
    cleanup = result.cleanup;
    const { runtime } = result;

    const { credentialId } = await issueTestCredential(runtime);

    const issueResult = await runtime.sealManager.issue(
      credentialId,
      runtime.groupId,
    );
    expect(issueResult.isOk()).toBe(true);
    if (!issueResult.isOk()) return;

    const signed = issueResult.value;
    expect(signed.chain.current.sealId).toBeTruthy();
    expect(signed.chain.current.credentialId).toBe(credentialId);
    expect(signed.chain.current.operatorId).toBe(runtime.operatorId);
    expect(signed.chain.current.chatId).toBe(runtime.groupId);
    expect(signed.signature).toBeTruthy();
    expect(signed.algorithm).toBe("Ed25519");
    expect(signed.keyId).toBeTruthy();

    expect(runtime.publisher.published.length).toBe(1);
    expect(runtime.publisher.published[0]!.groupId).toBe(runtime.groupId);
  });

  test("first seal has no previous payload", async () => {
    const result = await createTestRuntime({ skipStart: true });
    cleanup = result.cleanup;
    const { runtime } = result;

    const { credentialId } = await issueTestCredential(runtime);

    const issueResult = await runtime.sealManager.issue(
      credentialId,
      runtime.groupId,
    );
    expect(issueResult.isOk()).toBe(true);
    if (!issueResult.isOk()) return;

    expect(issueResult.value.chain.previous).toBeUndefined();
  });

  test("refresh creates a chained successor seal", async () => {
    const result = await createTestRuntime({ skipStart: true });
    cleanup = result.cleanup;
    const { runtime } = result;

    const { credentialId } = await issueTestCredential(runtime);

    const first = await runtime.sealManager.issue(
      credentialId,
      runtime.groupId,
    );
    expect(first.isOk()).toBe(true);
    if (!first.isOk()) return;

    const firstId = first.value.chain.current.sealId;
    const refresh = await runtime.sealManager.refresh(firstId);
    expect(refresh.isOk()).toBe(true);
    if (!refresh.isOk()) return;

    expect(refresh.value.chain.current.sealId).not.toBe(firstId);
    expect(refresh.value.chain.previous?.sealId).toBe(firstId);
    expect(runtime.publisher.published.length).toBe(2);
  });

  test("revoke seal publishes a signed revocation", async () => {
    const result = await createTestRuntime({ skipStart: true });
    cleanup = result.cleanup;
    const { runtime } = result;

    const { credentialId } = await issueTestCredential(runtime);

    const issueResult = await runtime.sealManager.issue(
      credentialId,
      runtime.groupId,
    );
    expect(issueResult.isOk()).toBe(true);
    if (!issueResult.isOk()) return;

    const revokeResult = await runtime.sealManager.revoke(
      issueResult.value.chain.current.sealId,
      "owner-initiated",
    );
    expect(revokeResult.isOk()).toBe(true);

    expect(runtime.publisher.revokedPublished.length).toBe(1);
    expect(runtime.publisher.revokedPublished[0]!.groupId).toBe(
      runtime.groupId,
    );
    expect(
      runtime.publisher.revokedPublished[0]!.revocation.revocation.reason,
    ).toBe("owner-initiated");
    expect(
      runtime.publisher.revokedPublished[0]!.revocation.signature,
    ).toBeTruthy();
  });

  test("query current seal returns the latest envelope", async () => {
    const result = await createTestRuntime({ skipStart: true });
    cleanup = result.cleanup;
    const { runtime } = result;

    const { credentialId } = await issueTestCredential(runtime);

    const issueResult = await runtime.sealManager.issue(
      credentialId,
      runtime.groupId,
    );
    expect(issueResult.isOk()).toBe(true);
    if (!issueResult.isOk()) return;

    const currentResult = await runtime.sealManager.current(
      credentialId,
      runtime.groupId,
    );
    expect(currentResult.isOk()).toBe(true);
    if (!currentResult.isOk()) return;
    expect(currentResult.value).not.toBeNull();
    expect(currentResult.value?.chain.current.sealId).toBe(
      issueResult.value.chain.current.sealId,
    );
  });

  test("query after revocation returns null", async () => {
    const result = await createTestRuntime({ skipStart: true });
    cleanup = result.cleanup;
    const { runtime } = result;

    const { credentialId } = await issueTestCredential(runtime);

    const issueResult = await runtime.sealManager.issue(
      credentialId,
      runtime.groupId,
    );
    expect(issueResult.isOk()).toBe(true);
    if (!issueResult.isOk()) return;

    await runtime.sealManager.revoke(
      issueResult.value.chain.current.sealId,
      "owner-initiated",
    );

    const currentResult = await runtime.sealManager.current(
      credentialId,
      runtime.groupId,
    );
    expect(currentResult.isOk()).toBe(true);
    if (!currentResult.isOk()) return;
    expect(currentResult.value).toBeNull();
  });
});
