import { Result } from "better-result";
import { z } from "zod";
import type { ActionSpec } from "@xmtp/signet-contracts";
import type { SignetError } from "@xmtp/signet-schemas";
import type { AuditLog, AuditEntry } from "../audit/log.js";
import type { DaemonStatus } from "../daemon/status.js";

/** Verification report for a single key entry. */
export interface KeyVerificationEntry {
  readonly status: "ok" | "missing" | "error";
  readonly publicKey?: string;
  readonly fingerprint?: string;
  readonly error?: string;
}

/** Full key hierarchy verification report. */
export interface KeyVerificationReport {
  readonly platform: string;
  readonly trustTier: string;
  readonly rootKey: KeyVerificationEntry;
  readonly adminKey: KeyVerificationEntry;
  readonly operationalKeys: readonly {
    readonly keyId: string;
    readonly identityId: string;
    readonly status: "ok" | "error";
    readonly fingerprint: string;
  }[];
}

/** Runtime state snapshot returned by admin.export-state. */
export interface RuntimeStateSnapshot {
  readonly status: DaemonStatus;
  readonly operators: readonly unknown[];
  readonly policies: readonly unknown[];
  readonly credentials: readonly unknown[];
  readonly identities: readonly { inboxId: string | null }[];
  readonly errors?: readonly string[];
}

/** Dependencies for the daemon-level `signet:*` CLI actions. */
export interface SignetActionDeps {
  readonly status: () => Promise<DaemonStatus>;
  readonly shutdown: () => Promise<Result<void, SignetError>>;
  readonly rotateKeys?: () => Promise<Result<{ rotated: number }, SignetError>>;
  readonly verifyKeys?: () => Promise<
    Result<KeyVerificationReport, SignetError>
  >;
  readonly exportState?: () => Promise<
    Result<RuntimeStateSnapshot, SignetError>
  >;
  readonly auditLog?: AuditLog;
}

function widenActionSpec<TInput, TOutput>(
  spec: ActionSpec<TInput, TOutput, SignetError>,
): ActionSpec<unknown, unknown, SignetError> {
  return spec as ActionSpec<unknown, unknown, SignetError>;
}

/** Create CLI actions for daemon status and shutdown. */
export function createSignetActions(
  deps: SignetActionDeps,
): ActionSpec<unknown, unknown, SignetError>[] {
  const createStatusSpec = (
    id: string,
    command: string,
  ): ActionSpec<Record<string, never>, DaemonStatus, SignetError> => ({
    id,
    input: z.object({}),
    handler: async () => Result.ok(await deps.status()),
    cli: {
      command,
    },
  });

  const createStopSpec = (
    id: string,
    command: string,
  ): ActionSpec<
    { force?: boolean | undefined },
    { stopped: true },
    SignetError
  > => ({
    id,
    input: z.object({
      force: z.boolean().optional(),
    }),
    handler: async () => {
      const result = await deps.shutdown();
      if (Result.isError(result)) {
        return result;
      }
      return Result.ok({ stopped: true as const });
    },
    cli: {
      command,
    },
  });

  const specs: ActionSpec<unknown, unknown, SignetError>[] = [
    widenActionSpec(createStatusSpec("signet.status", "signet:status")),
    widenActionSpec(createStopSpec("signet.stop", "signet:stop")),
  ];

  if (deps.rotateKeys) {
    const rotate = deps.rotateKeys;
    const rotateSpec: ActionSpec<
      Record<string, never>,
      { rotated: number },
      SignetError
    > = {
      id: "keys.rotate",
      input: z.object({}),
      handler: async () => rotate(),
      cli: {
        command: "keys:rotate",
      },
    };
    specs.push(widenActionSpec(rotateSpec));
  }

  if (deps.verifyKeys) {
    const verify = deps.verifyKeys;
    const verifyKeysSpec: ActionSpec<
      Record<string, never>,
      KeyVerificationReport,
      SignetError
    > = {
      id: "admin.verify-keys",
      description: "Verify key hierarchy integrity",
      input: z.object({}),
      handler: async () => verify(),
      cli: {
        command: "admin:verify-keys",
      },
    };
    specs.push(widenActionSpec(verifyKeysSpec));
  }

  if (deps.exportState) {
    const exportFn = deps.exportState;
    const exportStateSpec: ActionSpec<
      Record<string, never>,
      RuntimeStateSnapshot,
      SignetError
    > = {
      id: "admin.export-state",
      description: "Export full runtime state snapshot",
      input: z.object({}),
      handler: async () => exportFn(),
      cli: {
        command: "admin:export-state",
      },
    };
    specs.push(widenActionSpec(exportStateSpec));
  }

  if (deps.auditLog) {
    const log = deps.auditLog;

    const logsSpec: ActionSpec<
      { limit?: number | undefined; since?: string | undefined },
      readonly AuditEntry[],
      SignetError
    > = {
      id: "admin.logs",
      description: "Read recent audit log entries",
      intent: "read",
      idempotent: true,
      input: z.object({
        limit: z.number().int().positive().optional(),
        since: z.string().optional(),
      }),
      handler: async (input) => {
        if (input.since !== undefined) {
          const all = await log.readAll(input.since);
          const limit = input.limit ?? all.length;
          return Result.ok(all.slice(-limit));
        }
        return Result.ok(await log.tail(input.limit ?? 50));
      },
      cli: {
        command: "admin:logs",
      },
    };
    specs.push(widenActionSpec(logsSpec));

    const logsExportSpec: ActionSpec<
      Record<string, never>,
      readonly AuditEntry[],
      SignetError
    > = {
      id: "admin.logs-export",
      description: "Export the full audit log as NDJSON",
      intent: "read",
      idempotent: true,
      input: z.object({}),
      handler: async () => Result.ok(await log.readAll()),
      cli: {
        command: "admin:logs-export",
      },
    };
    specs.push(widenActionSpec(logsExportSpec));
  }

  return specs;
}
