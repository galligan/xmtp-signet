import type {
  GrantDeniedError,
  PermissionError,
  PermissionScopeType,
} from "@xmtp/signet-schemas";

/** A scope moved between allow and deny within a scope-set diff. */
export interface ScopePolicyChange {
  readonly scope: PermissionScopeType;
  readonly from: "allow" | "deny";
  readonly to: "allow" | "deny";
}

/** Scope-set delta emitted by credential materiality and seal checks. */
export interface PolicyDelta {
  readonly added: readonly PermissionScopeType[];
  readonly removed: readonly PermissionScopeType[];
  readonly changed: ReadonlyArray<ScopePolicyChange>;
}

/** Error union returned by the historical grant validators on this stack cut. */
export type GrantError = PermissionError | GrantDeniedError;
