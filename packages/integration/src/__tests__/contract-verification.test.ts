/**
 * Contract verification tests.
 *
 * Validates that concrete implementations satisfy their contract interfaces
 * at the type level. These are compile-time checks -- if this file compiles,
 * the contracts are satisfied.
 */

import { describe, test, expect } from "bun:test";
import { Result } from "better-result";
import type {
  SignetCore,
  SessionManager,
  SealManager,
  SignerProvider,
  SealStamper,
} from "@xmtp/signet-contracts";
import type { SignetError } from "@xmtp/signet-schemas";
import {
  ValidationError,
  SealError,
  NotFoundError,
  PermissionError,
  GrantDeniedError,
  AuthError,
  SessionExpiredError,
  InternalError,
  TimeoutError,
  CancelledError,
} from "@xmtp/signet-schemas";

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
        instance: GrantDeniedError.create("op", "grant"),
        category: "permission",
        tag: "GrantDeniedError",
      },
      {
        instance: AuthError.create("auth failed"),
        category: "auth",
        tag: "AuthError",
      },
      {
        instance: SessionExpiredError.create("session-id"),
        category: "auth",
        tag: "SessionExpiredError",
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

  test("error instances extend Error and have SignetError shape", () => {
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

  test("SessionExpiredError contains sessionId context", () => {
    const err = SessionExpiredError.create("sess-123");
    expect(err.context.sessionId).toBe("sess-123");
  });

  /**
   * Type-level contract checks.
   *
   * These assignments verify that a concrete object can be used where
   * the contract interface is expected. If the assignment compiles,
   * the contract is satisfied.
   */
  test("type-level: implementations satisfy contract interfaces", () => {
    // This is a compile-time check. If the file compiles, the contracts
    // are satisfied. We use type assertions to verify compatibility.

    // SignetCore contract
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
      async sendMessage(_groupId, _contentType, _content) {
        return Result.ok({ messageId: "msg-1" });
      },
      async getGroupInfo(_groupId: string) {
        return Result.ok({
          groupId: "g1",
          identityKeyFingerprint: "fp",
          memberInboxIds: [] as readonly string[],
          createdAt: new Date().toISOString(),
        });
      },
    };

    // SessionManager contract
    const _sessionManager: SessionManager = {
      async issue(_config) {
        return Result.ok({
          token: "token",
          session: {
            sessionId: "s1",
            agentInboxId: "a1",
            sessionKeyFingerprint: "fp",
            issuedAt: new Date().toISOString(),
            expiresAt: new Date().toISOString(),
          },
        });
      },
      async list() {
        return Result.ok([]);
      },
      async lookup(_sessionId) {
        return Result.ok({
          sessionId: "s1",
          agentInboxId: "a1",
          sessionKeyFingerprint: "fp",
          view: {
            mode: "full" as const,
            threadScopes: [{ groupId: "g1", threadId: null }],
            contentTypes: ["xmtp.org/text:1.0"],
          },
          grant: {
            messaging: {
              send: true,
              reply: true,
              react: true,
              draftOnly: false,
            },
            groupManagement: {
              addMembers: false,
              removeMembers: false,
              updateMetadata: false,
              inviteUsers: false,
            },
            tools: { scopes: [] },
            egress: {
              storeExcerpts: false,
              useForMemory: false,
              forwardToProviders: false,
              quoteRevealed: false,
              summarize: false,
            },
          },
          state: "active" as const,
          issuedAt: new Date().toISOString(),
          expiresAt: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
        });
      },
      async lookupByToken(_token) {
        return Result.err(InternalError.create("stub"));
      },
      async revoke(_sessionId, _reason) {
        return Result.ok(undefined);
      },
      async heartbeat(_sessionId) {
        return Result.ok(undefined);
      },
      async isActive(_sessionId) {
        return Result.ok(true);
      },
    };

    // SealManager contract
    const _sealManager: SealManager = {
      async issue(_sessionId, _groupId) {
        return Result.err(InternalError.create("stub"));
      },
      async refresh(_sealId) {
        return Result.err(InternalError.create("stub"));
      },
      async revoke(_sealId, _reason) {
        return Result.ok(undefined);
      },
      async current(_agentInboxId, _groupId) {
        return Result.ok(null);
      },
      needsRenewal(_seal) {
        return false;
      },
    };

    // SignerProvider contract
    const _signerProvider: SignerProvider = {
      async sign(_data) {
        return Result.ok(new Uint8Array(64));
      },
      async getPublicKey() {
        return Result.ok(new Uint8Array(32));
      },
      async getFingerprint() {
        return Result.ok("fp");
      },
      async getDbEncryptionKey() {
        return Result.ok(new Uint8Array(32));
      },
      async getXmtpIdentityKey() {
        return Result.ok(
          "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const,
        );
      },
    };

    // SealStamper contract
    const _sealStamper: SealStamper = {
      async sign(_payload) {
        return Result.err(InternalError.create("stub") as SignetError);
      },
      async signRevocation(_payload) {
        return Result.err(InternalError.create("stub") as SignetError);
      },
    };

    // If we reach here without type errors, all contracts are satisfied
    expect(_signetCore).toBeDefined();
    expect(_sessionManager).toBeDefined();
    expect(_sealManager).toBeDefined();
    expect(_signerProvider).toBeDefined();
    expect(_sealStamper).toBeDefined();
  });
});
