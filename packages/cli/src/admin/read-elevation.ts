import { Result } from "better-result";
import {
  InternalError,
  type AdminReadElevationType,
  type SignetError,
} from "@xmtp/signet-schemas";
import type { AuditLog } from "../audit/log.js";
import type {
  AdminReadDisclosure,
  AdminReadDisclosureStore,
} from "./read-disclosure-store.js";

const DEFAULT_READ_ELEVATION_TTL_MS = 60_000;

/** Local approval surface used to mint temporary admin read elevation. */
export interface AdminReadElevationApprover {
  /** Prompt for local approval of an elevated admin message read. */
  authorize(): Promise<Result<void, SignetError>>;

  /** Fingerprint of the local key that approved the elevation. */
  getApprovalFingerprint(): Promise<Result<string, SignetError>>;
}

/** Input used to resolve message-read elevation for a request. */
export interface ResolveAdminReadElevationInput {
  readonly method: string;
  readonly params: Record<string, unknown>;
  readonly adminFingerprint: string;
  readonly sessionKey: string;
}

/** Reusable resolver for time-bound admin message-read elevation. */
export interface AdminReadElevationManager {
  resolveForRequest(
    input: ResolveAdminReadElevationInput,
  ): Promise<Result<AdminReadElevationType | undefined, SignetError>>;
}

/** Callback fired when public seal disclosure should be refreshed. */
export type AdminReadElevationDisclosureChangeHandler = (
  chatIds: readonly string[],
) => Promise<Result<void, SignetError>>;

/** Dependencies required to manage admin read elevation state. */
export interface AdminReadElevationManagerDeps {
  readonly approver?: AdminReadElevationApprover;
  readonly auditLog?: AuditLog;
  readonly disclosureStore?: AdminReadDisclosureStore;
  readonly onDisclosureChanged?: AdminReadElevationDisclosureChangeHandler;
  readonly disclosureActorId?: AdminReadDisclosure["operatorId"];
  readonly normalizeChatId?: (chatId: string) => string;
  readonly setTimeoutFn?: typeof setTimeout;
  readonly ttlMs?: number;
  readonly now?: () => Date;
}

interface CachedElevation {
  readonly elevation: AdminReadElevationType;
  readonly chatId: string;
  readonly sessionKey: string;
}

function isMessageReadMethod(method: string): boolean {
  return method === "message.list" || method === "message.info";
}

function wantsDangerousMessageRead(params: Record<string, unknown>): boolean {
  return (
    params["dangerouslyAllowMessageRead"] === true ||
    params["dangerouslyAllowMessageRead"] === "true"
  );
}

function resolveChatId(params: Record<string, unknown>): string | null {
  const chatId = params["chatId"];
  return typeof chatId === "string" && chatId.length > 0 ? chatId : null;
}

function buildCacheKey(sessionKey: string, chatId: string): string {
  return `${sessionKey}:${chatId}`;
}

/**
 * Create a transport-agnostic admin read-elevation manager.
 *
 * Elevations are cached in memory per authenticated admin session and chat.
 * Callers must still set the explicit dangerous-read flag on each request;
 * cache reuse only skips the repeated biometric prompt inside the TTL window.
 */
