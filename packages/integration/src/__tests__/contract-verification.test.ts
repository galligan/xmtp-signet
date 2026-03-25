/**
 * Contract verification tests.
 *
 * Validates that concrete implementations satisfy their public contract
 * interfaces at the type level. If this file compiles, the contracts match.
 */

import { describe, test, expect } from "bun:test";
import { Result } from "better-result";
import type {
  CredentialManager,
  CredentialRecord,
  SealManager,
  SealStamper,
  SignerProvider,
  SignetCore,
} from "@xmtp/signet-contracts";
import {
  AuthError,
  CancelledError,
  CredentialExpiredError,
  GrantDeniedError,
  InternalError,
  NotFoundError,
  PermissionError,
  SealError,
  TimeoutError,
  ValidationError,
  type CredentialConfigType,
} from "@xmtp/signet-schemas";

function makeCredentialRecord(
  overrides: Partial<CredentialRecord> = {},
): CredentialRecord {
  return {
    id: "cred_1234abcdfeedbabe",
    config: {
      operatorId: "op_1234abcdfeedbabe",
      chatIds: ["conv_1234abcdfeedbabe"],
      allow: ["send", "read-messages"],
      deny: [],
    },
    inboxIds: [],
    credentialId: "cred_1234abcdfeedbabe",
    operatorId: "op_1234abcdfeedbabe",
    effectiveScopes: {
      allow: ["send", "read-messages"],
      deny: [],
    },
    status: "active",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    issuedBy: "op_1234abcdfeedbabe",
    isExpired: false,
    lastHeartbeat: new Date().toISOString(),
    ...overrides,
  };
}

describe("contract-verification", () => {
  test("all error types are constructable and have correct categories", () => {
    const errors = [
      {
        instance: ValidationError.create("field", "reason"),
        category: "validation",
        tag: "ValidationError",
      },
      {
        instance: SealError.create("id", "reason"),
        category: "validation",
        tag: "SealError",
      },
      {
        instance: NotFoundError.create("resource", "id"),
        category: "not_found",
        tag: "NotFoundError",
      },
      {
        instance: PermissionError.create("denied"),
        category: "permission",
        tag: "PermissionError",
      },
      {
        instance: AuthError.create("auth failed"),
        category: "auth",
        tag: "AuthError",
      },
      {
        instance: CredentialExpiredError.create("cred_1234abcdfeedbabe"),
        category: "auth",
        tag: "CredentialExpiredError",
      },
      {
        instance: InternalError.create("internal"),
        category: "internal",
        tag: "InternalError",
      },
      {
        instance: TimeoutError.create("timed out", 5000),
        category: "timeout",
        tag: "TimeoutError",
      },
      {
        instance: CancelledError.create("cancelled"),
        category: "cancelled",
        tag: "CancelledError",
      },
    ];

    for (const { instance, category, tag } of errors) {
      expect(instance).toBeInstanceOf(Error);
      expect(instance.category as string).toBe(category);
      expect(instance._tag as string).toBe(tag);
      expect(typeof instance.code).toBe("number");
      expect(typeof instance.message).toBe("string");
    }
  });

  test("error instances extend Error and expose SignetError fields", () => {
    const err = ValidationError.create("test", "reason");
    expect(err instanceof Error).toBe(true);
    expect(err._tag).toBe("ValidationError");
    expect(err.code).toBe(1000);
    expect(err.category).toBe("validation");
    expect(err.context).toEqual(
      expect.objectContaining({ field: "test", reason: "reason" }),
    );
  });

  test("GrantDeniedError contains operation and grantType context", () => {
    const err = GrantDeniedError.create("send_message", "messaging.send");
    expect(err.context.operation).toBe("send_message");
    expect(err.context.grantType).toBe("messaging.send");
    expect(err.message).toContain("send_message");
  });

  test("CredentialExpiredError contains credentialId context", () => {
    const err = CredentialExpiredError.create("cred_123");
    expect(err.context.credentialId).toBe("cred_123");
  });

  test("type-level: implementations satisfy current contract interfaces", () => {
    const _signetCore: SignetCore = {
      get state() {
        return "ready" as const;
      },
      async initializeLocal() {
        return Result.ok(undefined);
      },
      async initialize() {
        return Result.ok(undefined);
      },
      async shutdown() {
        return Result.ok(undefined);
      },
      async sendMessage(_groupId: string, _contentType: string, _content) {
        return Result.ok({ messageId: "msg_1234abcdfeedbabe" });
      },
      async getGroupInfo(_groupId: string) {
        return Result.ok({
          groupId: "conv_1234abcdfeedbabe",
          identityKeyFingerprint: "fp_test",
          memberInboxIds: [] as readonly string[],
          createdAt: new Date().toISOString(),
        });
      },
    };

    const config: CredentialConfigType = {
      operatorId: "op_1234abcdfeedbabe",
      chatIds: ["conv_1234abcdfeedbabe"],
      allow: ["send", "read-messages"],
      deny: [],
      ttlSeconds: 60,
    };

    const _credentialManager: CredentialManager = {
      async issue(_config: CredentialConfigType) {
        return Result.ok({
          token: "token",
          credential: {
            id: "cred_1234abcdfeedbabe",
            config,
            inboxIds: [],
            status: "active",
            issuedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            issuedBy: "op_1234abcdfeedbabe",
          },
        });
      },
      async list(_operatorId?: string) {
        return Result.ok([makeCredentialRecord()]);
      },
      async lookup(_credentialId: string) {
        return Result.ok(makeCredentialRecord());
      },
      async lookupByToken(_token: string) {
        return Result.ok(makeCredentialRecord());
      },
      async revoke(_credentialId: string, _reason) {
        return Result.ok(undefined);
      },
      async update(_credentialId: string, _changes) {
        return Result.ok(makeCredentialRecord());
      },
      async renew(_credentialId: string) {
        return Result.ok({
          credentialId: "cred_1234abcdfeedbabe",
          operatorId: "op_1234abcdfeedbabe",
          fingerprint: "fp_test",
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
      },
    };

    const _sealManager: SealManager = {
      async issue(_credentialId: string, _chatId: string) {
        return Result.err(InternalError.create("stub"));
      },
      async refresh(_sealId: string) {
        return Result.err(InternalError.create("stub"));
      },
      async revoke(_sealId: string, _reason) {
        return Result.ok(undefined);
      },
      async current(_credentialId: string, _chatId: string) {
        return Result.ok(null);
      },
    };

    const _signerProvider: SignerProvider = {
      async sign(_data: Uint8Array) {
        return Result.ok(new Uint8Array([1, 2, 3]));
      },
      async getPublicKey() {
        return Result.ok(new Uint8Array([4, 5, 6]));
      },
      async getFingerprint() {
        return Result.ok("fp_mock");
      },
      async getDbEncryptionKey() {
        return Result.ok(new Uint8Array(32));
      },
      async getXmtpIdentityKey() {
        return Result.ok(`0x${"11".repeat(32)}` as const);
      },
    };

    const _sealStamper: SealStamper = {
      async sign(_payload) {
        return Result.err(InternalError.create("stub"));
      },
      async signRevocation(_payload) {
        return Result.err(InternalError.create("stub"));
      },
    };

    expect(_signetCore).toBeDefined();
    expect(_credentialManager).toBeDefined();
    expect(_sealManager).toBeDefined();
    expect(_signerProvider).toBeDefined();
    expect(_sealStamper).toBeDefined();
  });
});
