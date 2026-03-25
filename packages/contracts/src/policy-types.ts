import type { PermissionScopeType } from "@xmtp/signet-schemas";

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
