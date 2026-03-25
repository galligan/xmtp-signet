import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { handleAuth } from "../auth-handler.js";
import { AuthError } from "@xmtp/signet-schemas";
import type { CredentialRecord } from "@xmtp/signet-contracts";
import type { AuthFrame } from "../frames.js";

function makeCredentialRecord(
  overrides: Partial<CredentialRecord> = {},
): CredentialRecord {
  return {
    credentialId: "cred_123",
    operatorId: "op_1",
    effectiveScopes: {
      allow: ["send", "reply", "read-messages"],
      deny: [],
    },
    status: "active",
    issuedAt: "2024-01-01T00:00:00Z",
    expiresAt: "2024-01-02T00:00:00Z",
    lastHeartbeat: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("handleAuth", () => {
  const validFrame: AuthFrame = {
    type: "auth",
    token: "valid_token",
    lastSeenSeq: null,
  };

  test("returns credential record on valid token", async () => {
    const lookup = async (_token: string) => Result.ok(makeCredentialRecord());
    const result = await handleAuth(validFrame, lookup);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.credentialId).toBe("cred_123");
    }
  });

  test("returns error when lookup fails", async () => {
    const lookup = async (_token: string) =>
      Result.err(AuthError.create("Invalid token"));
    const result = await handleAuth(validFrame, lookup);
    expect(result.isErr()).toBe(true);
  });

  test("returns error when credential is expired", async () => {
    const lookup = async (_token: string) =>
      Result.ok(makeCredentialRecord({ status: "expired" }));
    const result = await handleAuth(validFrame, lookup);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("not active");
    }
  });

  test("returns error when credential is revoked", async () => {
    const lookup = async (_token: string) =>
      Result.ok(makeCredentialRecord({ status: "revoked" }));
    const result = await handleAuth(validFrame, lookup);
    expect(result.isErr()).toBe(true);
  });
});
