/**
 * Operator manager implementation.
 *
 * Manages operator registration, lookup, updates, and removal.
 * Uses an in-memory Map store for v1. Implements the
 * {@link OperatorManager} contract from `@xmtp/signet-contracts`.
 */

import { Result } from "better-result";
import type {
  CredentialRevocationReason,
  OperatorConfigType,
  OperatorRecordType,
  SignetError,
} from "@xmtp/signet-schemas";
import {
  createResourceId,
  ValidationError,
  NotFoundError,
  PermissionError,
  OperatorConfig,
} from "@xmtp/signet-schemas";
import type { OperatorManager } from "@xmtp/signet-contracts";

/** Internal helper methods exposed for testing and composition. */
export interface OperatorManagerInternal {
  /** Get count of operators (including removed). */
  readonly size: number;
}

/** Optional lifecycle hooks used by higher-level compositions. */
export interface OperatorManagerOptions {
  /**
   * Revoke active credentials before an operator is removed.
   * When provided, a failing revocation aborts removal.
   */
  readonly revokeCredentials?: (
    operatorId: string,
    reason: CredentialRevocationReason,
  ) => Result<void, SignetError> | Promise<Result<void, SignetError>>;
}

/**
 * Validates an operator config, returning a ValidationError if invalid.
 * Returns null when valid.
 */
function validateConfig(config: OperatorConfigType): ValidationError | null {
  const parsed = OperatorConfig.safeParse(config);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue !== undefined ? issue.path.join(".") : "config";
    const reason = issue !== undefined ? issue.message : "Invalid config";
    return ValidationError.create(field, reason);
  }
  return null;
}

function cloneRecord(record: OperatorRecordType): OperatorRecordType {
  return structuredClone(record);
}

/**
 * Creates an in-memory operator manager implementing the
 * {@link OperatorManager} contract with internal helpers.
 *
 * @returns Combined OperatorManager and OperatorManagerInternal
 */
export function createOperatorManager(
  options?: OperatorManagerOptions,
): OperatorManager & OperatorManagerInternal {
  const store = new Map<string, OperatorRecordType>();
  const revokeCredentials = options?.revokeCredentials;

  return {
    get size(): number {
      return store.size;
    },

    async create(
      config: OperatorConfigType,
    ): Promise<Result<OperatorRecordType, SignetError>> {
      // Validate config fields
      const validationErr = validateConfig(config);
      if (validationErr !== null) {
        return Result.err(validationErr);
      }

      // Superadmin creation requires owner context (deferred to ScopeGuard).
      // For now, reject superadmin creation outright.
      if (config.role === "superadmin") {
        return Result.err(
          PermissionError.create(
            "Cannot create operator with superadmin role without owner authorization",
            { role: config.role },
          ),
        );
      }

      const id = createResourceId("operator");
      const record: OperatorRecordType = {
        id,
        config,
        createdAt: new Date().toISOString(),
        createdBy: "owner",
        status: "active",
      };

      store.set(id, record);
      return Result.ok(cloneRecord(record));
    },

    async list(): Promise<Result<readonly OperatorRecordType[], SignetError>> {
      const active: OperatorRecordType[] = [];
      for (const record of store.values()) {
        if (record.status !== "removed") {
          active.push(cloneRecord(record));
        }
      }
      return Result.ok(active);
    },

    async lookup(
      operatorId: string,
    ): Promise<Result<OperatorRecordType, SignetError>> {
      const record = store.get(operatorId);
      if (record === undefined) {
        return Result.err(NotFoundError.create("operator", operatorId));
      }
      return Result.ok(cloneRecord(record));
    },

    async update(
      operatorId: string,
      changes: Partial<OperatorConfigType>,
    ): Promise<Result<OperatorRecordType, SignetError>> {
      const existing = store.get(operatorId);
      if (existing === undefined) {
        return Result.err(NotFoundError.create("operator", operatorId));
      }

      // Prevent role escalation to superadmin
      if (changes.role === "superadmin") {
        return Result.err(
          PermissionError.create(
            "Cannot escalate operator role to superadmin",
            { operatorId, requestedRole: "superadmin" },
          ),
        );
      }

      // Merge changes into existing config
      const merged: OperatorConfigType = {
        ...existing.config,
        ...changes,
      };

      // Validate merged config
      const validationErr = validateConfig(merged);
      if (validationErr !== null) {
        return Result.err(validationErr);
      }

      const updated: OperatorRecordType = {
        ...existing,
        config: merged,
      };

      store.set(operatorId, updated);
      return Result.ok(cloneRecord(updated));
    },

    async remove(operatorId: string): Promise<Result<void, SignetError>> {
      const existing = store.get(operatorId);
      if (existing === undefined) {
        return Result.err(NotFoundError.create("operator", operatorId));
      }

      if (revokeCredentials) {
        const revokeResult = await revokeCredentials(
          operatorId,
          "owner-initiated",
        );
        if (!revokeResult.isOk()) {
          return revokeResult;
        }
      }

      const removed: OperatorRecordType = {
        ...existing,
        status: "removed",
      };

      store.set(operatorId, removed);
      return Result.ok(undefined);
    },
  };
}
