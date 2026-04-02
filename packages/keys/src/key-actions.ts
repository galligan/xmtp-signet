import { Result } from "better-result";
import { z } from "zod";
import type { ActionSpec, OperatorManager } from "@xmtp/signet-contracts";
import type {
  OperatorRecordType,
  SignetError,
  TrustTierType,
  WalletProviderType,
} from "@xmtp/signet-schemas";
import {
  NotFoundError,
  OperatorId,
  TrustTier,
  ValidationError,
  WalletProvider,
} from "@xmtp/signet-schemas";
import type { KeyManager } from "./key-manager-compat.js";
import type { OperationalKey } from "./types.js";

/** Dependencies required to expose key actions through the runtime. */
export interface KeyActionDeps {
  readonly keyManager: KeyManager;
  readonly operatorManager: OperatorManager;
}

type KeySummary = {
  readonly keyId: string;
  readonly identityId: string;
  readonly operatorId?: string | undefined;
  readonly groupId: string | null;
  readonly publicKey: string;
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly rotatedAt: string | null;
  readonly tier: "operational";
  readonly trustTier: TrustTierType;
  readonly walletId?: string | undefined;
  readonly provider?: WalletProviderType | undefined;
};

type KeyInitResult = {
  readonly operatorId: string;
  readonly walletId: string;
  readonly provider: WalletProviderType;
  readonly trustTier: TrustTierType;
  readonly createdWallet: boolean;
  readonly createdOperationalKey: boolean;
  readonly identityKeyRef: string;
  readonly operationalKey: KeySummary;
};

const KeySummarySchema: z.ZodType<KeySummary> = z.object({
  keyId: z.string().min(1),
  identityId: z.string().min(1),
  operatorId: z.string().optional(),
  groupId: z.string().nullable(),
  publicKey: z.string().min(1),
  fingerprint: z.string().min(1),
  createdAt: z.string(),
  rotatedAt: z.string().nullable(),
  tier: z.literal("operational"),
  trustTier: TrustTier,
  walletId: z.string().optional(),
  provider: WalletProvider.optional(),
});

const KeyInitResultSchema: z.ZodType<KeyInitResult> = z.object({
  operatorId: z.string().min(1),
  walletId: z.string().min(1),
  provider: WalletProvider,
  trustTier: TrustTier,
  createdWallet: z.boolean(),
  createdOperationalKey: z.boolean(),
  identityKeyRef: z.string().min(1),
  operationalKey: KeySummarySchema,
});

function widenActionSpec<TInput, TOutput>(
  spec: ActionSpec<TInput, TOutput, SignetError>,
): ActionSpec<unknown, unknown, SignetError> {
  return spec as ActionSpec<unknown, unknown, SignetError>;
}

async function resolveOperator(
  manager: OperatorManager,
  operatorId: string,
): Promise<Result<OperatorRecordType, SignetError>> {
  if (operatorId.startsWith("op_")) {
    if (!OperatorId.safeParse(operatorId).success) {
      return Result.err(
        ValidationError.create(
          "operatorId",
          `Invalid operator ID format: ${operatorId}`,
        ),
      );
    }
    const record = await manager.lookup(operatorId);
    if (Result.isError(record)) {
      return record;
    }
    if (record.value.status === "removed") {
      return Result.err(NotFoundError.create("operator", operatorId));
    }
    return Result.ok(record.value);
  }

  const listed = await manager.list();
  if (Result.isError(listed)) {
    return listed;
  }

  const matches = listed.value.filter(
    (record) => record.config.label === operatorId,
  );
  if (matches.length === 0) {
    return Result.err(NotFoundError.create("operator", operatorId));
  }
  if (matches.length > 1) {
    return Result.err(
      ValidationError.create("operatorId", "Ambiguous operator label", {
        label: operatorId,
        matchingIds: matches.map((record) => record.id),
      }),
    );
  }

  return Result.ok(matches[0]!);
}

async function summarizeOperationalKey(
  key: OperationalKey,
  deps: KeyActionDeps,
): Promise<Result<KeySummary, SignetError>> {
  const operator = await deps.operatorManager.lookup(key.identityId);

  if (Result.isError(operator)) {
    if (operator.error._tag !== "NotFoundError") {
      return operator;
    }

    return Result.ok({
      keyId: key.keyId,
      identityId: key.identityId,
      groupId: key.groupId,
      publicKey: key.publicKey,
      fingerprint: key.fingerprint,
      createdAt: key.createdAt,
      rotatedAt: key.rotatedAt,
      tier: "operational",
      trustTier: deps.keyManager.trustTier,
    });
  }

  return Result.ok({
    keyId: key.keyId,
    identityId: key.identityId,
    operatorId: operator.value.id,
    groupId: key.groupId,
    publicKey: key.publicKey,
    fingerprint: key.fingerprint,
    createdAt: key.createdAt,
    rotatedAt: key.rotatedAt,
    tier: "operational",
    trustTier: deps.keyManager.trustTier,
    walletId: operator.value.config.walletId,
    provider: operator.value.config.provider,
  });
}

async function summarizeOperationalKeys(
  keys: readonly OperationalKey[],
  deps: KeyActionDeps,
): Promise<Result<readonly KeySummary[], SignetError>> {
  const summaries: KeySummary[] = [];

  for (const key of keys) {
    const summary = await summarizeOperationalKey(key, deps);
    if (Result.isError(summary)) {
      return summary;
    }
    summaries.push(summary.value);
  }

  return Result.ok(summaries);
}

