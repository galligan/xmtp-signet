import type {
  GrantDeniedError,
  PermissionError,
  PermissionScopeType,
} from "@xmtp/signet-schemas";

/** Describes a change between two scope configurations. */
export interface PolicyDelta {
  readonly added: readonly PermissionScopeType[];
  readonly removed: readonly PermissionScopeType[];
  readonly changed: ReadonlyArray<{
    scope: PermissionScopeType;
    from: "allow" | "deny";
    to: "allow" | "deny";
  }>;
}

/** Error union returned by the historical grant validators on this stack cut. */
export type GrantError = PermissionError | GrantDeniedError;
