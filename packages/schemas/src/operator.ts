import { z } from "zod";
import { OperatorId } from "./resource-id.js";

// -- Enums ------------------------------------------------------------------

/** Role assigned to an operator within the signet. */
export const OperatorRole: z.ZodEnum<["operator", "admin", "superadmin"]> =
  z.enum(["operator", "admin", "superadmin"]);

/** Inferred union of operator role strings. */
export type OperatorRoleType = z.infer<typeof OperatorRole>;

/** Whether operator credentials are scoped per-chat or shared. */
export const ScopeMode: z.ZodEnum<["per-chat", "shared"]> = z.enum([
  "per-chat",
  "shared",
]);

/** Inferred union of scope mode strings. */
export type ScopeModeType = z.infer<typeof ScopeMode>;

/** Lifecycle status of an operator. */
export const OperatorStatus: z.ZodEnum<["active", "suspended", "removed"]> =
  z.enum(["active", "suspended", "removed"]);

/** Inferred union of operator status strings. */
export type OperatorStatusType = z.infer<typeof OperatorStatus>;

/** Source of the operator's wallet keys. */
export const WalletProvider: z.ZodEnum<["internal", "ows"]> = z.enum([
  "internal",
  "ows",
]);

/** Inferred union of wallet provider strings. */
export type WalletProviderType = z.infer<typeof WalletProvider>;

// -- Composite schemas ------------------------------------------------------

/** Configuration for an operator within the signet. */
export const OperatorConfig: z.ZodObject<{
  label: z.ZodString;
  role: typeof OperatorRole;
  scopeMode: typeof ScopeMode;
  provider: z.ZodDefault<typeof WalletProvider>;
  walletId: z.ZodOptional<z.ZodString>;
}> = z.object({
  /** Human-readable name for the operator. */
  label: z.string().min(1),
  /** Role assigned to this operator. */
  role: OperatorRole,
  /** Whether credentials are per-chat or shared. */
  scopeMode: ScopeMode,
  /** Wallet key source. Defaults to internal when omitted. */
  provider: WalletProvider.default("internal"),
  /** Reference to the backing wallet. */
  walletId: z.string().optional(),
});

/** Inferred type for operator configuration. */
export type OperatorConfigType = z.infer<typeof OperatorConfig>;

/** Persisted record for a registered operator. */
export const OperatorRecord: z.ZodObject<{
  id: z.ZodType<string>;
  config: typeof OperatorConfig;
  createdAt: z.ZodString;
  createdBy: z.ZodUnion<[z.ZodType<string>, z.ZodLiteral<"owner">]>;
  status: typeof OperatorStatus;
}> = z.object({
  /** Prefixed operator resource ID. */
  id: OperatorId,
  /** Operator configuration. */
  config: OperatorConfig,
  /** ISO 8601 timestamp of creation. */
  createdAt: z.string().datetime(),
  /** Creator: the signet owner or another operator. */
  createdBy: z.union([OperatorId, z.literal("owner")]),
  /** Current lifecycle status. */
  status: OperatorStatus,
});

/** Inferred type for a persisted operator record. */
export type OperatorRecordType = z.infer<typeof OperatorRecord>;