/** Create key lifecycle actions for the CLI and admin surfaces. */
export function createKeyActions(
  deps: KeyActionDeps,
): ActionSpec<unknown, unknown, SignetError>[] {
  const init: ActionSpec<
    { operatorId: string; walletId?: string | undefined },
    KeyInitResult,
    SignetError
  > = {
    id: "keys.init",
    description: "Initialize operator key material and wallet binding",
    intent: "write",
    input: z.object({
      operatorId: z.string().min(1),
      walletId: z.string().min(1).optional(),
    }),
    output: KeyInitResultSchema,
    handler: async (input) => {
      const operator = await resolveOperator(
        deps.operatorManager,
        input.operatorId,
      );
      if (Result.isError(operator)) {
        return operator;
      }

      const provider = operator.value.config.provider ?? "internal";
      if (provider !== "internal") {
        return Result.err(
          ValidationError.create(
            "provider",
            "Only the internal wallet provider is currently supported for keys.init",
            {
              operatorId: operator.value.id,
              provider,
            },
          ),
        );
      }

      let walletId = input.walletId ?? operator.value.config.walletId;
      let createdWallet = false;

      if (walletId === undefined) {
        const created = await deps.keyManager.createWallet(
          operator.value.config.label,
        );
        if (Result.isError(created)) {
          return created;
        }
        walletId = created.value.id;
        createdWallet = true;
      } else {
        const wallet = await deps.keyManager.getWallet(walletId);
        if (Result.isError(wallet)) {
          return wallet;
        }
      }

      if (walletId !== operator.value.config.walletId) {
        const updated = await deps.operatorManager.update(operator.value.id, {
          walletId,
        });
        if (Result.isError(updated)) {
          return updated;
        }
      }

      const existing = deps.keyManager.getOperationalKey(operator.value.id);
      let operationalKey: OperationalKey;
      let createdOperationalKey = false;

      if (Result.isError(existing)) {
        const created = await deps.keyManager.createOperationalKey(
          operator.value.id,
          null,
        );
        if (Result.isError(created)) {
          return created;
        }
        operationalKey = created.value;
        createdOperationalKey = true;
      } else {
        operationalKey = existing.value;
      }

      const identityKey = await deps.keyManager.getOrCreateXmtpIdentityKey(
        operator.value.id,
      );
      if (Result.isError(identityKey)) {
        return identityKey;
      }

      const summary = await summarizeOperationalKey(operationalKey, deps);
      if (Result.isError(summary)) {
        return summary;
      }

      return Result.ok({
        operatorId: operator.value.id,
        walletId,
        provider,
        trustTier: deps.keyManager.trustTier,
        createdWallet,
        createdOperationalKey,
        identityKeyRef: `xmtp-identity-key:${operator.value.id}`,
        operationalKey: summary.value,
      });
    },
    cli: {
      command: "keys:init",
    },
    http: {
      auth: "admin",
    },
  };

  const list: ActionSpec<
    Record<string, never>,
    readonly KeySummary[],
    SignetError
  > = {
    id: "keys.list",
    description: "List operational keys known to the signet",
    intent: "read",
    idempotent: true,
    input: z.object({}),
    output: z.array(KeySummarySchema),
    handler: async () =>
      summarizeOperationalKeys(deps.keyManager.listOperationalKeys(), deps),
    cli: {
      command: "keys:list",
    },
    http: {
      auth: "admin",
    },
  };

  const info: ActionSpec<{ keyId: string }, KeySummary, SignetError> = {
    id: "keys.info",
    description: "Show operational key details by key ID or identity ID",
    intent: "read",
    idempotent: true,
    input: z.object({
      keyId: z.string().min(1),
    }),
    output: KeySummarySchema,
    handler: async (input) => {
      const key =
        deps.keyManager
          .listOperationalKeys()
          .find(
            (candidate) =>
              candidate.keyId === input.keyId ||
              candidate.identityId === input.keyId,
          ) ?? null;

      if (key === null) {
        return Result.err(NotFoundError.create("key", input.keyId));
      }

      return summarizeOperationalKey(key, deps);
    },
    cli: {
      command: "keys:info",
    },
    http: {
      auth: "admin",
    },
  };

  const exportPublic: ActionSpec<
    { keyId: string },
    {
      keyId: string;
      identityId: string;
      publicKey: string;
      fingerprint: string;
      trustTier: TrustTierType;
    },
    SignetError
  > = {
    id: "keys.export-public",
    description: "Export public key material for an operational key",
    intent: "read",
    idempotent: true,
    input: z.object({
      keyId: z.string().min(1),
    }),
    output: z.object({
      keyId: z.string().min(1),
      identityId: z.string().min(1),
      publicKey: z.string().min(1),
      fingerprint: z.string().min(1),
      trustTier: TrustTier,
    }),
    handler: async (input) => {
      const key =
        deps.keyManager
          .listOperationalKeys()
          .find(
            (candidate) =>
              candidate.keyId === input.keyId ||
              candidate.identityId === input.keyId,
          ) ?? null;

      if (key === null) {
        return Result.err(NotFoundError.create("key", input.keyId));
      }

      return Result.ok({
        keyId: key.keyId,
        identityId: key.identityId,
        publicKey: key.publicKey,
        fingerprint: key.fingerprint,
        trustTier: deps.keyManager.trustTier,
      });
    },
    cli: {
      command: "keys:export-public",
    },
    http: {
      auth: "admin",
    },
  };

  return [
    widenActionSpec(init),
    widenActionSpec(list),
    widenActionSpec(info),
    widenActionSpec(exportPublic),
  ];
}
