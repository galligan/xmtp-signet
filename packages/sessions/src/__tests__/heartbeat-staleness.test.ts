import { describe, test, expect, beforeEach } from "bun:test";
import { createCredentialManager } from "../credential-manager.js";
import type { InternalCredentialManager } from "../credential-manager.js";
import { createTestCredentialConfig } from "./fixtures.js";

let manager: InternalCredentialManager;

beforeEach(() => {
  manager = createCredentialManager({
    heartbeatGracePeriod: 2,
  });
});

describe("isHeartbeatStale", () => {
  test("returns false for freshly created credential", async () => {
    const created = await manager.issueCredential(createTestCredentialConfig());
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;

    const result = manager.isHeartbeatStale(created.value.credentialId);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value).toBe(false);
  });

  test("returns false after recording a fresh heartbeat", async () => {
    const created = await manager.issueCredential(createTestCredentialConfig());
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;

    await new Promise((resolve) => setTimeout(resolve, 500));
    manager.recordHeartbeat(created.value.credentialId);

    const result = manager.isHeartbeatStale(created.value.credentialId);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value).toBe(false);
  });

  test("returns NotFoundError for unknown credential", () => {
    const result = manager.isHeartbeatStale("unknown");
    expect(result.isErr()).toBe(true);
  });
});
