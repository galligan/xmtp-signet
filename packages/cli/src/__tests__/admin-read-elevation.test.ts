import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { InternalError, PermissionError } from "@xmtp/signet-schemas";
import { createAdminReadElevationManager } from "../admin/read-elevation.js";
import { createAdminReadDisclosureStore } from "../admin/read-disclosure-store.js";

describe("createAdminReadElevationManager", () => {
  test("reuses a live elevation within the TTL window", async () => {
    let authorizeCalls = 0;
    let currentTime = new Date("2026-04-14T15:00:00.000Z");

    const manager = createAdminReadElevationManager({
      approver: {
        async authorize() {
          authorizeCalls += 1;
          return Result.ok(undefined);
        },
        async getApprovalFingerprint() {
          return Result.ok("approval-fingerprint");
        },
      },
      now: () => currentTime,
      ttlMs: 60_000,
    });

    const first = await manager.resolveForRequest({
      method: "message.list",
      params: {
        chatId: "conv_reuse",
        dangerouslyAllowMessageRead: true,
      },
      adminFingerprint: "admin-fingerprint",
      sessionKey: "admin-fingerprint:test-jti",
    });
    currentTime = new Date("2026-04-14T15:00:20.000Z");
    const second = await manager.resolveForRequest({
      method: "message.info",
      params: {
        chatId: "conv_reuse",
        messageId: "msg_2",
        dangerouslyAllowMessageRead: true,
      },
      adminFingerprint: "admin-fingerprint",
      sessionKey: "admin-fingerprint:test-jti",
    });

    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    if (first.isOk() && second.isOk()) {
      expect(first.value?.approvalId).toBe(second.value?.approvalId);
    }
    expect(authorizeCalls).toBe(1);
  });

  test("treats search.messages as an elevated message-read operation", async () => {
    let authorizeCalls = 0;
    const manager = createAdminReadElevationManager({
      approver: {
        async authorize() {
          authorizeCalls += 1;
          return Result.ok(undefined);
        },
        async getApprovalFingerprint() {
          return Result.ok("approval-fingerprint");
        },
      },
    });

    const result = await manager.resolveForRequest({
      method: "search.messages",
      params: {
        chatId: "conv_search",
        query: "secret",
        dangerouslyAllowMessageRead: true,
      },
      adminFingerprint: "admin-fingerprint",
      sessionKey: "admin-fingerprint:test-jti",
    });

    expect(result.isOk()).toBe(true);
    expect(authorizeCalls).toBe(1);
  });

  test("re-prompts after the cached elevation expires", async () => {
    let authorizeCalls = 0;
    let currentTime = new Date("2026-04-14T15:00:00.000Z");
    const auditActions: string[] = [];

    const manager = createAdminReadElevationManager({
      approver: {
        async authorize() {
          authorizeCalls += 1;
          return Result.ok(undefined);
        },
        async getApprovalFingerprint() {
          return Result.ok("approval-fingerprint");
        },
      },
      auditLog: {
        path: ":memory:",
        async append(entry) {
          auditActions.push(entry.action);
        },
        async tail() {
          return [];
        },
        async readAll() {
          return [];
        },
      },
      now: () => currentTime,
      ttlMs: 1_000,
    });

    const first = await manager.resolveForRequest({
      method: "message.list",
      params: {
        chatId: "conv_expire",
        dangerouslyAllowMessageRead: true,
      },
      adminFingerprint: "admin-fingerprint",
      sessionKey: "admin-fingerprint:test-jti",
    });
    currentTime = new Date("2026-04-14T15:00:02.000Z");
    const second = await manager.resolveForRequest({
      method: "message.list",
      params: {
        chatId: "conv_expire",
        dangerouslyAllowMessageRead: true,
      },
      adminFingerprint: "admin-fingerprint",
      sessionKey: "admin-fingerprint:test-jti",
    });

    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    if (first.isOk() && second.isOk()) {
      expect(first.value?.approvalId).not.toBe(second.value?.approvalId);
    }
    expect(authorizeCalls).toBe(2);
    expect(auditActions).toContain("admin.read-elevation.expired");
  });

  test("returns denial errors from the local approver", async () => {
    const manager = createAdminReadElevationManager({
      approver: {
        async authorize() {
          return Result.err(PermissionError.create("Elevation denied"));
        },
        async getApprovalFingerprint() {
          return Result.ok("approval-fingerprint");
        },
      },
    });

    const result = await manager.resolveForRequest({
      method: "message.list",
      params: {
        chatId: "conv_denied",
        dangerouslyAllowMessageRead: true,
      },
      adminFingerprint: "admin-fingerprint",
      sessionKey: "admin-fingerprint:test-jti",
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.category).toBe("permission");
      expect(result.error.message).toContain("Elevation denied");
    }
  });

  test("updates public disclosure state when approval is granted and expires", async () => {
    let currentTime = new Date("2026-04-14T15:00:00.000Z");
    const disclosureStore = createAdminReadDisclosureStore({
      now: () => currentTime,
    });
    const changedChatBatches: string[][] = [];

    const manager = createAdminReadElevationManager({
      approver: {
        async authorize() {
          return Result.ok(undefined);
        },
        async getApprovalFingerprint() {
          return Result.ok("approval-fingerprint");
        },
      },
      disclosureStore,
      onDisclosureChanged: async (chatIds) => {
        changedChatBatches.push([...chatIds]);
        return Result.ok(undefined);
      },
      now: () => currentTime,
      ttlMs: 1_000,
    });

    const first = await manager.resolveForRequest({
      method: "message.list",
      params: {
        chatId: "conv_disclosed",
        dangerouslyAllowMessageRead: true,
      },
      adminFingerprint: "admin-fingerprint",
      sessionKey: "admin-fingerprint:test-jti",
    });

    expect(first.isOk()).toBe(true);
    expect(disclosureStore.get("conv_disclosed")).toEqual({
      operatorId: "owner",
      expiresAt: "2026-04-14T15:00:01.000Z",
    });

    currentTime = new Date("2026-04-14T15:00:02.000Z");
    const second = await manager.resolveForRequest({
      method: "message.list",
      params: {
        chatId: "conv_disclosed",
        dangerouslyAllowMessageRead: true,
      },
      adminFingerprint: "admin-fingerprint",
      sessionKey: "admin-fingerprint:test-jti",
    });

    expect(second.isOk()).toBe(true);
    expect(changedChatBatches).toEqual([
      ["conv_disclosed"],
      ["conv_disclosed"],
    ]);
    expect(disclosureStore.get("conv_disclosed")).toEqual({
      operatorId: "owner",
      expiresAt: "2026-04-14T15:00:03.000Z",
    });
  });

  test("normalizes chat IDs before caching elevation and disclosure state", async () => {
    let authorizeCalls = 0;
    const currentTime = new Date("2026-04-14T15:00:00.000Z");
    const disclosureStore = createAdminReadDisclosureStore({
      now: () => currentTime,
    });
    const manager = createAdminReadElevationManager({
      approver: {
        async authorize() {
          authorizeCalls += 1;
          return Result.ok(undefined);
        },
        async getApprovalFingerprint() {
          return Result.ok("approval-fingerprint");
        },
      },
      disclosureStore,
      normalizeChatId: (chatId) =>
        chatId === "group_raw" ? "conv_normalized" : chatId,
      ttlMs: 60_000,
      now: () => currentTime,
    });

    const first = await manager.resolveForRequest({
      method: "message.list",
      params: {
        chatId: "group_raw",
        dangerouslyAllowMessageRead: true,
      },
      adminFingerprint: "admin-fingerprint",
      sessionKey: "admin-fingerprint:test-jti",
    });
    const second = await manager.resolveForRequest({
      method: "message.info",
      params: {
        chatId: "conv_normalized",
        messageId: "msg_1",
        dangerouslyAllowMessageRead: true,
      },
      adminFingerprint: "admin-fingerprint",
      sessionKey: "admin-fingerprint:test-jti",
    });

    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    if (first.isOk() && second.isOk()) {
      expect(first.value?.approvalId).toBe(second.value?.approvalId);
      expect(first.value?.scope.chatIds).toEqual(["conv_normalized"]);
      expect(second.value?.scope.chatIds).toEqual(["conv_normalized"]);
    }
    expect(authorizeCalls).toBe(1);
    expect(disclosureStore.get("conv_normalized")).toEqual({
      operatorId: "owner",
      expiresAt: "2026-04-14T15:01:00.000Z",
    });
  });

  test("unrefs expiry timers so elevation caching does not block shutdown", async () => {
    let unrefCalls = 0;
    const manager = createAdminReadElevationManager({
      approver: {
        async authorize() {
          return Result.ok(undefined);
        },
        async getApprovalFingerprint() {
          return Result.ok("approval-fingerprint");
        },
      },
      setTimeoutFn: ((handler, delay) => {
        void handler;
        void delay;
        return {
          unref() {
            unrefCalls += 1;
          },
        } as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
    });

    const result = await manager.resolveForRequest({
      method: "message.list",
      params: {
        chatId: "conv_unref",
        dangerouslyAllowMessageRead: true,
      },
      adminFingerprint: "admin-fingerprint",
      sessionKey: "admin-fingerprint:test-jti",
    });

    expect(result.isOk()).toBe(true);
    expect(unrefCalls).toBe(1);
  });

  test("rolls back disclosure and cache state when approval audit fails", async () => {
    let authorizeCalls = 0;
    let failApprovalAudit = true;
    const disclosureStore = createAdminReadDisclosureStore();
    const manager = createAdminReadElevationManager({
      approver: {
        async authorize() {
          authorizeCalls += 1;
          return Result.ok(undefined);
        },
        async getApprovalFingerprint() {
          return Result.ok("approval-fingerprint");
        },
      },
      disclosureStore,
      auditLog: {
        path: ":memory:",
        async append(entry) {
          if (
            failApprovalAudit &&
            entry.action === "admin.read-elevation.approved"
          ) {
            throw new Error("disk full");
          }
        },
        async tail() {
          return [];
        },
        async readAll() {
          return [];
        },
      },
    });

    const first = await manager.resolveForRequest({
      method: "message.list",
      params: {
        chatId: "conv_audit_fail",
        dangerouslyAllowMessageRead: true,
      },
      adminFingerprint: "admin-fingerprint",
      sessionKey: "admin-fingerprint:test-jti",
    });

    expect(first.isErr()).toBe(true);
    expect(disclosureStore.get("conv_audit_fail")).toBeUndefined();

    failApprovalAudit = false;
    const second = await manager.resolveForRequest({
      method: "message.list",
      params: {
        chatId: "conv_audit_fail",
        dangerouslyAllowMessageRead: true,
      },
      adminFingerprint: "admin-fingerprint",
      sessionKey: "admin-fingerprint:test-jti",
    });

    expect(second.isOk()).toBe(true);
    expect(authorizeCalls).toBe(2);
  });

  test("replays disclosure refresh to roll back partial approval updates", async () => {
    const disclosureStore = createAdminReadDisclosureStore();
    const changedChatBatches: string[][] = [];
    let disclosureRefreshCalls = 0;

    const manager = createAdminReadElevationManager({
      approver: {
        async authorize() {
          return Result.ok(undefined);
        },
        async getApprovalFingerprint() {
          return Result.ok("approval-fingerprint");
        },
      },
      disclosureStore,
      onDisclosureChanged: async (chatIds) => {
        changedChatBatches.push([...chatIds]);
        disclosureRefreshCalls += 1;
        if (disclosureRefreshCalls === 1) {
          return Result.err(
            InternalError.create("seal refresh failed", {
              stage: "approval",
            }),
          );
        }
        return Result.ok(undefined);
      },
    });

    const result = await manager.resolveForRequest({
      method: "message.list",
      params: {
        chatId: "conv_partial_refresh",
        dangerouslyAllowMessageRead: true,
      },
      adminFingerprint: "admin-fingerprint",
      sessionKey: "admin-fingerprint:test-jti",
    });

    expect(result.isErr()).toBe(true);
    expect(changedChatBatches).toEqual([
      ["conv_partial_refresh"],
      ["conv_partial_refresh"],
    ]);
    expect(disclosureStore.get("conv_partial_refresh")).toBeUndefined();
  });

  test("clears disclosure state even when expiry audit fails", async () => {
    let currentTime = new Date("2026-04-14T15:00:00.000Z");
    const disclosureStore = createAdminReadDisclosureStore({
      now: () => currentTime,
    });
    const manager = createAdminReadElevationManager({
      approver: {
        async authorize() {
          return Result.ok(undefined);
        },
        async getApprovalFingerprint() {
          return Result.ok("approval-fingerprint");
        },
      },
      disclosureStore,
      auditLog: {
        path: ":memory:",
        async append(entry) {
          if (entry.action === "admin.read-elevation.expired") {
            throw new Error("audit unavailable");
          }
        },
        async tail() {
          return [];
        },
        async readAll() {
          return [];
        },
      },
      now: () => currentTime,
      ttlMs: 1_000,
    });

    const first = await manager.resolveForRequest({
      method: "message.list",
      params: {
        chatId: "conv_expiry_cleanup",
        dangerouslyAllowMessageRead: true,
      },
      adminFingerprint: "admin-fingerprint",
      sessionKey: "admin-fingerprint:test-jti",
    });

    expect(first.isOk()).toBe(true);
    expect(disclosureStore.get("conv_expiry_cleanup")).toEqual({
      operatorId: "owner",
      expiresAt: "2026-04-14T15:00:01.000Z",
    });

    currentTime = new Date("2026-04-14T15:00:02.000Z");
    const second = await manager.resolveForRequest({
      method: "message.list",
      params: {
        chatId: "conv_expiry_cleanup",
        dangerouslyAllowMessageRead: true,
      },
      adminFingerprint: "admin-fingerprint",
      sessionKey: "admin-fingerprint:test-jti",
    });

    expect(second.isErr()).toBe(true);
    expect(disclosureStore.get("conv_expiry_cleanup")).toBeUndefined();
  });
});