export function createAdminReadElevationManager(
  deps: AdminReadElevationManagerDeps,
): AdminReadElevationManager {
  const ttlMs = deps.ttlMs ?? DEFAULT_READ_ELEVATION_TTL_MS;
  const now = deps.now ?? (() => new Date());
  const normalizeChatId = deps.normalizeChatId ?? ((chatId: string) => chatId);
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
  const cache = new Map<string, CachedElevation>();
  const expirationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const disclosureActorId = deps.disclosureActorId ?? "owner";

  async function appendAudit(entry: {
    action: string;
    success: boolean;
    target?: string;
    detail?: Record<string, unknown>;
  }): Promise<Result<void, InternalError>> {
    if (!deps.auditLog) {
      return Result.ok(undefined);
    }

    try {
      await deps.auditLog.append({
        timestamp: now().toISOString(),
        actor: "admin",
        action: entry.action,
        ...(entry.target !== undefined ? { target: entry.target } : {}),
        ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
        success: entry.success,
      });
      return Result.ok(undefined);
    } catch (cause) {
      return Result.err(
        InternalError.create("Failed to write admin read elevation audit log", {
          cause: cause instanceof Error ? cause.message : String(cause),
          action: entry.action,
        }),
      );
    }
  }

  async function appendReuseAudit(
    input: ResolveAdminReadElevationInput,
    elevation: AdminReadElevationType,
    chatId: string,
  ): Promise<Result<void, SignetError>> {
    const auditResult = await appendAudit({
      action: "admin.read-elevation.reused",
      success: true,
      target: chatId,
      detail: {
        method: input.method,
        adminKeyFingerprint: input.adminFingerprint,
        approvalId: elevation.approvalId,
        expiresAt: elevation.expiresAt,
        mode: "session-scoped",
      },
    });
    return Result.isError(auditResult) ? auditResult : Result.ok(undefined);
  }

  async function appendExpiredAudit(
    input: ResolveAdminReadElevationInput,
    elevation: AdminReadElevationType,
    chatId: string,
  ): Promise<Result<void, SignetError>> {
    const auditResult = await appendAudit({
      action: "admin.read-elevation.expired",
      success: true,
      target: chatId,
      detail: {
        method: input.method,
        adminKeyFingerprint: input.adminFingerprint,
        approvalId: elevation.approvalId,
        expiresAt: elevation.expiresAt,
        mode: "session-scoped",
      },
    });
    return Result.isError(auditResult) ? auditResult : Result.ok(undefined);
  }

  async function notifyDisclosureChanged(
    chatIds: readonly string[],
  ): Promise<Result<void, SignetError>> {
    if (!deps.onDisclosureChanged || chatIds.length === 0) {
      return Result.ok(undefined);
    }
    return deps.onDisclosureChanged(chatIds);
  }

  function clearExpirationTimer(cacheKey: string): void {
    const timer = expirationTimers.get(cacheKey);
    if (timer !== undefined) {
      clearTimeout(timer);
      expirationTimers.delete(cacheKey);
    }
  }

  async function syncDisclosureApproval(
    cached: CachedElevation,
  ): Promise<Result<void, SignetError>> {
    if (!deps.disclosureStore) {
      return Result.ok(undefined);
    }

    const changedChats = deps.disclosureStore.set(
      [cached.chatId],
      cached.sessionKey,
      {
        operatorId: disclosureActorId,
        expiresAt: cached.elevation.expiresAt,
      },
    );

    const notifyResult = await notifyDisclosureChanged(changedChats);
    if (Result.isError(notifyResult)) {
      deps.disclosureStore.delete([cached.chatId], cached.sessionKey);
      return notifyResult;
    }

    return Result.ok(undefined);
  }

  async function syncDisclosureExpiry(
    cached: CachedElevation,
  ): Promise<Result<void, SignetError>> {
    if (!deps.disclosureStore) {
      return Result.ok(undefined);
    }

    const changedChats = deps.disclosureStore.delete(
      [cached.chatId],
      cached.sessionKey,
    );
    return notifyDisclosureChanged(changedChats);
  }

  async function expireCachedElevation(
    cached: CachedElevation,
    input?: ResolveAdminReadElevationInput,
  ): Promise<Result<void, SignetError>> {
    const cacheKey = buildCacheKey(cached.sessionKey, cached.chatId);
    cache.delete(cacheKey);
    clearExpirationTimer(cacheKey);

    const expiredAudit = await appendExpiredAudit(
      input ?? {
        method: "message.list",
        params: { chatId: cached.chatId },
        adminFingerprint: "",
        sessionKey: cached.sessionKey,
      },
      cached.elevation,
      cached.chatId,
    );
    if (Result.isError(expiredAudit)) {
      return expiredAudit;
    }

    const disclosureResult = await syncDisclosureExpiry(cached);
    if (Result.isError(disclosureResult)) {
      const auditResult = await appendAudit({
        action: "admin.read-elevation.disclosure-refresh-failed",
        success: false,
        target: cached.chatId,
        detail: {
          approvalId: cached.elevation.approvalId,
          expiresAt: cached.elevation.expiresAt,
          stage: "expiry",
          reason: disclosureResult.error.message,
          category: disclosureResult.error.category,
        },
      });
      if (Result.isError(auditResult)) {
        return auditResult;
      }
      return disclosureResult;
    }

    return Result.ok(undefined);
  }

  function scheduleExpiration(cached: CachedElevation): void {
    const cacheKey = buildCacheKey(cached.sessionKey, cached.chatId);
    clearExpirationTimer(cacheKey);

    const delayMs = Math.max(
      0,
      Date.parse(cached.elevation.expiresAt) - now().getTime(),
    );
    const timer = setTimeoutFn(() => {
      void expireCachedElevation(cached);
    }, delayMs);
    if (typeof timer === "object" && timer !== null && "unref" in timer) {
      const unref = timer.unref;
      if (typeof unref === "function") {
        unref.call(timer);
      }
    }
    expirationTimers.set(cacheKey, timer);
  }

  return {
    async resolveForRequest(
      input: ResolveAdminReadElevationInput,
    ): Promise<Result<AdminReadElevationType | undefined, SignetError>> {
      if (
        !isMessageReadMethod(input.method) ||
        !wantsDangerousMessageRead(input.params)
      ) {
        return Result.ok(undefined);
      }

      const chatId = resolveChatId(input.params);
      if (chatId === null) {
        return Result.ok(undefined);
      }
      const canonicalChatId = normalizeChatId(chatId);

      const cacheKey = buildCacheKey(input.sessionKey, canonicalChatId);
      const cached = cache.get(cacheKey);
      const nowMs = now().getTime();

      if (cached) {
        const expiresAtMs = Date.parse(cached.elevation.expiresAt);
        if (Number.isFinite(expiresAtMs) && expiresAtMs > nowMs) {
          const reuseAudit = await appendReuseAudit(
            input,
            cached.elevation,
            canonicalChatId,
          );
          if (Result.isError(reuseAudit)) {
            return reuseAudit;
          }
          return Result.ok(cached.elevation);
        }

        const expiryResult = await expireCachedElevation(cached, input);
        if (Result.isError(expiryResult)) {
          return expiryResult;
        }
      }

      if (!deps.approver) {
        return Result.err(
          InternalError.create(
            "Admin read elevation approver is not configured",
            { method: input.method },
          ),
        );
      }

      const authorizeResult = await deps.approver.authorize();
      if (Result.isError(authorizeResult)) {
        const auditResult = await appendAudit({
          action: "admin.read-elevation.denied",
          success: false,
          target: canonicalChatId,
          detail: {
            method: input.method,
            adminKeyFingerprint: input.adminFingerprint,
            reason: authorizeResult.error.message,
            category: authorizeResult.error.category,
            mode: "session-scoped",
          },
        });
        if (Result.isError(auditResult)) {
          return auditResult;
        }
        return authorizeResult;
      }

      const fingerprintResult = await deps.approver.getApprovalFingerprint();
      if (Result.isError(fingerprintResult)) {
        return fingerprintResult;
      }

      const approvedAt = now();
      const elevation: AdminReadElevationType = {
        approvalId: `approval_${crypto.randomUUID().replaceAll("-", "")}`,
        scope: { chatIds: [canonicalChatId] },
        approvedAt: approvedAt.toISOString(),
        expiresAt: new Date(approvedAt.getTime() + ttlMs).toISOString(),
        approvalKeyFingerprint: fingerprintResult.value,
      };
      const nextCached: CachedElevation = {
        elevation,
        chatId: canonicalChatId,
        sessionKey: input.sessionKey,
      };

      const disclosureResult = await syncDisclosureApproval(nextCached);
      if (Result.isError(disclosureResult)) {
        const auditResult = await appendAudit({
          action: "admin.read-elevation.disclosure-refresh-failed",
          success: false,
          target: canonicalChatId,
          detail: {
            method: input.method,
            adminKeyFingerprint: input.adminFingerprint,
            approvalId: elevation.approvalId,
            expiresAt: elevation.expiresAt,
            stage: "approval",
            reason: disclosureResult.error.message,
            category: disclosureResult.error.category,
          },
        });
        if (Result.isError(auditResult)) {
          return auditResult;
        }
        return disclosureResult;
      }

      cache.set(cacheKey, nextCached);
      scheduleExpiration(nextCached);

      const auditResult = await appendAudit({
        action: "admin.read-elevation.approved",
        success: true,
        target: canonicalChatId,
        detail: {
          method: input.method,
          adminKeyFingerprint: input.adminFingerprint,
          approvalId: elevation.approvalId,
          expiresAt: elevation.expiresAt,
          approvalKeyFingerprint: elevation.approvalKeyFingerprint,
          mode: "session-scoped",
        },
      });
      if (Result.isError(auditResult)) {
        return auditResult;
      }

      return Result.ok(elevation);
    },
  };
}
